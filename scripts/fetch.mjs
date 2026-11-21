// 初星学園チャンネルの楽曲MVの再生回数を取得して data/data.json に記録する
// 実行: YT_API_KEY=xxxx node scripts/fetch.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";

const API_KEY = process.env.YT_API_KEY;
const UPLOADS_PLAYLIST_ID = "UU2dXx-3RXeeP8hA5AGt8vuw"; // 初星学園チャンネルのアップロード一覧
const TITLE_FILTER = /Official Music Video/i;
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

function extractSingerLine(desc) {
  for (const line of (desc || "").split(/\r?\n/)) {
    const m = line.match(/歌\s*[::]\s*(.+)$/);
    if (m) return m[1].replace(/\s*作詞.*$/, "").trim();
  }
  return "";
}

// 1. アップロード一覧から楽曲MVを抽出
const videos = [];
let pageToken = "";
do {
  const data = await api("playlistItems", {
    part: "snippet,contentDetails", playlistId: UPLOADS_PLAYLIST_ID, maxResults: 50,
    ...(pageToken ? { pageToken } : {}),
  });
  for (const it of data.items || []) {
    const sn = it.snippet || {};
    if (!TITLE_FILTER.test(sn.title || "")) continue;
    videos.push({
      id: it.contentDetails?.videoId || sn.resourceId?.videoId,
      rawTitle: sn.title,
      published: it.contentDetails?.videoPublishedAt || sn.publishedAt,
      singerLine: extractSingerLine(sn.description),
    });
  }
  pageToken = data.nextPageToken || "";
} while (pageToken);

// 2. 再生回数を50件ずつ取得
const views = {};
for (let i = 0; i < videos.length; i += 50) {
  const ids = videos.slice(i, i + 50).map((v) => v.id).join(",");
  const data = await api("videos", { part: "statistics", id: ids, maxResults: 50 });
  for (const v of data.items || []) views[v.id] = Number(v.statistics?.viewCount || 0);
}
const listed = videos.filter((v) => v.id in views);
if (!listed.length) throw new Error("楽曲MVが1本も取得できませんでした");

// 3. 記録に追加(同じ日付の記録は上書き)
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
