// ページ(mv.html)が読む data/data.json を、内部の記録(data/state.json)から作る
// 実行: node scripts/build-site.mjs(YouTube API は使わない。手動修正の表を変えたときなどに作り直せる)
// scripts/fetch.mjs も毎時の取得の最後にこれを使う
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { groupSongs } from "./songs.mjs";

export const DATA_FILE = new URL("../data/data.json", import.meta.url); // ページが読む
export const STATE_FILE = new URL("../data/state.json", import.meta.url); // 取得に使う内部の記録

// 内部の記録を読む。まだ無ければ、以前の形式の data.json(記録も入っていた)から引き継ぐ
// (引き継いだときは migrated: true。data.json を新しい形で上書きする前に state.json を書いておくこと)
export async function readState() {
  try { return JSON.parse(await readFile(STATE_FILE, "utf8")); } catch {}
  try {
    const old = JSON.parse(await readFile(DATA_FILE, "utf8"));
    if (Array.isArray(old.snapshots)) return Object.assign(old, { migrated: true });
  } catch {}
  return { videos: [], snapshots: [] };
}
export async function writeState(state) {
  const { migrated, ...rest } = state;
  await writeFile(STATE_FILE, JSON.stringify(rest, null, 0).replace(/\},\{/g, "},\n{") + "\n");
}

// ページが読む形:{ updatedAt, prevDate, songs: [{ title, idols, singer?, videos: [{ id, type, date, views, diff?, isNew? }] }] }
// - views:合計回数。diff:その日の回数(その日の最初の記録からの増加)
//   その日の最初の記録がない(この仕組みを入れる前の)ときは、前日の最後の記録からの増加
// - prevDate:diff の基準にした記録の日付。基準の記録がないときは null で、diff はまだ付かない
export function buildSite(state) {
  const snaps = state.snapshots || [];
  const last = snaps.at(-1) || { views: {} };
  const prev = [...snaps].reverse().find((s) => s.date < last.date) || null;
  const base = last.first || prev; // その日の回数の基準
  const ref = prev || base; // 新曲の判定の基準
  const videos = (state.videos || []).filter((v) => v.id in last.views).map((v) => {
    const views = last.views[v.id];
    // 新曲:前日の最後の記録より後に公開され、前日の記録にない動画。公開からの全回数をその日の回数にして「NEW」
    // (日付が変わる直前に公開された曲も、公開からの回数を取りこぼさない)
    const isNew = !!ref && !(v.id in ref.views) && !!v.published && v.published >= ref.at;
    // 基準の記録にない古い動画(音源を追加した初日など)は増加がわからないので出さない
    const diff = !base ? null : isNew ? views : v.id in base.views ? views - base.views[v.id] : null;
    return { ...v, views, diff, isNew };
  });
  const prevDate = !base ? null : last.first ? last.date : prev.date;
  return { updatedAt: last.at || state.updatedAt || null, prevDate, songs: groupSongs(videos) };
}

// 1曲1行にして、差分を見やすくする
export async function writeSite(site) {
  const body = '{"updatedAt":' + JSON.stringify(site.updatedAt) + ',"prevDate":' + JSON.stringify(site.prevDate) +
    ',"songs":[\n' + site.songs.map((s) => JSON.stringify(s)).join(",\n") + "\n]}\n";
  await writeFile(DATA_FILE, body);
  return Buffer.byteLength(body);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const state = await readState();
  // 以前の形式から引き継いだときは、記録が消えないように先に state.json に移す
  if (state.migrated) { await writeState(state); console.log("以前の data.json の記録を state.json に移しました"); }
  if (!(state.snapshots || []).length) {
    console.log("記録がまだないので、data.json は作りません");
  } else {
    const site = buildSite(state);
    const bytes = await writeSite(site);
    console.log(`data.json を作りました(${site.songs.length}曲、${bytes} バイト)`);
  }
}
