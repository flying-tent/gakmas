// 週次アクセスレポート:Google アナリティクス 4 の直近7日の数字を集め、AI(Gemini)に改善案を書かせて、GitHub の Issue にする
// - 期間は前日(日本時間)までの7日間。その前の7日間と比べる
// - 集める数字:全体(ユーザー・セッション・ページビューなど)・ページ別・端末別・流入元別・時間帯別・イベント別と、
//   mv.html の操作イベント(analytics.js / mv.html の logEvent)の中身(切り替えた設定・開いた曲・アイドル・YouTube・検索した言葉)
//   操作イベントの中身は、GA のカスタムディメンションを登録しないと取れない(取れないときは表に「未登録」と出して続ける)
// - AI には、ページの機能の説明(README の「MV再生回数」の節)と集めた数字だけを渡す。改善案は Issue に書くだけで、コードは変えない
// - AI の呼び出しに失敗したときも、数字の表だけで Issue を作る
// - .github/workflows/weekly-report.yml から週1回呼ばれる
// 実行:
//   node scripts/weekly-report.mjs --dry-run          Issue を作らず、レポートを標準出力に出す
//   node scripts/weekly-report.mjs --dry-run --sample GA を使わずダミーの数字で試す(GEMINI_API_KEY がなければ AI も飛ばす)
// 環境変数:
//   GA_PROPERTY_ID   GA4 のプロパティID(数字だけ)
//   GA_SA_KEY        GA4 を読めるサービスアカウントの鍵(JSON をそのまま)
//   GEMINI_API_KEY   Gemini API のキー(Google AI Studio で作る)
//   GEMINI_MODEL     使うモデル(省略すると gemini-2.5-flash)
//   GITHUB_TOKEN, GITHUB_REPOSITORY  Issue を作るため(Actions では自動で入る)
import { readFile } from "node:fs/promises";
import { createSign } from "node:crypto";
import { pathToFileURL } from "node:url";

const DEFAULT_MODEL = "gemini-2.5-flash";
const README = new URL("../README.md", import.meta.url);
const ISSUE_BODY_MAX = 60000; // GitHub の Issue 本文の上限(65536文字)より少し小さく

// ---------- 期間 ----------
const jstDate = (d) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
function addDays(date, n) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function periods(now = new Date()) {
  const end = addDays(jstDate(now), -1);
  const start = addDays(end, -6);
  return { cur: { startDate: start, endDate: end }, prev: { startDate: addDays(start, -7), endDate: addDays(start, -1) } };
}

// ---------- GA4 Data API ----------
const b64url = (s) => Buffer.from(s).toString("base64url");
async function googleToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email, scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: key.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const sig = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(key.private_key).toString("base64url");
  const res = await fetch(key.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${sig}` }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google の認証に失敗: ${res.status} ${JSON.stringify(json)}`);
  return json.access_token;
}

// 1つの表を、今週と先週の2回取って行ごとに並べる。dims が空なら全体の1行
async function gaTable(ga, { dims = [], metrics, filter, limit = 20, orderBy, prevToo = true }) {
  const run = async (range) => {
    const body = {
      dateRanges: [range],
      dimensions: dims.map((name) => ({ name })),
      metrics: metrics.map((name) => ({ name })),
      limit,
      ...(filter ? { dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: filter } } } } : {}),
      ...(orderBy ? { orderBys: [{ metric: { metricName: orderBy }, desc: true }] }
        : dims[0] === "hour" ? { orderBys: [{ dimension: { dimensionName: "hour" } }] } : {}),
    };
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${ga.property}:runReport`, {
      method: "POST",
      headers: { authorization: `Bearer ${ga.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `${res.status}`);
    return (json.rows || []).map((r) => ({
      dimValues: (r.dimensionValues || []).map((d) => d.value),
      values: r.metricValues.map((m) => Number(m.value)),
    }));
  };
  const cur = await run(ga.periods.cur);
  const prev = prevToo ? await run(ga.periods.prev) : [];
  const keyOf = (r) => JSON.stringify(r.dimValues);
  const prevMap = new Map(prev.map((r) => [keyOf(r), r.values]));
  return { dims, metrics, prevToo, rows: cur.map((r) => ({ ...r, prev: prevMap.get(keyOf(r)) || null })) };
}

// 集める表の一覧。optional は、カスタムディメンションを登録していないと失敗する表
const REPORTS = [
  { id: "summary", title: "全体", metrics: ["activeUsers", "newUsers", "sessions", "screenPageViews", "engagementRate", "averageSessionDuration"] },
  { id: "pages", title: "ページ別", dims: ["pagePath"], metrics: ["screenPageViews", "activeUsers", "userEngagementDuration"], orderBy: "screenPageViews" },
  { id: "devices", title: "端末別", dims: ["deviceCategory"], metrics: ["activeUsers", "engagementRate", "averageSessionDuration"], orderBy: "activeUsers" },
  { id: "sources", title: "流入元別", dims: ["sessionSourceMedium"], metrics: ["sessions", "engagementRate"], orderBy: "sessions", limit: 15 },
  { id: "hours", title: "時間帯別(今週、日本時間)", dims: ["hour"], metrics: ["activeUsers"], limit: 24, prevToo: false },
  { id: "events", title: "イベント別", dims: ["eventName"], metrics: ["eventCount", "totalUsers"], orderBy: "eventCount", limit: 30 },
  { id: "settings", title: "表示の切り替え(change_setting)", dims: ["customEvent:setting", "customEvent:value"], metrics: ["eventCount"], filter: "change_setting", orderBy: "eventCount", optional: true },
  { id: "songs", title: "開いた曲(open_song)", dims: ["customEvent:song_title"], metrics: ["eventCount", "totalUsers"], filter: "open_song", orderBy: "eventCount", limit: 15, optional: true },
  { id: "idols", title: "開いたアイドル(open_idol)", dims: ["customEvent:idol"], metrics: ["eventCount"], filter: "open_idol", orderBy: "eventCount", limit: 15, optional: true },
  { id: "youtube", title: "YouTube へ(open_youtube)", dims: ["customEvent:video_type"], metrics: ["eventCount"], filter: "open_youtube", orderBy: "eventCount", optional: true },
  { id: "layout", title: "操作したときの表示(期間・PC/スマホ)", dims: ["customEvent:period", "customEvent:layout"], metrics: ["eventCount"], orderBy: "eventCount", optional: true },
  { id: "search", title: "検索した言葉(search)", dims: ["customEvent:search_term"], metrics: ["eventCount"], filter: "search", orderBy: "eventCount", limit: 15, optional: true },
];

async function collect(ga) {
  const out = [];
  for (const r of REPORTS) {
    try {
      out.push({ ...r, table: await gaTable(ga, r) });
    } catch (e) {
      if (!r.optional) throw new Error(`「${r.title}」を取れませんでした: ${e.message}`);
      out.push({ ...r, error: "取れませんでした(GA にカスタムディメンションが未登録の可能性)" });
      console.warn(`::warning::「${r.title}」を取れませんでした: ${e.message}`);
    }
  }
  return out;
}

// ---------- 表を Markdown にする ----------
const LABELS = {
  activeUsers: "ユーザー", newUsers: "新規ユーザー", sessions: "セッション", screenPageViews: "ページビュー",
  engagementRate: "エンゲージメント率", averageSessionDuration: "平均セッション時間", userEngagementDuration: "1人あたり滞在",
  eventCount: "回数", totalUsers: "ユーザー",
  pagePath: "ページ", deviceCategory: "端末", sessionSourceMedium: "流入元", hour: "時", eventName: "イベント",
  "customEvent:setting": "設定", "customEvent:value": "値", "customEvent:song_title": "曲", "customEvent:idol": "アイドル",
  "customEvent:video_type": "種類", "customEvent:period": "期間", "customEvent:layout": "画面", "customEvent:search_term": "検索語",
};
function fmtValue(metric, v, row) {
  if (v == null || Number.isNaN(v)) return "-";
  if (metric === "engagementRate") return `${(v * 100).toFixed(1)}%`;
  if (metric === "averageSessionDuration") return `${v.toFixed(0)}秒`;
  // 合計の滞在時間は、そのページのユーザー1人あたりにして出す
  if (metric === "userEngagementDuration") {
    const users = row?.[1];
    return users ? `${(v / users).toFixed(0)}秒` : "-";
  }
  return Math.round(v).toLocaleString("ja-JP");
}
function change(metric, cur, prev) {
  if (prev == null || !prev) return "";
  if (metric === "engagementRate") return ` (${cur >= prev ? "+" : "−"}${(Math.abs(cur - prev) * 100).toFixed(1)}pt)`;
  if (metric === "userEngagementDuration" || metric === "averageSessionDuration") return "";
  const p = ((cur - prev) / prev) * 100;
  return ` (${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(0)}%)`;
}
export function tableMd(table) {
  const { dims, metrics, rows, prevToo } = table;
  if (!rows.length) return "(データなし)";
  const head = [...dims.map((d) => LABELS[d] || d), ...metrics.map((m) => LABELS[m] || m)];
  const lines = [`| ${head.join(" | ")} |`, `|${head.map((_, i) => (i < dims.length ? "---" : "---:")).join("|")}|`];
  for (const r of rows) {
    const cells = metrics.map((m, i) => fmtValue(m, r.values[i], r.values) + (prevToo ? change(m, r.values[i], r.prev?.[i]) : ""));
    lines.push(`| ${[...r.dimValues, ...cells].map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`);
  }
  return lines.join("\n");
}
export function dataMd(reports) {
  return reports.map((r) => `### ${r.title}\n\n${r.error ? `(${r.error})` : tableMd(r.table)}`).join("\n\n");
}

// ---------- AI(Gemini) ----------
async function siteDescription() {
  const md = await readFile(README, "utf8").catch(() => "");
  const mv = md.match(/## MV再生回数[\s\S]*?(?=\n## )/)?.[0] || "";
  // 開発用のメモ(API キー・手動修正のしかたなど)は省いて、画面の説明に近い行だけを渡す
  const lines = mv.split("\n").filter((l) => /^- (検索|表示の切り替え|表示条件|PC表示|境目|配色|上の「最多再生MV」)/.test(l));
  return [
    "サイト「学マスツール」(学園アイドルマスターの非公式ファンツール。GitHub Pages)のページ:",
    "- / (index.html):ツールの一覧",
    "- /mv.html:初星学園チャンネルの楽曲MV・音源の再生回数ランキング(毎時更新)。今日(デイリー)/累計、曲/アイドル、MVだけで集計を切り替えられる。曲をタップすると動画一覧のポップアップ、そこから YouTube へ",
    "- /ikusei.html:育成シミュレーター",
    "- /score-memo.html:シーズンごとのスコアメモ",
    "- 毎日12時ごろ、前日の再生数ランキングを X に画像付きで投稿している(本文に URL は入れていない)",
    "",
    "mv.html の画面の詳しい説明:",
    ...lines,
  ].join("\n");
}

export function buildPrompt(site, data, p) {
  return `あなたは小さなファンサイトの改善を手伝うアナリストです。下のアクセス解析の数字を読んで、サイトの改善案を日本語の Markdown で書いてください。

# 前提
${site}

# 数字(${p.cur.startDate}〜${p.cur.endDate}。かっこ内は前の7日間(${p.prev.startDate}〜${p.prev.endDate})との比較)
${data}

# 書くこと(この見出しのとおりに)
## 今週のまとめ
3行以内。

## 気づいたこと
数字を根拠に3〜5個。どの表のどの数字かを書く。

## 改善案
多くても3つ。それぞれ次の4行で:
- **何を変えるか**:画面やファイルのどこを、どう変えるか
- **根拠**:どの数字からそう考えたか
- **効果の測り方**:来週以降どの数字を見ればよいか
- **手間**:小・中・大

## 次に計測するとよいこと
今の数字では判断できないことと、そのために足すとよいイベント(1〜3個)。

# 守ること
- 表にない数字を作らない。ユーザーが少なく差が小さいときは「まだ判断できない」と書く
- 広告・課金・SNS の運用方法など、サイトの外の話はしない
- 前置きやあいさつは書かない`;
}

async function gemini(prompt, { key, model }) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `${res.status}`);
  const text = (json.candidates?.[0]?.content?.parts || []).map((x) => x.text || "").join("").trim();
  if (!text) throw new Error(`空の返答(${json.candidates?.[0]?.finishReason || "理由不明"})`);
  return text;
}

// ---------- Issue ----------
export function issueBody({ ai, aiError, data, model, p }) {
  const head = ai
    ? `${ai}\n\n<sub>AI(${model})が下の数字から書いた案です。採用するかは数字と照らして決めてください。</sub>`
    : `> AI の改善案は作れませんでした${aiError ? `(${aiError})` : ""}。数字だけ載せます。`;
  let body = `${head}\n\n<details><summary>集計した数字(${p.cur.startDate}〜${p.cur.endDate})</summary>\n\n${data}\n\n</details>`;
  if (body.length > ISSUE_BODY_MAX) body = body.slice(0, ISSUE_BODY_MAX) + "\n\n…(長すぎるので省略)\n\n</details>";
  return body;
}
async function createIssue(title, body) {
  const repo = process.env.GITHUB_REPOSITORY;
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: "application/vnd.github+json",
      "content-type": "application/json", "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ title, body }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Issue を作れませんでした: ${res.status} ${json.message || ""}`);
  return json.html_url;
}

// ---------- ダミーの数字(--sample) ----------
function sampleReports() {
  const t = (dims = [], metrics, rows, prevToo = true) => ({ dims, metrics, prevToo, rows: rows.map(([key, values, prev]) => ({ dimValues: dims.length ? key.split(" | ") : [], values, prev: prev || null })) });
  return REPORTS.map((r) => {
    const table = {
      summary: t([], r.metrics, [["", [120, 80, 210, 640, 0.62, 95], [100, 70, 180, 560, 0.58, 88]]]),
      pages: t(r.dims, r.metrics, [["/mv.html", [480, 110, 9900], [400, 92, 8000]], ["/", [90, 70, 900], [85, 66, 850]], ["/ikusei.html", [50, 20, 3000], [60, 25, 3300]]]),
      devices: t(r.dims, r.metrics, [["mobile", [95, 0.6, 80], [80, 0.55, 75]], ["desktop", [25, 0.72, 160], [20, 0.7, 150]]]),
      sources: t(r.dims, r.metrics, [["t.co / referral", [90, 0.5], [70, 0.48]], ["(direct) / (none)", [80, 0.7], [75, 0.68]], ["google / organic", [30, 0.65], [25, 0.6]]]),
      hours: t(r.dims, r.metrics, [["11", [8]], ["12", [40]], ["13", [22]], ["21", [18]]], false),
      events: t(r.dims, r.metrics, [["page_view", [640, 120]], ["open_song", [150, 60]], ["change_setting", [70, 30]], ["search", [12, 8]], ["open_youtube", [40, 25]]]),
      settings: t(r.dims, r.metrics, [["view | total", [30]], ["mvOnly | on", [18]], ["unit | idol", [15]]]),
      songs: t(r.dims, r.metrics, [["初", [30, 20]], ["Fighting My Way", [22, 15]]]),
      idols: t(r.dims, r.metrics, [["花海咲季", [9]], ["月村手毬", [7]]]),
      youtube: t(r.dims, r.metrics, [["mv", [30]], ["vocal", [10]]]),
      layout: t(r.dims, r.metrics, [["today | mobile", [140]], ["total | pc", [60]]]),
      search: null,
    }[r.id];
    return table ? { ...r, table } : { ...r, error: "取れませんでした(GA にカスタムディメンションが未登録の可能性)" };
  });
}

// ---------- 実行 ----------
async function main(args) {
  const dryRun = args.includes("--dry-run");
  const sample = args.includes("--sample");
  const p = periods();
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  let reports;
  if (sample) reports = sampleReports();
  else {
    const { GA_PROPERTY_ID, GA_SA_KEY } = process.env;
    if (!GA_PROPERTY_ID || !GA_SA_KEY) throw new Error("GA_PROPERTY_ID と GA_SA_KEY を設定してください");
    const token = await googleToken(JSON.parse(GA_SA_KEY));
    reports = await collect({ property: GA_PROPERTY_ID.replace(/\D/g, ""), token, periods: p });
  }
  const data = dataMd(reports);

  let ai = null, aiError = null;
  if (process.env.GEMINI_API_KEY) {
    try {
      ai = await gemini(buildPrompt(await siteDescription(), data, p), { key: process.env.GEMINI_API_KEY, model });
    } catch (e) {
      aiError = e.message;
      console.warn(`::warning::AI の呼び出しに失敗しました: ${e.message}`);
    }
  } else aiError = "GEMINI_API_KEY が未設定";

  const title = `週次アクセスレポート ${p.cur.startDate}〜${p.cur.endDate.slice(5)}`;
  const body = issueBody({ ai, aiError, data, model, p });
  if (dryRun) {
    console.log(`# ${title}\n\n${body}`);
    if (!process.env.GEMINI_API_KEY) console.log("\n----- AI に渡すプロンプト -----\n" + buildPrompt(await siteDescription(), data, p));
    return;
  }
  console.log(`Issue を作りました: ${await createIssue(title, body)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2)).catch((e) => { console.error(process.env.DEBUG ? e : e.message); process.exit(1); });
}
