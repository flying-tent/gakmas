// 取得した動画(MV・音源)を曲ごとにまとめ、曲名と歌唱アイドルを読み取る
// ページ(mv.html)はこの結果を data/data.json から読むだけにして、通信量を小さく保つ

// ===================== 設定 =====================
// アイドル名(概要欄の「歌:」行やタイトルから探す)。mv.html の IDOLS と同じ名前にそろえる
export const IDOL_NAMES = [
  "花海咲季", "月村手毬", "藤田ことね", "有村麻央", "葛城リーリヤ", "倉本千奈", "紫雲清夏",
  "篠澤広", "姫崎莉波", "花海佑芽", "秦谷美鈴", "十王星南", "雨夜燕", "氷渡香名江",
];
// 音源(Topic チャンネル)の概要欄はローマ字表記のことがあるので、ローマ字でも探す(姓名どちらの順でも可)
// mv.html の ROMAJI(検索用)と同じものにそろえる
export const ROMAJI = {
  "花海咲季": ["saki", "hanami"], "月村手毬": ["temari", "tsukimura"], "藤田ことね": ["kotone", "fujita"],
  "有村麻央": ["mao", "arimura"], "葛城リーリヤ": ["lilja", "katsuragi"], "倉本千奈": ["china", "kuramoto"],
  "紫雲清夏": ["sumika", "shiun"], "篠澤広": ["hiro", "shinosawa"], "姫崎莉波": ["rinami", "himesaki"],
  "花海佑芽": ["ume", "hanami"], "秦谷美鈴": ["misuzu", "hataya"], "十王星南": ["sena", "juo"],
  "雨夜燕": ["tsubame", "amaya"], "氷渡香名江": ["kanae", "hiwatari"],
};

// 自動判定がずれた動画の手動修正: { "動画ID": ["アイドル名", ...] }
// 1人ならソロ、2人以上(または空配列)ならユニット・全体曲として扱う。まとめたどの動画IDに書いてもよい
export const OVERRIDES = {
  // "xxxxxxxxxxx": ["花海咲季"],
};
// 曲名の手動修正: { "動画ID": "曲名" }
export const TITLE_OVERRIDES = {};
// MV・音源・インストは曲名で1曲にまとめる。曲名が食い違って別の曲になったときの手動修正:
// { "まとめ先の曲名": ["別の曲名として出ている書き方", ...] }
export const SONG_ALIASES = {};
// ================================================

// 歌唱アイドルを概要欄の1行から読み取る。一覧にない名前でも「名前(CV.声優)」の1人だけならその名前を返す
export function detectIdols(singerLine) {
  const line = singerLine || "";
  const norm = line.replace(/[\s　]/g, "");
  const hits = IDOL_NAMES.filter((n) => norm.includes(n));
  if (hits.length) return hits;
  // ローマ字表記:声優名(CV.〜)を除いた部分で「名 姓」か「姓 名」を探す
  const roman = line.replace(/[（(]\s*(?:CV|ＣＶ)[^）)]*[）)]/gi, " ").toLowerCase().replace(/[^a-z]+/g, " ");
  const padded = ` ${roman.trim()} `;
  const romanHits = Object.entries(ROMAJI)
    .filter(([, [g, f]]) => padded.includes(` ${g} ${f} `) || padded.includes(` ${f} ${g} `))
    .map(([n]) => n);
  if (romanHits.length) return romanHits;
  const cv = line.match(/(?:CV|ＣＶ)/g) || [];
  const m = line.match(/^([^（(、,・]+?)\s*[（(]\s*(?:CV|ＣＶ)/);
  if (cv.length === 1 && m && /[^\x00-\x7F]/.test(m[1])) return [m[1].replace(/[\s　]/g, "")];
  return [];
}

// 音源の曲名から「(Instrumental)」や「(Game Size)」などを外す(ゲームサイズとフルサイズを同じ曲にまとめるため)
export function audioTitle(raw) {
  return raw
    .replace(/\s*[-–—]?\s*[(（\[]?\s*(game\s*size|ゲームサイズ)\s*[)）\]]?\s*$/i, "")
    .replace(/\s*[-–—]?\s*[(（\[]?\s*(instrumental|off\s*vocal|オフボーカル|カラオケ)\s*[)）\]]?\s*$/i, "")
    .replace(/\s*[-–—]?\s*[(（\[]?\s*(game\s*size|ゲームサイズ)\s*[)）\]]?\s*$/i, "")
    .trim();
}
// ソロ版の曲名「初 [氷渡香名江 Solo ver.]」を、元の全体曲の曲名「初」と、歌っているアイドルに分ける
// (ソロ版は元の曲にまとめて合計する)。アイドル名はローマ字でも読み、一覧にない名前は書いてあるまま返す
const SOLO_VER_PART = /\s*[\[［(（]\s*([^\]］)）]+?)\s*solo\s*ver\.?\s*[\]］)）]/i;
export function splitSoloVer(title) {
  const m = title.match(SOLO_VER_PART);
  if (!m) return { title, solo: null };
  const base = title.replace(SOLO_VER_PART, "").trim();
  const name = m[1].replace(/[\s　]/g, "");
  if (IDOL_NAMES.includes(name)) return { title: base, solo: name };
  const roman = ` ${m[1].toLowerCase().replace(/[^a-z]+/g, " ").trim()} `;
  const hit = Object.entries(ROMAJI).find(([, [g, f]]) => roman.includes(` ${g} ${f} `) || roman.includes(` ${f} ${g} `));
  return { title: base, solo: hit ? hit[0] : m[1].trim() };
}
// MV のタイトルから曲名を取り出す
export function cleanTitle(raw) {
  const m = raw.match(/「(.+?)」/);
  return m ? m[1] : raw.replace(/Official Music Video.*$/i, "").replace(/^初星学園\s*/, "").trim();
}
// 1曲にまとめるための曲名の比べ方(全角半角・大文字小文字・空白の違いを無視)
const normTitle = (t) => t.normalize("NFKC").toLowerCase().replace(/[\s　「」『』"“”]/g, "");
function songKey(title) {
  const k = normTitle(title);
  for (const [to, list] of Object.entries(SONG_ALIASES)) {
    const t = normTitle(to);
    if (k === t || list.some((a) => normTitle(a) === k)) return t;
  }
  return k;
}

// 表示用の歌唱者名。「(CV.声優)」を外す。アイドル名が読めた曲は名前を「・」でつなぐ
export function singerLabel(line, idols) {
  if (idols.length) return idols.join("・");
  if (!line) return "(歌唱情報なし)";
  // 音源の概要欄は「Hatsuboshi Gakuen、作曲者…」のように作家名も並ぶので、アイドル名が読めなければ「初星学園」とだけ出す
  if (/hatsuboshi\s*gakuen/i.test(line)) return "初星学園";
  return line.replace(/\s*[（(]\s*(?:CV|ＣＶ)[^）)]*[）)]/g, "").replace(/^初星学園\s*[（(]\s*(.+?)\s*[）)]$/, "$1").trim();
}

// 動画の種類:mv / vocal(歌入り音源)/ inst(インスト)
const typeOf = (v) => (v.source === "audio" ? (v.instrumental ? "inst" : "vocal") : "mv");
const TYPE_RANK = { mv: 0, vocal: 1, inst: 2 };
// 公開日時を日本時間の日付(YYYY-MM-DD)にする
const jstDate = (iso) => (iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) : null);

// 動画(合計回数 views・その日の回数 diff・新曲の印 isNew 付き)を曲ごとにまとめる
// 返す形:[{ title, idols, singer?, videos: [{ id, type, date, views, diff?, isNew? }] }]
// - videos は MV → 歌入り音源 → インストの順(先頭がサムネイル・リンクの代表)。ゲームサイズの音源は game: true、
//   ソロ版の音源は solo: "歌っているアイドル"(元の全体曲にまとめて合計する)
// - singer は、アイドル名を「・」でつないだものと違うときだけ付ける(「初星学園」など)
export function groupSongs(videos) {
  const groups = new Map();
  for (const v of videos) {
    const type = typeOf(v);
    const split = type === "mv" ? { title: cleanTitle(v.rawTitle), solo: null } : splitSoloVer(audioTitle(v.rawTitle));
    const title = TITLE_OVERRIDES[v.id] || split.title;
    const key = songKey(title);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...v, type, title, solo: split.solo });
  }
  return [...groups.values()].map((members) => {
    // 同じ種類の中では、元の版 → ソロ版(アイドルの並び順)、それぞれフルサイズ → ゲームサイズの順
    const soloRank = (m) => (m.solo ? 1 + (IDOL_NAMES.includes(m.solo) ? IDOL_NAMES.indexOf(m.solo) : IDOL_NAMES.length) : 0);
    members.sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type] || soloRank(a) - soloRank(b) || !!a.gameSize - !!b.gameSize);
    // 曲の歌唱アイドルは元の版から読む(ソロ版の歌い手は動画ごとの solo に出す)
    const own = members.filter((m) => !m.solo);
    const main = own[0] || members[0];
    const withSinger = own.find((m) => m.singerLine) || main;
    const idols = members.map((m) => OVERRIDES[m.id]).find(Boolean) || detectIdols(withSinger.singerLine);
    const singer = singerLabel(withSinger.singerLine, idols);
    return {
      title: TITLE_OVERRIDES[main.id] || main.title,
      idols,
      ...(singer !== idols.join("・") ? { singer } : {}),
      videos: members.map((m) => ({
        id: m.id, type: m.type, date: jstDate(m.published), views: m.views,
        ...(m.diff != null ? { diff: m.diff } : {}), ...(m.isNew ? { isNew: true } : {}), ...(m.gameSize ? { game: true } : {}), ...(m.solo ? { solo: m.solo } : {}),
      })),
    };
  });
}
