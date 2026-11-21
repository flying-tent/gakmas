// 初星学園の楽曲MVと音源(Topic チャンネル)の再生回数を取得して data/data.json に記録する
// 実行: YT_API_KEY=xxxx node scripts/fetch.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";

const API_KEY = process.env.YT_API_KEY;
const MV_PLAYLIST_ID = "UU2dXx-3RXeeP8hA5AGt8vuw"; // 初星学園チャンネルのアップロード一覧
const AUDIO_PLAYLIST_ID = "UUieSasSDeMIP4m5xGNIwT1Q"; // Hatsuboshi Gakuen - Topic のアップロード一覧(YouTube が自動で作る音源)
const TITLE_FILTER = /Official Music Video/i;
// ハッシュタグ付きのタイトルはショート動画(縦型の切り抜き)なので除外する
const SHORTS_TITLE = /#/;
// 音源のうちインスト(1曲にまとめて数える)
const INSTRUMENTAL = /instrumental|off\s*vocal|オフボーカル|カラオケ/i;
// 音源のうち数えない版:別メンバー・ソロなどの ver. 違い、ゲームサイズ、リミックスなど
const AUDIO_EXCLUDE = /\bver\.|\bversion\b|game\s*size|ゲームサイズ|tv\s*size|short\s*ver|remix|リミックス|\bmix\b/i;
const DATA_FILE = new URL("../data/data.json", import.meta.url);
const KEEP_DAYS = 400; // 記録を残す日数

if (!API_KEY) {
  console.error("環境変数 YT_API_KEY が設定されていません");
  process.exit(1);
}

async function api(path, params) {
  const url = new URL("https://www.googleapis.com/youtube/v3/" + path);
  for (const [k, v] of Object.entries({ ...params, key: API_KEY })) url.searchParams.set(k, v);
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${res.status} ${body?.error?.message || res.statusText}`);
  return body;
}

async function playlistItems(playlistId) {
  const items = [];
  let pageToken = "";
  do {
    const data = await api("playlistItems", {
      part: "snippet,contentDetails", playlistId, maxResults: 50,
      ...(pageToken ? { pageToken } : {}),
    });
    items.push(...(data.items || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return items;
}

// MV の概要欄:「歌:花海咲季(CV.長月あおい)」の行
function mvSingerLine(desc) {
  for (const line of (desc || "").split(/\r?\n/)) {
    const m = line.match(/歌\s*[:：]\s*(.+)$/);
    if (m) return m[1].replace(/\s*(作詞|作曲|編曲).*$/, "").trim();
  }
  return "";
}

// 音源の概要欄:「曲名 · 藤田ことね (CV.飯田ヒカル)」の行(「 · 」の後ろが歌手)
function audioSingerLine(desc) {
  for (const line of (desc || "").split(/\r?\n/)) {
    const parts = line.split(" · ");
    if (parts.length >= 2 && !/^Provided to YouTube/i.test(line)) return parts.slice(1).join("、").trim();
  }
  return "";
}

const idOf = (it) => it.contentDetails?.videoId || it.snippet?.resourceId?.videoId;
const publishedOf = (it) => it.contentDetails?.videoPublishedAt || it.snippet?.publishedAt;

// 1. MV
const videos = [];
for (const it of await playlistItems(MV_PLAYLIST_ID)) {
  const sn = it.snippet || {};
  if (!TITLE_FILTER.test(sn.title || "") || SHORTS_TITLE.test(sn.title || "")) continue;
  videos.push({ id: idOf(it), source: "mv", rawTitle: sn.title, published: publishedOf(it), singerLine: mvSingerLine(sn.description) });
}

// 2. 音源(取れなかったときは MV だけで続ける)
let audioCount = 0;
try {
  for (const it of await playlistItems(AUDIO_PLAYLIST_ID)) {
    const sn = it.snippet || {};
    const title = sn.title || "";
    if (!title || /^(Private|Deleted) video$/i.test(title)) continue;
    if (AUDIO_EXCLUDE.test(title)) continue;
    videos.push({
      id: idOf(it), source: "audio", instrumental: INSTRUMENTAL.test(title),
      rawTitle: title, published: publishedOf(it), singerLine: audioSingerLine(sn.description),
    });
    audioCount++;
  }
} catch (e) {
  console.warn(`音源の一覧を取得できませんでした(MVだけで続けます): ${e.message}`);
}

// 3. 再生回数を50件ずつ取得
const views = {};
for (let i = 0; i < videos.length; i += 50) {
  const ids = videos.slice(i, i + 50).map((v) => v.id).join(",");
  const data = await api("videos", { part: "statistics", id: ids, maxResults: 50 });
  for (const v of data.items || []) views[v.id] = Number(v.statistics?.viewCount || 0);
}

// MV がショート動画かどうかを /shorts/ のURLで確かめる(ショートでなければ通常の再生ページへ転送される)
async function isShort(id) {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${id}`, { method: "HEAD", redirect: "manual" });
    return res.status === 200;
  } catch {
    return false;
  }
}
const candidates = videos.filter((v) => v.id in views);
const shortFlags = await Promise.all(candidates.map((v) => (v.source === "mv" ? isShort(v.id) : false)));
const listed = candidates.filter((_, i) => !shortFlags.at(i));
for (const id of Object.keys(views)) if (!listed.some((v) => v.id === id)) delete views[id];
console.log(`MV ${listed.filter((v) => v.source === "mv").length}本、音源 ${audioCount}本(ショート ${candidates.length - listed.length}本を除外)`);
if (!listed.some((v) => v.source === "mv")) throw new Error("楽曲MVが1本も取得できませんでした");

// 4. 記録に追加(同じ日付の記録は上書き)
let data = { videos: [], snapshots: [] };
try { data = JSON.parse(await readFile(DATA_FILE, "utf8")); } catch {}

const now = new Date();
const date = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // YYYY-MM-DD(日本時間)
const snapshot = { date, at: now.toISOString(), views };
data.snapshots = (data.snapshots || []).filter((s) => s.date !== date);
data.snapshots.push(snapshot);
data.snapshots.sort((a, b) => a.date.localeCompare(b.date));
data.snapshots = data.snapshots.slice(-KEEP_DAYS);
data.videos = listed;
data.updatedAt = now.toISOString();

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(DATA_FILE, JSON.stringify(data, null, 0).replace(/\},\{/g, "},\n{") + "\n");
console.log(`${date}: ${listed.length}本を記録しました(記録 ${data.snapshots.length}日分)`);
