// edit2.json の overlays（吹き出し・大きな言葉・ラベル）を透明 PNG のコマ列にする。同じ指定は作り直さない。
import { chromium } from "playwright"; import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(repo, "tools/demo-video/out/ov"); fs.mkdirSync(OUT, { recursive: true }); const FPS = 30;
const E = JSON.parse(fs.readFileSync(path.join(repo, "tools/demo-video", process.argv[2] || "edit2.json"), "utf8"));
export const ovId = (o) => crypto.createHash("md5").update(JSON.stringify({ ...o, at: 0 })).digest("hex").slice(0, 10);
const srv = http.createServer((req, res) => { const p = decodeURIComponent(req.url.split("?")[0]); const f = path.join(repo, p); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": f.endsWith(".html") ? "text/html" : f.endsWith(".js") ? "text/javascript" : "application/octet-stream" }); fs.createReadStream(f).pipe(res); }).listen(0);
const port = srv.address().port; const browser = await chromium.launch();
for (const seg of E.segments) for (const o of seg.overlays || []) {
  const id = ovId(o); const dir = path.join(OUT, id); if (fs.existsSync(path.join(dir, "done"))) continue;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const w = o.w || 1920, h = o.h || 1080; const page = await browser.newPage({ viewport: { width: w, height: h } });
  const q = new URLSearchParams({ ...o, dur: String(o.dur) }); for (const k of ["at", "x", "y", "w", "h"]) q.delete(k);
  await page.goto(`http://localhost:${port}/tools/demo-video/inserts/overlay.html?${q}`); await page.waitForFunction(() => window.ready === true);
  const n = Math.round(o.dur * FPS);
  for (let i = 0; i < n; i++) { await page.evaluate((t) => window.render(t), i / FPS); await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, "0")}.png`), omitBackground: true }); }
  fs.writeFileSync(path.join(dir, "done"), ""); await page.close(); console.log(`overlay ${id} ${o.kind || "caption"} ${o.dur}s: ${(o.text || "").slice(0, 24)}`);
}
await browser.close(); srv.close();
