# gakmas
学マスのもろもろの計算ツールです

## MV再生回数(mv.html)

初星学園チャンネルの楽曲MVと音源の再生回数を GitHub Actions(`.github/workflows/update.yml`)が毎時7分ごろに取得し、次のファイルに保存します。

- `data/data.json`:ページ(`mv.html`)が読むファイル。スマホの通信量を小さくするため、表示に要るものだけを載せる(`scripts/build-site.mjs` が作る)
  - 形:`{ updatedAt, prevDate, songs: [{ title, idols, singer?, videos: [{ id, type, date, views, diff?, isNew? }] }] }`
  - `songs` は曲ごと(MV・音源・インストをまとめたもの)。`idols` は歌唱アイドル、`singer` は表示名がアイドル名を「・」でつないだものと違うときだけ付く(「初星学園」など)
  - `videos` は MV → 歌入り音源 → インストの順。`type` は `mv`・`vocal`・`inst`、`date` は公開日(日本時間)、`views` は合計回数、`diff` はその日の回数(前日の最後の記録からの増加=当日0時ごろからの増加)、`isNew` は新曲の印
  - 前日の記録がないときは `prevDate` が `null` で、`diff` は付かない
- `data/state.json`:取得に使う内部の記録(直近3日分の日ごとの記録と、音源の検索結果のキャッシュ)。ページは読まない
- `data/daily/YYYY-MM.json`:その月の日ごとの記録をずっと残す(あとで推移のグラフなどに使う)。1日1行で `{ date, at, views: { 動画ID: 再生回数 } }`。その日の値は毎時上書きされ、日付(日本時間)が変わる直前の値が残る
- `data/daily/videos.json`:動画IDごとの情報(曲名・種類・公開日・最後に一覧にあった日)。一覧から消えた動画も残す
- ページは最初の表示で `data/data.json` だけを読むので、記録が増えても表示は遅くならない

- APIキー:リポジトリの Secrets に `YT_API_KEY` として登録
- 公開:Settings → Pages → Source を「GitHub Actions」にする(このワークフローがサイト全体を公開します)
- 初回:Actions タブ →「再生回数を記録して公開」→ Run workflow
- 表示確認:`mv.html?demo` でダミー値を表示
- アイドルの色:`mv.html` の `IDOLS`
- 曲名・歌唱者の読み取りと、その手動修正:`scripts/songs.mjs` の `OVERRIDES`(歌唱アイドル)・`TITLE_OVERRIDES`(曲名)。アイドルを増やすときは `scripts/songs.mjs` の `IDOL_NAMES`・`ROMAJI` と、`mv.html` の `IDOLS`・`ROMAJI` の両方に足す
- 手動修正を変えて main に入れると、ワークフローが YouTube API を使わずに `data/data.json` を作り直して公開する(手元では `node scripts/build-site.mjs`)
- 対象:初星学園チャンネルの「Official Music Video」(ショート除く)と、Hatsuboshi Gakuen - Topic の音源(歌入り・インスト。ver. 違い・ゲームサイズ・リミックスは除く)。同じ曲のMV・音源・インストは曲名で1曲にまとめて合計する
- 音源が Hatsuboshi Gakuen - Topic 以外(歌唱アイドル名の Topic チャンネルなど)にあるとき:`scripts/fetch.mjs` の `EXTRA_AUDIO_CHANNEL_IDS` にチャンネルIDを足す。Hatsuboshi Gakuen - Topic に同じ曲名があるものは数えない
- 曲名が食い違って別の曲に分かれたとき:`scripts/songs.mjs` の `SONG_ALIASES` で同じ曲としてつなぐ
- 検索:曲名・アイドル名(漢字・ひらがな・ローマ字)で絞り込める。漢字の入った新曲が出たら、`mv.html` の `SONG_READINGS` に読みを足すと、ひらがなでも探せる。アイドルの読みは `IDOLS` の `kana`(姓と名をスペースで区切る)。アイドル表示では、当てはまる曲を歌っているアイドルも出る。歌唱の表示がユニット名だけの曲は、`UNIT_MEMBERS` にメンバーを足すとアイドル名で探せる
- 表示の切り替え:検索欄の右のフィルタボタンで、期間(今日/累計)・表示(曲/アイドル)・「MVだけで集計」を開く。「MVだけで集計」をオンにすると、上の数字・ランキング・動画一覧がすべてMVだけの集計になり、MVのない曲はランキングから外れる。この設定はブラウザ(localStorage の `gakmas.mvOnly`)に覚える
- PC表示:画面の幅が900px以上のときは、左に「累計」、右に「デイリー」(今日0時からの増加)のランキングを並べる。期間の切り替えは隠し、検索・表示(曲/アイドル)・「MVだけで集計」は両方の表に効く。上の数字は累計で出す。スマホでは今までどおり期間を切り替えて1つの表を出す
