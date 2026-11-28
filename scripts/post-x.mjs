// 前日(日本時間)の再生回数ランキングを、画像付きで X に投稿する
// - MVだけのランキングと、MV・音源・インストの合計のランキングを、別々の投稿にする(リプライにはしない)
// - 画像は TOP10(scripts/ranking-image.mjs で作る)。本文は1位の曲の紹介とハッシュタグ
// - 順位は前日の再生数の多い順。順位の変化は前々日の順位と比べる(▲上がった / ▼下がった / → 同じ / NEW 新曲)
// - その日の回数は data/daily/ の記録から、ページの「今日」と同じ計算(scripts/build-site.mjs の buildSite)で出す
// - .github/workflows/post-x.yml から呼ばれ、前日分をまだ投稿していないときだけ投稿する(何時に動かしてもよい。1日1回だけ投稿する)
//   投稿したことは data/x-post.json に残す(二重投稿を防ぐ)
// - 画像を作れなかったり、アップロードできなかったりしたときは、本文だけで投稿する
// 実行:
//   node scripts/post-x.mjs --dry-run            投稿文をログに出し、画像を x-images/ に作るだけ(投稿済みの確認もしない)
//   node scripts/post-x.mjs --dry-run 2026-11-26  その日のランキングで試す
//   node scripts/post-x.mjs --force              投稿済みかを確かめずに、2件とも投稿し直す(同じ日の分がもう一度出る)
//   X_API_KEY=… X_API_SECRET=… X_ACCESS_TOKEN=… X_ACCESS_TOKEN_SECRET=… node scripts/post-x.mjs
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { createHmac, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSite } from "./build-site.mjs";
import { rankingHtml, renderPng } from "./ranking-image.mjs";

const TOP_N = 10;
const HASHTAGS = "#学マス #学園アイドルマスター";
// 前日の最後の記録がこの時刻(日本時間)より前なら、夜の取得が抜けていて回数が少なく出るので投稿しない
const COMPLETE_HOUR = 22;
const DAILY_DIR = new URL("../data/daily/", import.meta.url);
const POST_STATE_FILE = new URL("../data/x-post.json", import.meta.url);
const DRY_RUN_DIR = "x-images"; // お試し実行で画像を置く場所(実行したフォルダの中)
const MAX_WEIGHT = 280; // X の文字数の上限(日本語や絵文字は1文字で2と数える)
// 2種類のランキング。label は画像のラベル、header は本文の見出し
const KINDS = [
  { key: "mv", mvOnly: true, label: "MV", header: "学マス MV再生数ランキング" },
  { key: "all", mvOnly: false, label: "全曲", header: "学マス 楽曲再生数ランキング" },
];

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
const slashDate = (date) => date.replaceAll("-", "/"); // 2026/11/27
async function dailyRow(date) {
  const file = await readJson(new URL(`${date.slice(0, 7)}.json`, DAILY_DIR), { days: [] });
  return file.days.find((d) => d.date === date) || null;
}

// その日の曲ごとの回数(ページの data.json と同じ形)。記録が足りないときは理由を返す
// strict:夜の記録が抜けている日をエラーにする(順位の変化を出すための前々日の分は、抜けていてもそのまま使う)
export async function songsOf(date, { strict = true } = {}) {
  const row = await dailyRow(date);
  if (!row) return { error: `${date} の記録がありません` };
  if (strict && (jstHour(new Date(row.at)) < COMPLETE_HOUR || jstDate(new Date(row.at)) !== date)) {
    return { error: `${date} の最後の記録が ${new Date(row.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} で、夜の分が足りません` };
  }
  const prev = await dailyRow(addDays(date, -1));
  const index = await readJson(new URL("videos.json", DAILY_DIR), {});
  const videos = Object.values(index).filter((v) => v.id in row.views);
  const site = buildSite({ videos, snapshots: [prev, row].filter(Boolean) });
  if (!site.prevDate) return { error: `${date} の回数の基準になる記録がありません` };
  return { songs: site.songs };
}

// 全曲のランキング(順位付き)。mvOnly のときは MV の回数だけで数え、MV のない曲は外す
// isNew:数えた動画がすべて新曲(その日に公開されたもの)
export function ranking(songs, { mvOnly }) {
  return songs
    .map((s) => {
      const vs = s.videos.filter((v) => (mvOnly ? v.type === "mv" : true) && v.diff != null);
      return {
        title: s.title, singer: s.singer || s.idols.join("・"), idols: s.idols,
        count: vs.reduce((n, v) => n + v.diff, 0), isNew: vs.length > 0 && vs.every((v) => v.isNew), has: vs.length > 0,
      };
    })
    .filter((r) => r.has)
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, "ja"))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

// 前々日の順位と比べた変化を付ける(前々日のランキングがないときは "none")
export function withChange(rows, prevRows) {
  const prevRank = new Map((prevRows || []).map((r) => [r.title, r.rank]));
  return rows.map((r) => {
    const p = prevRank.get(r.title);
    const change = r.isNew ? { type: "new" }
      : !prevRows || p == null ? { type: "none" }
      : p > r.rank ? { type: "up", n: p - r.rank }
      : p < r.rank ? { type: "down", n: r.rank - p }
      : { type: "same" };
    return { ...r, change };
  });
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
// 本文:見出し・1位の曲の紹介・ハッシュタグ。長すぎるときは歌唱者を「1人目ほか」に、それでも長ければ省く
export function postText(kind, date, top) {
  const singerModes = [(r) => r.singer, (r) => (r.idols.length > 1 ? `${r.idols[0]}ほか` : r.singer), () => ""];
  let text = "";
  for (const mode of singerModes) {
    const singer = mode(top);
    const intro = `1位は「${top.title}」${singer ? `(${singer})` : ""}！1日で${fmt.format(top.count)}回再生されました`;
    text = [`${kind.header}(${slashDate(date)})`, intro, HASHTAGS].join("\n");
    if (weight(text) <= MAX_WEIGHT) return text;
  }
  return text;
}

// 画像の代替テキスト(読み上げ用。1000文字まで)
export function altText(kind, date, rows) {
  const mark = (c) => ({ up: `${c.n}上昇`, down: `${c.n}下降`, same: "変動なし", new: "初登場" })[c.type] || "";
  const lines = rows.map((r) => `${r.rank}位 ${r.title}(${r.singer}) ${fmt.format(r.count)}回${mark(r.change) ? ` ${mark(r.change)}` : ""}`);
  let text = [`初星学園 音楽ランキング ${kind.label} ${slashDate(date)}`, ...lines].join("\n");
  if (text.length > 1000) text = text.slice(0, 999) + "…";
  return text;
}

// 投稿の中身(本文・画像の HTML・代替テキスト)を2種類とも作る
export async function buildPosts(date) {
  const { songs, error } = await songsOf(date);
  if (error) return { error };
  const prev = await songsOf(addDays(date, -1), { strict: false });
  return {
    posts: await Promise.all(KINDS.map(async (kind) => {
      const rows = withChange(ranking(songs, kind), prev.songs ? ranking(prev.songs, kind) : null).slice(0, TOP_N);
      return {
        kind, rows,
        text: postText(kind, date, rows[0]),
        alt: altText(kind, date, rows),
        html: await rankingHtml({ label: kind.label, date: slashDate(date), rows }),
      };
    })),
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

async function xPost(path, payload, keys) {
  const url = "https://api.x.com/2/" + path;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: oauthHeader("POST", url, keys), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { res, body: await res.json().catch(() => ({})) };
}

// 画像をアップロードして media の ID を返す(代替テキストも付ける。代替テキストの失敗は無視する)
async function uploadImage(png, alt, keys) {
  const { res, body } = await xPost("media/upload", { media: png.toString("base64"), media_category: "tweet_image" }, keys);
  if (!res.ok || !body?.data?.id) throw new Error(`画像のアップロードに失敗しました: ${res.status} ${JSON.stringify(body)}`);
  const id = body.data.id;
  const meta = await xPost("media/metadata", { id, metadata: { alt_text: { text: alt } } }, keys).catch((e) => ({ res: { ok: false, status: e.message }, body: {} }));
  if (!meta.res.ok) console.warn(`X:代替テキストを付けられませんでした(画像はそのまま使います): ${meta.res.status} ${JSON.stringify(meta.body)}`);
  return id;
}

async function tweet(text, keys, mediaId, { force = false } = {}) {
  const { res, body } = await xPost("tweets", { text, ...(mediaId ? { media: { media_ids: [mediaId] } } : {}) }, keys);
  // 同じ文の投稿は X が断る。前の実行で投稿できていたのに記録が残らなかったとき(コミットの失敗など)なので、投稿済みとして扱う
  // ただし強制モードでは、投稿されなかったことがわかるように失敗にする
  if (res.status === 403 && /duplicate/i.test(JSON.stringify(body))) {
    if (force) throw new Error("最近の投稿と同じ文なので、X に断られました(強制モードでも同じ文は投稿できません)");
    return "duplicate";
  }
  if (!res.ok || !body?.data?.id) throw new Error(`X への投稿に失敗しました: ${res.status} ${JSON.stringify(body)}`);
  return body.data.id;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = !dryRun && args.includes("--force"); // 投稿済みかを確かめない
  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || addDays(jstDate(new Date()), -1);
  const state = await readJson(POST_STATE_FILE, {});
  // 強制モードでは前の記録を使わず、2件とも投稿する(記録は新しい投稿で上書きする)
  const done = state.date === date && !force ? state : { date };

  if (!dryRun && KINDS.every((k) => done[k.key])) { console.log(`X:${date} の分は投稿済みです`); process.exit(0); }
  if (force) console.log(`X:強制モードです。${date} の分を、投稿済みかを確かめずに投稿します`);
  const keys = {
    apiKey: process.env.X_API_KEY, apiSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN, accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET,
  };
  if (!dryRun && !Object.values(keys).every(Boolean)) { console.log("X:キーが設定されていないので投稿しません"); process.exit(0); }

  const { posts, error } = await buildPosts(date);
  if (error) {
    console.log(`X:投稿しません(${error})`);
    process.exit(0);
  }
  const imageDir = dryRun ? DRY_RUN_DIR : await mkdtemp(join(tmpdir(), "x-post-"));
  await mkdir(imageDir, { recursive: true });

  // 1件ずつ投稿して、そのつど記録する(途中で失敗したら、もう一度動かすと残りだけ投稿する)
  const save = () => writeFile(POST_STATE_FILE, JSON.stringify(done) + "\n");
  for (const p of posts) {
    if (!dryRun && done[p.kind.key]) continue;
    let png = null;
    try {
      png = await readFile(await renderPng(p.html, join(imageDir, `${date}-${p.kind.key}.png`)));
    } catch (e) {
      console.warn(`X:${p.kind.label}の画像を作れませんでした(本文だけで投稿します): ${e.message}`);
    }
    if (dryRun) {
      console.log(`----- ${p.kind.key}(${weight(p.text)}/${MAX_WEIGHT})-----\n${p.text}\n----- 代替テキスト -----\n${p.alt}`);
      if (png) console.log(`画像:${join(imageDir, `${date}-${p.kind.key}.png`)}`);
      continue;
    }
    let mediaId = null;
    if (png) {
      try {
        mediaId = await uploadImage(png, p.alt, keys);
      } catch (e) {
        console.warn(`X:${e.message}(本文だけで投稿します)`);
      }
    }
    done[p.kind.key] = await tweet(p.text, keys, mediaId, { force });
    await save();
    console.log(`X:${p.kind.label}のランキングを投稿しました(${done[p.kind.key]}${mediaId ? "、画像付き" : "、画像なし"})`);
  }
}
