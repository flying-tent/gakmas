// 前日(日本時間)の再生回数ランキングを X に投稿する
// - MVだけのランキング(TOP3)を投稿し、そのリプライで MV・音源・インストの合計のランキング(TOP3)を投稿する
// - その日の回数は data/daily/ の記録から、ページの「今日」と同じ計算(scripts/build-site.mjs の buildSite)で出す
// - 毎時の取得(.github/workflows/update.yml)から毎回呼ばれ、日本時間の POST_HOUR 時を過ぎていて、
//   前日分をまだ投稿していないときだけ投稿する。投稿したことは data/x-post.json に残す(二重投稿を防ぐ)
// 実行:
//   node scripts/post-x.mjs --dry-run            投稿文をログに出すだけ(時刻・投稿済みの確認もしない)
//   node scripts/post-x.mjs --dry-run 2026-11-26  その日のランキングで試す
//   X_API_KEY=… X_API_SECRET=… X_ACCESS_TOKEN=… X_ACCESS_TOKEN_SECRET=… node scripts/post-x.mjs
import { readFile, writeFile } from "node:fs/promises";
import { createHmac, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { buildSite } from "./build-site.mjs";

const POST_HOUR = 12; // この時刻(日本時間)を過ぎたら投稿する
const TOP_N = 3;
const HASHTAGS = "#学マス #学園アイドルマスター";
const GUIDE = "全曲のランキングはプロフィールのリンクから";
// 前日の最後の記録がこの時刻(日本時間)より前なら、夜の取得が抜けていて回数が少なく出るので投稿しない
const COMPLETE_HOUR = 22;
const DAILY_DIR = new URL("../data/daily/", import.meta.url);
const POST_STATE_FILE = new URL("../data/x-post.json", import.meta.url);
const MEDALS = ["🥇", "🥈", "🥉"];
const MAX_WEIGHT = 280; // X の文字数の上限(日本語や絵文字は1文字で2と数える)

async function readJson(url, fallback) {
  try { return JSON.parse(await readFile(url, "utf8")); } catch { return fallback; }
}
const jstDate = (d) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const jstHour = (d) => Number(d.toLocaleString("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", hourCycle: "h23" }));
const addDays = (date, n) => {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
async function dailyRow(date) {
  const file = await readJson(new URL(`${date.slice(0, 7)}.json`, DAILY_DIR), { days: [] });
  return file.days.find((d) => d.date === date) || null;
}

// その日の曲ごとの回数(ページの data.json と同じ形)。記録が足りないときは理由を返す
export async function songsOf(date) {
  const row = await dailyRow(date);
  if (!row) return { error: `${date} の記録がありません` };
  if (jstHour(new Date(row.at)) < COMPLETE_HOUR || jstDate(new Date(row.at)) !== date) {
    return { error: `${date} の最後の記録が ${new Date(row.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} で、夜の分が足りません` };
  }
  const prev = await dailyRow(addDays(date, -1));
  const index = await readJson(new URL("videos.json", DAILY_DIR), {});
  const videos = Object.values(index).filter((v) => v.id in row.views);
  const site = buildSite({ videos, snapshots: [prev, row].filter(Boolean) });
  if (!site.prevDate) return { error: `${date} の回数の基準になる記録がありません` };
  return { songs: site.songs };
}

// ランキング。mvOnly のときは MV の回数だけで数え、MV のない曲は外す
export function ranking(songs, { mvOnly }) {
  return songs
    .map((s) => {
      const vs = s.videos.filter((v) => (mvOnly ? v.type === "mv" : true) && v.diff != null);
      return { title: s.title, singer: s.singer || s.idols.join("・"), idols: s.idols, count: vs.reduce((n, v) => n + v.diff, 0), has: vs.length > 0 };
    })
    .filter((r) => r.has)
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_N);
}

// X の数え方での文字数(だいたい):Latin などは1、日本語・絵文字などは2
export function weight(text) {
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    const narrow = c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037);
    n += c === 0xfe0f ? 0 : narrow ? 1 : 2;
  }
  return n;
}

const fmt = new Intl.NumberFormat("ja-JP");
// 投稿文。長すぎるときは歌唱者を「1人目ほか」に、それでも長ければ歌唱者を省く
export function postText(header, rows, footer) {
  const singerModes = [
    (r) => r.singer,
    (r) => (r.idols.length > 1 ? `${r.idols[0]}ほか` : r.singer),
    () => "",
  ];
  let text = "";
  for (const mode of singerModes) {
    const lines = rows.map((r, i) => {
      const singer = mode(r);
      return `${MEDALS[i]} ${r.title}${singer ? ` / ${singer}` : ""} +${fmt.format(r.count)}`;
    });
    text = [header, ...lines, "", ...footer].join("\n");
    if (weight(text) <= MAX_WEIGHT) return text;
  }
  return text;
}

export function postTexts(date, songs) {
  const label = `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const footer = [GUIDE, HASHTAGS];
  return {
    mv: postText(`📊 学マス MV再生数ランキング(${label})`, ranking(songs, { mvOnly: true }), footer),
    all: postText(`📊 MV・音源・インストの合計(${label})`, ranking(songs, { mvOnly: false }), footer),
  };
}

// OAuth 1.0a(ユーザーの代わりに投稿する。JSON の本文は署名に含めない)
function oauthHeader(method, url, keys) {
  const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const params = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: keys.accessToken,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join("&");
  const base = [method, enc(url), enc(paramString)].join("&");
  const signingKey = `${enc(keys.apiSecret)}&${enc(keys.accessTokenSecret)}`;
  params.oauth_signature = createHmac("sha1", signingKey).update(base).digest("base64");
  return "OAuth " + Object.keys(params).sort().map((k) => `${enc(k)}="${enc(params[k])}"`).join(", ");
}

async function tweet(text, keys, replyTo) {
  const url = "https://api.x.com/2/tweets";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: oauthHeader("POST", url, keys), "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}) }),
  });
  const body = await res.json().catch(() => ({}));
  // 同じ文の投稿は X が断る。前の実行で投稿できていたのに記録が残らなかったとき(コミットの失敗など)なので、投稿済みとして扱う
  if (res.status === 403 && /duplicate/i.test(JSON.stringify(body))) return "duplicate";
  if (!res.ok || !body?.data?.id) throw new Error(`X への投稿に失敗しました: ${res.status} ${JSON.stringify(body)}`);
  return body.data.id;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const now = new Date();
  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || addDays(jstDate(now), -1);
  const state = await readJson(POST_STATE_FILE, {});
  const done = state.date === date ? state : { date };

  if (!dryRun) {
    if (jstHour(now) < POST_HOUR) { console.log(`X:${POST_HOUR}時(日本時間)を過ぎてから投稿します`); process.exit(0); }
    if (done.mv && done.all) { console.log(`X:${date} の分は投稿済みです`); process.exit(0); }
  }
  const keys = {
    apiKey: process.env.X_API_KEY, apiSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN, accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET,
  };
  if (!dryRun && !Object.values(keys).every(Boolean)) { console.log("X:キーが設定されていないので投稿しません"); process.exit(0); }

  const { songs, error } = await songsOf(date);
  if (error) {
    console.log(`X:投稿しません(${error})`);
    process.exit(0);
  }
  const texts = postTexts(date, songs);
  if (dryRun) {
    for (const [k, t] of Object.entries(texts)) console.log(`----- ${k}(${weight(t)}/${MAX_WEIGHT})-----\n${t}`);
    process.exit(0);
  }
  // 1件ずつ投稿して、そのつど記録する(途中で失敗したら、次の毎時の実行で残りだけ投稿する)
  const save = () => writeFile(POST_STATE_FILE, JSON.stringify(done) + "\n");
  if (!done.mv) {
    done.mv = await tweet(texts.mv, keys);
    await save();
    console.log(`X:MVのランキングを投稿しました(${done.mv})`);
  }
  if (!done.all) {
    done.all = await tweet(texts.all, keys, /^\d+$/.test(done.mv) ? done.mv : null);
    await save();
    console.log(`X:合計のランキングを投稿しました(${done.all})`);
  }
}
