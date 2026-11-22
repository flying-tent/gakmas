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
