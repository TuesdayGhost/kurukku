# デモ動画の組み立て（プレビューと本番編集）

11/6 に作ったプレビュー（2:58）の作り方。本番の編集もこの流れで、素材だけ実機の録画に差し替える。

1. `node tools/demo-video/shots.mjs out` …… 偽の接続先で本物のアプリ画面を撮る（豆田家ふうの架空データ。本番のサーバーにはつながない）
2. `node tools/demo-video/frames.mjs out` …… 台本 v0.3 の時間配分で、画面＋字幕＋声の文を 1920×1080 の画像に組み、ffmpeg でつないで `out/kurukku-preview.mp4` を作る

- 要るもの：Playwright（`npm i -D playwright && npx playwright install chromium`）、ffmpeg、日本語フォント（IPAゴシック等）
- CDN に出られない環境では、supabase-js の ESM 束を用意して `SUPABASE_ESM=path node tools/demo-video/shots.mjs` のように渡す
- 本番の素材の名前と撮り方：`docs/demo/shot-list.md`。撮った動画・声はリポジトリに入れない
