# gakmas
学マスのもろもろの計算ツールです

## MV再生回数(mv.html)

初星学園チャンネルの楽曲MVの再生回数を GitHub Actions(`.github/workflows/update.yml`)が毎日 日本時間0:17ごろに取得し、`data/data.json` に記録します。`mv.html` はそのファイルを読み、前の記録との差を前日比として表示します。

- APIキー:リポジトリの Secrets に `YT_API_KEY` として登録
- 公開:Settings → Pages → Source を「GitHub Actions」にする(このワークフローがサイト全体を公開します)
- 初回:Actions タブ →「再生回数を記録して公開」→ Run workflow
- 表示確認:`mv.html?demo` でダミー値を表示
- アイドルの色や歌唱者判定の手動修正:`mv.html` の `IDOLS` と `OVERRIDES`
