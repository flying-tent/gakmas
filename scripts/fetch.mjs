// 初星学園の楽曲MVと音源(Topic チャンネル)の再生回数を取得して記録する
// - data/state.json:取得に使う内部の記録(直近の日ごとの記録・検索結果のキャッシュ)。ページは読まない
// - data/data.json:ページが読むファイル。曲ごとの曲名・歌唱アイドルと、動画ごとの合計回数・その日の回数だけにして軽く保つ
//   (作り方は scripts/build-site.mjs、曲のまとめ方と曲名・歌唱アイドルの読み取りは scripts/songs.mjs)
// - data/daily/:日ごとの記録をずっと残す(あとで推移のグラフを作るため)
// 実行: YT_API_KEY=xxxx node scripts/fetch.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readState, writeState, buildSite, writeSite } from "./build-site.mjs";

const API_KEY = process.env.YT_API_KEY;
const MV_PLAYLIST_ID = "UU2dXx-3RXeeP8hA5AGt8vuw"; // 初星学園チャンネルのアップロード一覧
const AUDIO_CHANNEL_ID = "UCieSasSDeMIP4m5xGNIwT1Q"; // Hatsuboshi Gakuen - Topic(YouTube が自動で作る音源のチャンネル)
// 一部の音源は、歌唱アイドルの名前の Topic チャンネルに入っている(YouTube が自動で振り分けるため)。
// ここに入った曲は、上の Hatsuboshi Gakuen - Topic に同じ曲名がないときだけ数える(同じ曲を二重に数えないため)
const EXTRA_AUDIO_CHANNEL_IDS = [
  "UC8b20tsgwhy6G-is4ZsRD8A", // Lilja Katsuragi - Topic(ときめきエモーション)
  "UC7PCAM2_4vuG_lboqpXGeJQ", // Tsubame Amaya - Topic(理論武装して)
];
const TITLE_FILTER = /Official Music Video/i;
// ハッシュタグ付きのタイトルはショート動画(縦型の切り抜き)なので除外する
const SHORTS_TITLE = /#/;
// 音源のうちインスト(1曲にまとめて数える)
const INSTRUMENTAL = /instrumental|off\s*vocal|オフボーカル|カラオケ/i;
// 音源のうち数えない版:別メンバーなどの ver. 違い、ゲームサイズ、リミックスなど
const AUDIO_EXCLUDE = /\bver\.|\bversion\b|game\s*size|ゲームサイズ|tv\s*size|short\s*ver|remix|リミックス|\bmix\b/i;
// ただしアイドルのソロ版(「初 [氷渡香名江 Solo ver.]」など)は、元の全体曲(「初」)にまとめて合計する。
// ゲームサイズとフルサイズは別の動画として数える(リミックスは数えない)
const SOLO_VER = /solo\s*ver\./i;
const SOLO_VER_EXCLUDE = /remix|リミックス|\bmix\b/i;
const GAME_SIZE = /game\s*size|ゲームサイズ/i;
// state.json に残す日数。その日の回数の計算に要るのは今日の記録(その日の最初の記録を含む)と、新曲の判定に使う前日の記録だけ
// (古い日の記録は data/daily/ に残る)
const KEEP_DAYS = 3;
// 日ごとの記録の置き場所。月ごとのファイル(YYYY-MM.json)と、動画の情報(videos.json)
const DAILY_DIR = new URL("../data/daily/", import.meta.url);

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
// 自動生成チャンネルはアップロード一覧が取れないので、
//   (1) チャンネルの再生リスト(アルバムごと)から集める
//   (2) それで1本も見つからなければ検索で集める(1回100ユニットかかるため、結果は日付ごとに保存して1日1回だけ)
// 曲名と概要欄は videos.list でまとめて取り直す(検索結果の概要欄は途中で切れているため)
let data = { videos: [], snapshots: [] };
// 内部の記録を読む。まだ無ければ、以前の形式の data.json(記録も入っていた)から引き継ぐ
data = await readState();
const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

async function audioIdsFromPlaylists(channelId) {
  const ids = new Set();
  let pageToken = "";
  const lists = [];
  do {
    const d = await api("playlists", { part: "snippet", channelId, maxResults: 50, ...(pageToken ? { pageToken } : {}) });
    lists.push(...(d.items || []));
    pageToken = d.nextPageToken || "";
  } while (pageToken);
  for (const pl of lists) for (const it of await playlistItems(pl.id)) if (idOf(it)) ids.add(idOf(it));
  console.log(`音源(${channelId}):再生リスト ${lists.length}件から ${ids.size}本`);
  return [...ids];
}
// 今日の検索結果(チャンネルごと)。以前の形式({ date, ids })はメインのチャンネルの結果として読む
function searchCache() {
  const c = data.audioSearch;
  if (c?.date !== today) return {};
  if (c.byChannel) return c.byChannel;
  return Array.isArray(c.ids) ? { [AUDIO_CHANNEL_ID]: c.ids } : {};
}
async function audioIdsFromSearch(channelId) {
  const cache = searchCache();
  if (cache[channelId]) {
    console.log(`音源(${channelId}):今日の検索結果(${cache[channelId].length}本)を使います`);
    return cache[channelId];
  }
  const ids = new Set();
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const d = await api("search", { part: "id", channelId, type: "video", maxResults: 50, order: "date", ...(pageToken ? { pageToken } : {}) });
    for (const it of d.items || []) if (it.id?.videoId) ids.add(it.id.videoId);
    pageToken = d.nextPageToken || "";
    if (!pageToken) break;
  }
  data.audioSearch = { date: today, byChannel: { ...cache, [channelId]: [...ids] } };
  console.log(`音源(${channelId}):検索で ${ids.size}本`);
  return [...ids];
}

let audioCount = 0;
const soloVerTitles = []; // 数えたソロ版の曲名(ログに出して確かめられるように)
// 曲名の比較用(全角・半角、空白、大文字・小文字の違いを無視)
const titleKey = (t) => t.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const mainTitles = new Set();
for (const channelId of [AUDIO_CHANNEL_ID, ...EXTRA_AUDIO_CHANNEL_IDS]) {
  const isMain = channelId === AUDIO_CHANNEL_ID;
  try {
    let ids = await audioIdsFromPlaylists(channelId);
    if (!ids.length) ids = await audioIdsFromSearch(channelId);
    for (let i = 0; i < ids.length; i += 50) {
      const d = await api("videos", { part: "snippet", id: ids.slice(i, i + 50).join(","), maxResults: 50 });
      for (const v of d.items || []) {
        const sn = v.snippet || {};
        if (sn.channelId && sn.channelId !== channelId) continue;
        const title = sn.title || "";
        const soloVer = SOLO_VER.test(title) && !SOLO_VER_EXCLUDE.test(title);
        if (!title || (!soloVer && AUDIO_EXCLUDE.test(title))) continue;
        if (videos.some((x) => x.id === v.id)) continue;
        if (isMain) mainTitles.add(titleKey(title));
        else if (mainTitles.has(titleKey(title))) continue;
        videos.push({
          id: v.id, source: "audio", instrumental: INSTRUMENTAL.test(title), ...(GAME_SIZE.test(title) ? { gameSize: true } : {}),
          rawTitle: title, published: sn.publishedAt, singerLine: audioSingerLine(sn.description),
        });
        audioCount++;
        if (soloVer) soloVerTitles.push(title);
      }
    }
  } catch (e) {
    console.warn(`音源(${channelId})の一覧を取得できませんでした(ほかのチャンネルとMVで続けます): ${e.message}`);
  }
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
if (soloVerTitles.length) console.log(`ソロ版 ${soloVerTitles.length}本:\n  ` + soloVerTitles.sort().join("\n  "));
console.log(`MV ${listed.filter((v) => v.source === "mv").length}本、音源 ${audioCount}本(ショート ${candidates.length - listed.length}本を除外)`);
if (!listed.some((v) => v.source === "mv")) throw new Error("楽曲MVが1本も取得できませんでした");

// 4. 記録に追加(同じ日付の記録は上書き)

const now = new Date();
const date = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // YYYY-MM-DD(日本時間)
// first:その日の最初の記録(その日の回数はここからの増加で数える)。その日の最初の取得のときに作り、以降の上書きでも引き継ぐ
// (この仕組みを入れる前に作られた記録には first がない)
const existing = (data.snapshots || []).find((s) => s.date === date);
const first = existing ? existing.first : { at: now.toISOString(), views };
const snapshot = { date, at: now.toISOString(), views, ...(first ? { first } : {}) };
data.snapshots = (data.snapshots || []).filter((s) => s.date !== date);
data.snapshots.push(snapshot);
data.snapshots.sort((a, b) => a.date.localeCompare(b.date));

// 日ごとの記録を月ごとのファイルに残す。その日の値は毎時上書きされ、日付が変わる直前の値が最後に残る
// first にはその日の最初の値が残る(その日の回数 = 最後の値 − first の値)
// (data.json にあるほかの日の記録もまだ残っていなければ入れる。初回の移し替えを兼ねる)
async function readJson(url, fallback) {
  try { return JSON.parse(await readFile(url, "utf8")); } catch { return fallback; }
}
await mkdir(DAILY_DIR, { recursive: true });
const byMonth = {};
for (const s of data.snapshots) (byMonth[s.date.slice(0, 7)] ||= []).push(s);
for (const [month, snaps] of Object.entries(byMonth)) {
  const file = new URL(`${month}.json`, DAILY_DIR);
  const archive = await readJson(file, { month, days: [] });
  for (const s of snaps) {
    // 今日の分はいつも最新の値で上書き。過去の日は、まだ無いときだけ入れる
    const i = archive.days.findIndex((d) => d.date === s.date);
    if (i < 0) archive.days.push(s);
    else if (s.date === date) archive.days[i] = s;
  }
  archive.days.sort((a, b) => a.date.localeCompare(b.date));
  // 1日1行にして、差分を見やすくする
  await writeFile(file, '{"month":' + JSON.stringify(month) + ',"days":[\n' + archive.days.map((d) => JSON.stringify(d)).join(",\n") + "\n]}\n");
}
// 動画の情報(曲名・種類・公開日など)。一覧から消えた動画も、記録の読み解きに要るので消さずに残す
const videosFile = new URL("videos.json", DAILY_DIR);
const videoIndex = await readJson(videosFile, {});
for (const v of listed) videoIndex[v.id] = { ...videoIndex[v.id], ...v, lastSeen: date };
await writeFile(videosFile, "{\n" + Object.entries(videoIndex).map(([id, v]) => JSON.stringify(id) + ":" + JSON.stringify(v)).join(",\n") + "\n}\n");

data.snapshots = data.snapshots.slice(-KEEP_DAYS);
data.videos = listed;
data.updatedAt = now.toISOString();

await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeState(data);

// ページが読むファイル(曲ごとにまとめ、合計回数とその日の回数だけを載せる)
const site = buildSite(data);
const bytes = await writeSite(site);
console.log(`data.json: ${site.songs.length}曲、${bytes} バイト`);
console.log(`${date}: ${listed.length}本を記録しました(記録 ${data.snapshots.length}日分)`);
