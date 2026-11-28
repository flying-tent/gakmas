// アクセス解析(Google アナリティクス 4)
// - GA_ID に GA4 の測定ID(G-から始まる)を入れると計測を始める。空のときは何も送らない
// - 各ページの <head> で読み込む(ページの中のスクリプトより先に gaTrack を用意するため、async にしない)
// - ページの中の操作は gaTrack("イベント名", { パラメータ }) で送る(週次レポート scripts/weekly-report.mjs で集計する)
// - 手元で開いたとき(localhost・file:)と、ダミー表示(?demo)のときは送らない
// - 計測していることは privacy.html(アクセス解析について)に書いている。送る内容を変えたらそちらも直す
(() => {
  const GA_ID = "";
  const local = location.protocol === "file:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const demo = new URLSearchParams(location.search).has("demo");
  const enabled = Boolean(GA_ID) && !local && !demo;
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gaTrack = (name, params = {}) => { if (enabled) gtag("event", name, params); };
  if (!enabled) return;
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
  document.head.append(s);
  gtag("js", new Date());
  // 広告用の機能(Google シグナル・広告のカスタマイズ)は使わない
  gtag("config", GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
})();
