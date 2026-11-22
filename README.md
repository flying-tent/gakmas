# gakmas
学マスのもろもろの計算ツールです

## MV再生回数(mv.html)

初星学園チャンネルの楽曲MVの再生回数を GitHub Actions(`.github/workflows/update.yml`)が毎時17分ごろに取得し、`data/data.json` に日ごとの記録として上書き保存します。`mv.html` はそのファイルを読み、前日の最後の記録との差(当日0時からの増加)を前日比として表示します。

- APIキー:リポジトリの Secrets に `YT_API_KEY` として登録
- 公開:Settings → Pages → Source を「GitHub Actions」にする(このワークフローがサイト全体を公開します)
- 初回:Actions タブ →「再生回数を記録して公開」→ Run workflow
- 表示確認:`mv.html?demo` でダミー値を表示
- アイドルの色や歌唱者判定の手動修正:`mv.html` の `IDOLS` と `OVERRIDES`
- 対象:初星学園チャンネルの「Official Music Video」(ショート除く)と、Hatsuboshi Gakuen - Topic の音源(歌入り・インスト。ver. 違い・ゲームサイズ・リミックスは除く)。同じ曲のMV・音源・インストは曲名で1曲にまとめて合計する
- 音源が Hatsuboshi Gakuen - Topic 以外(歌唱アイドル名の Topic チャンネルなど)にあるとき:`scripts/fetch.mjs` の `EXTRA_AUDIO_CHANNEL_IDS` にチャンネルIDを足す。Hatsuboshi Gakuen - Topic に同じ曲名があるものは数えない
- 曲名が食い違って別の曲に分かれたとき:`mv.html` の `SONG_ALIASES` で同じ曲としてつなぐ
- 検索:曲名・アイドル名(漢字・ひらがな・ローマ字)で絞り込める。漢字の入った新曲が出たら、`mv.html` の `SONG_READINGS` に読みを足すと、ひらがなでも探せる。アイドルの読みは `IDOLS` の `kana`(姓と名をスペースで区切る)。アイドル表示では、当てはまる曲を歌っているアイドルも出る。歌唱の表示がユニット名だけの曲は、`UNIT_MEMBERS` にメンバーを足すとアイドル名で探せる
- 表示の切り替え:検索欄の右のフィルタボタンで、期間(今日/累計)・表示(曲/アイドル)・「MVだけで集計」を開く。「MVだけで集計」をオンにすると、上の数字・ランキング・動画一覧がすべてMVだけの集計になり、MVのない曲はランキングから外れる。この設定はブラウザ(localStorage の `gakmas.mvOnly`)に覚える
