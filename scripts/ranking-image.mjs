// X に投稿するランキングの画像(1080×1440 の PNG)を作る
// HTML で組んで、Chrome(ヘッドレス)でスクリーンショットを撮る。外部パッケージは使わない
// - フォントはページ(mv.html)と同じ IBM Plex Sans JP。Actions では .github/workflows/post-x.yml が入れる
//   (入っていない環境では Noto Sans CJK JP などで代わりに描く)
// - アイドルの色は mv.html の IDOLS から読む(色を変えるときは mv.html だけ直せばよい)
// - Chrome の場所は環境変数 CHROME で変えられる
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL, fileURLToPath } from "node:url";

export const WIDTH = 1080;
export const HEIGHT = 1440;
const LOGO = new URL("./x-assets/logo.png", import.meta.url);
const MV_HTML = new URL("../mv.html", import.meta.url);
const FALLBACK_COLOR = "#A7AEBD"; // 歌唱アイドルがわからない曲の帯の色

// mv.html の IDOLS から { 名前: 色 } を作る
export async function idolColors() {
  const html = await readFile(MV_HTML, "utf8");
  const colors = {};
  for (const m of html.matchAll(/\{\s*name:\s*"([^"]+)"[^}]*?color:\s*"(#[0-9A-Fa-f]{3,8})"/g)) colors[m[1]] = m[2];
  return colors;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = new Intl.NumberFormat("ja-JP");

// 帯:歌唱アイドルの色を人数で縦に等分する
function barStyle(idols, colors) {
  const cs = idols.map((n) => colors[n]).filter(Boolean);
  if (!cs.length) return `background:${FALLBACK_COLOR}`;
  if (cs.length === 1) return `background:${cs[0]}`;
  const step = 100 / cs.length;
  const stops = cs.map((c, i) => `${c} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`).join(",");
  return `background:linear-gradient(to bottom,${stops})`;
}

function changeHtml(change) {
  switch (change?.type) {
    case "up": return `<span class="ch up"><i>▲</i>${change.n}</span>`;
    case "down": return `<span class="ch down"><i>▼</i>${change.n}</span>`;
    case "same": return `<span class="ch keep">→</span>`;
    case "new": return `<span class="ch new">NEW</span>`;
    default: return `<span class="ch same">－</span>`;
  }
}

const CROWN = `<svg viewBox="0 0 64 48" width="58" height="44" aria-hidden="true"><path d="M4 14l14 12L32 4l14 22 14-12-6 28H10z" fill="#F5B81C" stroke="#D99A00" stroke-width="2" stroke-linejoin="round"/><rect x="10" y="40" width="44" height="6" rx="2" fill="#E9A80E"/><circle cx="4" cy="13" r="4" fill="#F5B81C"/><circle cx="32" cy="4" r="4" fill="#F5B81C"/><circle cx="60" cy="13" r="4" fill="#F5B81C"/></svg>`;
const star = (x, y, r, color) =>
  `<path d="M${x} ${y - r}C${x + r * 0.12} ${y - r * 0.12} ${x + r * 0.12} ${y - r * 0.12} ${x + r} ${y}C${x + r * 0.12} ${y + r * 0.12} ${x + r * 0.12} ${y + r * 0.12} ${x} ${y + r}C${x - r * 0.12} ${y + r * 0.12} ${x - r * 0.12} ${y + r * 0.12} ${x - r} ${y}C${x - r * 0.12} ${y - r * 0.12} ${x - r * 0.12} ${y - r * 0.12} ${x} ${y - r}Z" fill="${color}"/>`;

// rows: [{ rank, title, singer, idols, count, change: { type: "up"|"down"|"same"|"new"|"none", n } }]
export async function rankingHtml({ label, date, rows }) {
  const colors = await idolColors();
  const logo = "data:image/png;base64," + (await readFile(LOGO)).toString("base64");
  const rowHtml = rows.map((r) => `
    <div class="row${r.rank === 1 ? " first" : ""}">
      <div class="rank"><b>${r.rank}</b><small>位</small></div>
      <div class="crown">${r.rank === 1 ? CROWN : ""}</div>
      <div class="bar" style="${barStyle(r.idols || [], colors)}"></div>
      <div class="name"><div class="t">${esc(r.title)}</div><div class="s">${esc(r.singer || "")}</div></div>
      <div class="views"><b>${fmt.format(r.count)}</b><small>回</small></div>
      <div class="change">${changeHtml(r.change)}</div>
    </div>`).join("");
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden}
  body{font-family:"IBM Plex Sans JP","Noto Sans CJK JP","Noto Sans JP",sans-serif;color:#14204A;background:#F7F9FE;position:relative;-webkit-font-smoothing:antialiased}
  .deco{position:absolute;pointer-events:none}
  .tl1{left:0;top:0;width:250px;height:200px;background:linear-gradient(135deg,#B9D3F7,#DCE9FB);clip-path:polygon(0 0,100% 0,0 100%)}
  .tl2{left:0;top:0;width:150px;height:120px;background:#A3C4F3;clip-path:polygon(0 0,100% 0,0 100%);opacity:.7}
  header{position:absolute;left:44px;top:70px;right:44px;height:190px;display:flex;align-items:center;gap:28px}
  .logo{width:170px;height:170px;border-radius:50%;background:url(${logo}) center/112% no-repeat;flex:none;box-shadow:0 6px 18px rgba(20,32,74,.18)}
  h1{font-size:60px;font-weight:700;letter-spacing:.02em;line-height:1.15;white-space:nowrap}
  .sub{font-size:25px;font-weight:500;letter-spacing:.22em;margin-top:10px;white-space:nowrap}
  .stars{position:absolute;right:8px;top:26px}
  .meta{position:absolute;left:220px;right:30px;top:280px;height:60px;display:flex;align-items:center;gap:14px}
  .meta .line{flex:1;height:3px;background:linear-gradient(90deg,rgba(91,141,223,0),#8DB3EE)}
  .chip{height:56px;padding:0 26px;border-radius:28px;display:flex;align-items:center;font-size:30px;font-weight:700;white-space:nowrap}
  .chip.label{background:#14204A;color:#fff}
  .chip.date{background:#DCE8FB;color:#14204A;font-weight:500;letter-spacing:.03em}
  .list{position:absolute;left:44px;right:34px;top:366px}
  .row{height:100px;display:flex;align-items:center;border-bottom:2px solid #DFE6F2}
  .rank{width:118px;display:flex;align-items:baseline;justify-content:flex-end;padding-right:8px;flex:none}
  .rank b{font-size:60px;font-weight:700;line-height:1}
  .rank small{font-size:26px;font-weight:700;margin-left:4px}
  .crown{width:68px;flex:none;display:flex;justify-content:center}
  .bar{width:11px;height:66px;border-radius:3px;flex:none;margin-right:26px}
  .name{flex:1;min-width:0;padding-right:18px;border-right:2px solid #DFE6F2;height:76px;display:flex;flex-direction:column;justify-content:center}
  .t{font-size:38px;font-weight:700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .s{font-size:20px;font-weight:500;color:#6B7590;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
  .views{width:232px;flex:none;text-align:right;padding-right:18px;border-right:2px solid #DFE6F2;height:76px;display:flex;align-items:center;justify-content:flex-end}
  .views b{font-size:36px;font-weight:600;font-variant-numeric:tabular-nums}
  .views small{font-size:22px;font-weight:500;margin-left:6px;color:#3D4766}
  .change{width:118px;flex:none;text-align:center}
  .ch{font-size:32px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
  .ch i{font-style:normal;font-size:24px;margin-right:4px;vertical-align:3px}
  .ch.up{color:#E5484D}.ch.down{color:#3B7BEF}.ch.keep{color:#2FA36B}.ch.same{color:#8A93A8}.ch.new{color:#D99A00;font-size:28px;letter-spacing:.04em}
  .row.first .t{font-size:42px}
  </style></head><body>
  <div class="deco tl1"></div><div class="deco tl2"></div>
  <svg class="deco stars" width="160" height="190" viewBox="0 0 160 190" aria-hidden="true">${star(92, 56, 46, "#F5CB5C")}${star(142, 112, 17, "#5B8DDF")}${star(62, 150, 30, "#8DB3EE")}</svg>
  <header><div class="logo"></div><div><h1>初星学園 音楽ランキング</h1><div class="sub">HATSUBOSHI DAILY CHART</div></div></header>
  <div class="meta"><div class="line"></div><div class="chip label">${esc(label)}</div><div class="chip date">${esc(date)}</div></div>
  <div class="list">${rowHtml}</div>
  <script>
    // 入りきらない曲名は文字を小さくし(32pxまで)、それでも入らなければ「…」で省略する(CSS)
    document.fonts.ready.then(() => {
      for (const el of document.querySelectorAll(".t")) {
        let size = parseFloat(getComputedStyle(el).fontSize);
        while (el.scrollWidth > el.clientWidth && size > 32) el.style.fontSize = (size -= 1) + "px";
      }
      document.body.dataset.ready = "1";
    });
  </script>
  </body></html>`;
}

function chromePath() {
  const candidates = [process.env.CHROME, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error("Chrome が見つかりません(環境変数 CHROME で場所を指定できます)");
  return found;
}

// HTML を PNG にする
export async function renderPng(html, outPath) {
  const dir = await mkdtemp(join(tmpdir(), "ranking-"));
  try {
    const file = join(dir, "ranking.html");
    await writeFile(file, html);
    await promisify(execFile)(chromePath(), [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
      `--window-size=${WIDTH},${HEIGHT}`, "--virtual-time-budget=5000", `--screenshot=${outPath}`, pathToFileURL(file).href,
    ], { timeout: 60_000 });
    if (!existsSync(outPath)) throw new Error("画像を作れませんでした");
    return outPath;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// 確認用:node scripts/ranking-image.mjs out.png でダミーのランキングの画像を作る
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const out = process.argv[2] || "ranking-sample.png";
  const rows = [
    ["メタモルフォーゼ", ["氷渡香名江"], 406925, { type: "same" }],
    ["Agitato", ["花海咲季", "葛城リーリヤ", "花海佑芽"], 38797, { type: "up", n: 1 }],
    ["アンバランス", ["有村麻央", "雨夜燕"], 37526, { type: "up", n: 12 }],
    ["とても長い曲名のときに文字が小さくなって最後は省略されるかの確認", ["倉本千奈"], 30000, { type: "down", n: 2 }],
    ["新曲のサンプル", ["月村手毬"], 25000, { type: "new" }],
    ["Campus mode!!", ["花海咲季", "月村手毬", "藤田ことね", "有村麻央", "葛城リーリヤ", "倉本千奈", "紫雲清夏", "篠澤広", "姫崎莉波"], 20000, { type: "down", n: 1 }],
    ["Roar", ["十王星南"], 15000, { type: "same" }],
    ["初", ["秦谷美鈴"], 12000, { type: "up", n: 3 }],
    ["Fluorite", ["篠澤広"], 9000, { type: "down", n: 4 }],
    ["光景", ["紫雲清夏"], 8000, { type: "none" }],
  ].map(([title, idols, count, change], i) => ({ rank: i + 1, title, idols, singer: idols.join("・"), count, change }));
  const html = await rankingHtml({ label: "MV", date: "2026/11/27", rows });
  console.log(await renderPng(html, fileURLToPath(new URL(out, pathToFileURL(process.cwd() + "/")))));
}
