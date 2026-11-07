// デモ動画のプレビュー：台本 v0.3 の時間配分で、画面・字幕・声の文を1枚ずつ組んで ffmpeg でつなぐ。
// 実行：node tools/demo-video/frames.mjs [出力先]（先に shots.mjs を同じ出力先で。Playwright と ffmpeg が要る）
// 本番の編集では、FRAMES の画像を実機の録画に置き換え、声のファイルを重ねる。
import { chromium } from "playwright";
import path from "node:path"; import { fileURLToPath } from "node:url";
import fs from "node:fs"; import { execSync } from "node:child_process";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const S = process.argv[2] || path.join(repo, "tools/demo-video/out");
fs.mkdirSync(`${S}/frames`, { recursive: true });
const D = path.join(repo, "docs/demo");
const sh = (n) => `file://${S}/shots/${n}`;
const doc = (n) => `file://${D}/${n}`;
// 台本 v0.3 の時間配分。dur は秒。sub は字幕、nar は声（🎙️ 葵依さん／🕊️ 鳩／📱 実機の音）
const FRAMES = [
  { name: "title", dur: 3, full: doc("title.png") },
  { name: "0:00 言い切り", dur: 7, imgs: [[sh("s1-display.png"), 760]], sub: "くるっくー\n認知症の父が、今日を何度でも確かめられるように", nar: "🎙️ くるっくーは、認知症の父が今日を何度でも確かめられるよう、日付や予定、家族の知らせを届ける電子伝書鳩です。" },
  { name: "0:10 いつもの朝①", dur: 10, imgs: [[sh("sb-board.png"), 640]], sub: "これまでの毎朝（実際に使っているホワイトボード）", nar: "🎙️ 毎朝、天気を調べて、父と家族の予定をホワイトボードに書いていました。新聞を置かれると消えて、書き直し。父は何度も確かめます。忘れることより、まわりの反応のほうがつらいんじゃないかと思いました。", note: "※ここは絵コンテ。実際はホワイトボードに書く手元を撮る（V02）" },
  { name: "0:20 いつもの朝②", dur: 15, imgs: [[sh("s3-morning.png"), 760]], sub: "忘れても、見れば今日がある\n日付・天気・予定は自動で表示", nar: "🕊️ いまは、日付も天気も予定も、ここに出しておきます。何度でも、今日を確かめられます。" },
  { name: "0:35 家族からの知らせ", dur: 8, imgs: [[sh("s4-phone-form.png"), 800], [sh("s1-display.png"), 520]], sub: "家族のスマホ → 父の部屋の端末へ", nar: "（スマホで「買い物に行ってきます。12時に戻ります」を入れて「音で知らせる」→「届ける」）", note: "※実際は肩越しの1カット（V04）。音はここから" },
  { name: "0:43 知らせが届く", dur: 12, imgs: [[sh("s4-phone-sent.png"), 560], [sh("s4-tablet-msg.png"), 760]], sub: "「くるっくー。はとやまです。お母さんから、お知らせです。\n買い物に行ってきます。12時に戻ります」", nar: "📱 チャイム → 読み上げ（この間、ナレーションは重ねない）", chime: true },
  { name: "0:55 知らせは残る", dur: 10, imgs: [[sh("s4-tablet-msg.png"), 760]], sub: "忘れても、知らせは残る", nar: "🎙️ 家族の外出も、父にとっては大事な予定です。" },
  { name: "1:05 知らせは残る", dur: 10, imgs: [[sh("s4-tablet-msg.png"), 760]], sub: "忘れても、知らせは残る", nar: "🕊️ 音で知らせたら、あとは静かに置いておきます。忘れても、もう一度見れば大丈夫。" },
  { name: "1:15 いざというとき", dur: 17, imgs: [[sh("s5-rescue-top.png"), 820]], sub: "もし迷っても、すぐに出せる\n※架空の人物・データです", nar: "🎙️ 父が家に戻らなかったとき、翌日も帰らなければ、写真と特徴をまとめたものを作ろうと思っていました。でも手元の写真は、たまたまあったデイのプリントだけ。身長も分かりませんでした。", note: "※顔写真は実機で登録済み（ここでは未登録）" },
  { name: "1:32 いざというとき", dur: 18, imgs: [[sh("s5-card-a.png"), 820], [sh("s5-card-b.png"), 820]], sub: "見せる・読み上げる・送る\n※架空の人物・データです", nar: "🎙️ くるっくーなら、慌てて作らなくていい。いつも一番上のこのボタンに、写真も身長も、よく着る服も、ふだんから準備しておけます。" },
  { name: "1:50 日々を振り返る①", dur: 10, imgs: [[sh("s6-notes.png"), 820]], sub: "忘れても、日々は残る\n① 材料：家族のひとこと・写真と、記録の数字", nar: "🕊️ 忘れても、日々は残ります。" },
  { name: "2:00 日々を振り返る②", dur: 20, imgs: [[sh("s6-paper.png"), 860]], sub: "② Claude が書いた見出しと記事　デモ用の架空データ\n※時間を短縮しています", nar: "🎙️ 月末には、鳩が運んだ知らせを一枚の新聞に。数字は記録を集計し、Claude が見出しと記事を書きます。", note: "※紙面の文章はプレビュー用の仮の文。実際は豆田家の10月号" },
  { name: "2:20 Claude とつくった", dur: 25, imgs: [[doc("skill-before-after.png"), 760]], dark: true, sub: "Claude Code が開発の中心　自作Skill：WCAG・JIS を根拠に画面を見直す\n前：ごはん・お薬も、終わった予定も、ぜんぶ並ぶ／後：いまの予定だけ、太く大きく", nar: "🎙️ プログラミングは、ほぼ初心者です。仕様書から Claude Code と作り、インタビューで実体験を仕様にしました。自分で作った Skill で、規格を根拠に父の画面を見直し、文字の大きさと情報量を変えて、実機で確かめています。すべて、この1週間で作りました。", note: "※実際は Claude Code の画面録画（V07）→ この画像 → 決定ログ" },
  { name: "2:45 オチ", dur: 7, imgs: [[sh("s8-poke.png"), 760]], sub: "くるっくー　家族の知らせと日々を届ける鳩", nar: "📱 鳴き声 → 🕊️ ……くるっくー。" },
  { name: "2:52 締め", dur: 6, full: doc("ending-breathe.png") },
];
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function html(f) {
  const bg = f.dark ? "#1f2a24" : "#e9edf1", fg = f.dark ? "#e9edf1" : "#14181c";
  const body = f.full ? `<img class="full" src="${f.full}">`
    : `<div class="stage">${f.imgs.map(([src, h]) => `<img src="${src}" style="height:${h}px">`).join("")}</div>`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
    html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:${bg};color:${fg};font-family:"IPAPGothic","IPAGothic",sans-serif}
    .full{width:1920px;height:1080px;object-fit:cover;display:block}
    .stage{position:absolute;inset:0 0 230px 0;display:flex;align-items:center;justify-content:center;gap:48px}
    .stage img{max-width:1700px;object-fit:contain;border-radius:14px;box-shadow:0 8px 40px rgb(0 0 0 / .18)}
    .cap{position:absolute;left:0;right:0;bottom:0;height:230px;background:rgb(20 24 28 / .88);color:#fff;padding:22px 60px;box-sizing:border-box;display:grid;align-content:start;gap:10px}
    .sub{font-size:40px;font-weight:700;line-height:1.3;white-space:pre-line}
    .nar{font-size:26px;line-height:1.4;color:#d9dde2}
    .pill{position:absolute;left:24px;top:20px;background:rgb(20 24 28 / .75);color:#fff;font-size:24px;padding:6px 14px;border-radius:999px}
    .note{position:absolute;right:24px;top:20px;background:#a3362b;color:#fff;font-size:22px;padding:6px 14px;border-radius:8px}
  </style></head><body>${body}
  ${f.full ? "" : `<div class="cap"><div class="sub">${esc(f.sub)}</div><div class="nar">${esc(f.nar)}</div></div>`}
  <div class="pill">${esc(f.name)}　プレビュー（仮の素材）</div>${f.note ? `<div class="note">${esc(f.note)}</div>` : ""}
  </body></html>`;
}
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
let t = 0, chimeAt = null; const lines = [];
for (const [i, f] of FRAMES.entries()) {
  const file = `${S}/frames/f${String(i).padStart(2, "0")}.png`;
  fs.writeFileSync(`${S}/frames/f${i}.html`, html(f));
  await page.goto(`file://${S}/frames/f${i}.html`); await page.waitForTimeout(150);
  await page.screenshot({ path: file });
  if (f.chime) chimeAt = t + 1;
  lines.push(`file '${file}'`, `duration ${f.dur}`); t += f.dur;
}
lines.push(`file '${S}/frames/f${String(FRAMES.length - 1).padStart(2, "0")}.png'`);
fs.writeFileSync(`${S}/concat.txt`, lines.join("\n") + "\n");
await browser.close();
console.log("total seconds:", t, "chime at", chimeAt);
const chime = path.join(repo, "app/sounds/pigeon_clock.wav");
execSync(`ffmpeg -y -loglevel error -f concat -safe 0 -i ${S}/concat.txt -f lavfi -i anullsrc=r=48000:cl=stereo -i "${chime}" ` +
  `-filter_complex "[2:a]adelay=${chimeAt * 1000}|${chimeAt * 1000},volume=0.9[c];[1:a][c]amix=inputs=2:duration=first:normalize=0[a]" ` +
  `-map 0:v -map "[a]" -t ${t} -r 30 -pix_fmt yuv420p -c:v libx264 -preset veryfast -crf 20 -c:a aac -b:a 128k -movflags +faststart ${S}/kurukku-preview.mp4`, { stdio: "inherit" });
console.log(execSync(`ffprobe -v error -show_entries format=duration:stream=width,height -of default=nw=1 ${S}/kurukku-preview.mp4`).toString());
console.log(fs.statSync(`${S}/kurukku-preview.mp4`).size, "bytes");
