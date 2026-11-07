// 場面5用：アプリの cardImage（実際の共有画像の生成処理）で、豆田家のレスキューカードの画像を作る。写真はドライブの photo から
import { chromium } from "playwright"; import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."); const PHOTOS = process.env.PHOTOS; const OUT = path.join(repo, "tools/demo-video/out/ui");
const srv = http.createServer((req, res) => { const p = decodeURIComponent(req.url.split("?")[0]); const f = p.startsWith("/photo/") ? path.join(PHOTOS, p.slice(7)) : path.join(repo, "app", p === "/" ? "index.html" : p); if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": { ".html": "text/html", ".js": "text/javascript", ".jpg": "image/jpeg" }[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res); }).listen(0);
const port = srv.address().port; const browser = await chromium.launch(); const page = await browser.newPage();
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
await page.goto(`http://localhost:${port}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
const profile = { full_name: "豆田 鳩蔵", birth_date: "1948-05-01", height_cm: 165, height_approx: true, height_measured_on: "2026-11-01", weight_kg: 58, weight_approx: true, weight_measured_on: "2026-10-15", shoe_cm: 25.5,
  features: "白髪の短髪。黒縁の眼鏡。右足を少し引きずって歩く。", belongings: "黒い手提げかばん、杖。", notes: "耳が少し遠いので、正面からゆっくり話しかけてください。", face_photo_taken_on: "2026-11-05", updated_at: "2026-11-07T01:00:00Z" };
const clothes = [["139647490_1793864771157282.jpg", "グレーのズボン"], ["723604175_1793864910729617.jpg", "茶色の帽子"], ["766653395_1793865019437945.jpg", "紺色のジャンパー"], ["947200069_1793864769219192.jpg", "水色のシャツ"], ["1029378798_1793864693816338.jpg", "ベージュのカーディガン"], ["100968427_1793886273994058.jpg", "カーキのジャケット"]];
const b64 = await page.evaluate(async ({ profile, clothes }) => {
  const R = await import("/rescue.js"); const toUrl = async (n) => URL.createObjectURL(await (await fetch(`/photo/${n}`)).blob());
  const blob = await R.cardImage({ profile, clothes: clothes.map(([, note]) => ({ note })), todayStr: "2026-11-07", withAddress: false, faceUrl: await toUrl("377406603_1793864356093162.jpg"), clothesUrls: await Promise.all(clothes.map(([f]) => toUrl(f))), font: '"Zen Kaku Gothic New", "Hiragino Sans", "Noto Sans JP", sans-serif' });
  const buf = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (const b of buf) s += String.fromCharCode(b); return btoa(s);
}, { profile, clothes });
fs.writeFileSync(path.join(OUT, "card.jpg"), Buffer.from(b64, "base64")); console.log("card.jpg", Buffer.from(b64, "base64").length);
await browser.close(); srv.close();
