// 鳩の吹き出し（合成音声のセリフ）を、透明背景の PNG のコマ列にする。assemble.mjs が bubble で重ねる。
// 実行：node tools/demo-video/render-bubbles.mjs
import { chromium } from "playwright"; import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(repo, "tools/demo-video/out/bubbles"); const FPS = 30;
const LINES = {
  A: ["いまは、日付も天気も予定も、ここに出しておきます。何度でも、今日を確かめられます。", 8.0],
  B: ["音で知らせたら、あとは静かに置いておきます。忘れても、もう一度見れば大丈夫。", 8.0],
  C: ["忘れても、日々は残ります。", 3.0],
  D: ["……くるっくー。", 2.0],
};
const srv = http.createServer((req, res) => { const p = decodeURIComponent(req.url.split("?")[0]); const f = path.join(repo, p); if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": f.endsWith(".html") ? "text/html" : "text/javascript" }); fs.createReadStream(f).pipe(res); }).listen(0);
const port = srv.address().port; const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 260 } });
for (const [k, [text, dur]] of Object.entries(LINES)) {
  const dir = path.join(OUT, k); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  await page.goto(`http://localhost:${port}/tools/demo-video/inserts/bubble.html?text=${encodeURIComponent(text)}&dur=${dur}`);
  await page.waitForFunction(() => window.ready === true);
  const n = Math.round(dur * FPS);
  for (let i = 0; i < n; i++) { await page.evaluate((t) => window.render(t), i / FPS); await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, "0")}.png`), omitBackground: true }); }
  console.log(`bubble ${k}: ${dur}s, ${n} frames`);
}
await browser.close(); srv.close();
