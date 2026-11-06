# デモ動画の組み立て（プレビューと本番編集）

11/6 に作ったプレビュー（2:58）の作り方。本番の編集もこの流れで、素材だけ実機の録画に差し替える。

1. `node tools/demo-video/shots.mjs out` …… 偽の接続先で本物のアプリ画面を撮る（豆田家ふうの架空データ。本番のサーバーにはつながない）
2. `node tools/demo-video/frames.mjs out` …… 台本 v0.3 の時間配分で、画面＋字幕＋声の文を 1920×1080 の画像に組み、ffmpeg でつないで `out/kurukku-preview.mp4` を作る

- 要るもの：Playwright（`npm i -D playwright && npx playwright install chromium`）、ffmpeg、日本語フォント（IPAゴシック等）
- CDN に出られない環境では、supabase-js の ESM 束を用意して `SUPABASE_ESM=path node tools/demo-video/shots.mjs` のように渡す
- 本番の素材の名前と撮り方：`docs/demo/shot-list.md`。撮った動画・声はリポジトリに入れない

## 差し込み（11/6 作成。アンバサダーの「10のコツ」から 4 つ）

`tools/demo-video/inserts/` の HTML を `render-inserts.mjs` が 30fps で1コマずつ描いて mp4 にする。

| ファイル | 中身 | 長さ | 使う場面 |
| --- | --- | --- | --- |
| `flight.html` | 家族のスマホから、鳩が放物線で手紙を運び、父の部屋と居間の端末に同じ知らせが届く（構成図のアニメ） | 6秒 | 0:35 知らせの冒頭 |
| `countup.html` | 鳩月報「今月の記録」のタイルの数字がカウントアップ | 5秒 | 2:00 紙面のあと |
| `commits.html` | git log のコミット履歴が日ごとに積み上がる（本物。`out/commits.json` から） | 8秒 | 2:20 Claude の場面 |
| `slider.html` | Skill で見直す前と後の分割スライダー | 6秒 | 2:20 の続き |

作り方：
```
TZ=Asia/Tokyo git log --reverse --format='%ad|%s' --date=format-local:'%m/%d|%H:%M' > /tmp/log.txt  # → out/commits.json に {day,time,msg} の配列として保存
node tools/demo-video/render-inserts.mjs            # 4つとも。名前を渡せばその分だけ
```
出力の `out/` はリポジトリに入れない（`.gitignore`）。

## 本番の組み立て（11/6 用意。素材を入れ替えるだけ）

```
node tools/demo-video/render-inserts.mjs                 # 差し込み4本（初回だけ）
node tools/demo-video/assemble.mjs <素材フォルダ> [出力mp4] # edit.json の編集表どおりにつなぐ
```
- 素材フォルダには `docs/demo/shot-list.md` の名前で動画と声を入れる（`N2_take2.wav` のように take 番号がついていれば、名前順で最初のものを使う）
- `edit.json`：区間ごとの素材・切り出し秒・長さ・字幕・声の開始秒。合計時間は実行時に出る。足りない素材は地の色で埋めて続行する
- 字幕は ASS で焼き込む（書体 Zen Kaku Gothic New。無ければ端末の日本語書体）。同じ内容の `.srt` も横に出す
- 11/6 に仮の素材（静止画と無音）で最後まで通して 2:51 を確認
