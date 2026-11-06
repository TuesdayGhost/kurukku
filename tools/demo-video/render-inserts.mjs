// 差し込み動画（tools/demo-video/inserts/*.html）を1コマずつ描いて mp4 にする。
// 実行：node tools/demo-video/render-inserts.mjs [名前...]（Playwright と ffmpeg が要る）
// 先に out/commits.json を作る（README 参照）。出力は tools/demo-video/out/inserts/<名前>.mp4
import { chromium } from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import { execSync } from "node:child_process"; import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(repo, "tools/demo-video/out/inserts"); fs.mkdirSync(OUT, { recursive: true });
const FPS = 30;
const names = process.argv.slice(2).length ? process.argv.slice(2) : ["flight", "countup", "commits", "slider"];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml" };
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]); const f = path.join(repo, p);
  if (!f.startsWith(repo) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const name of names) {
  const dir = path.join(OUT, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  await page.goto(`http://localhost:${port}/tools/demo-video/inserts/${name}.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 20000 });
  const dur = await page.evaluate(() => window.DURATION);
  const n = Math.round(dur * FPS);
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => window.render(t), i / FPS);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, "0")}.png`), type: "png" });
  }
  execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${dir}/f%04d.png -pix_fmt yuv420p -c:v libx264 -preset veryfast -crf 18 ${OUT}/${name}.mp4`);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${name}: ${dur}s → ${OUT}/${name}.mp4`);
}
await browser.close(); srv.close();
