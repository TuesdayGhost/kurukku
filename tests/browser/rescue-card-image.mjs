// レスキューカードの共有画像を、長い文章・服6枚・写真なしなどのデータで描いて JPEG に書き出す。
// 文字の省略や縮小をせず、全文と服の写真すべてが入り、下端が切れないことを目で確かめるためのもの。
// 自動テスト（node --test）には入れない。実行には Playwright と Chromium が要る：
//   npm i -D playwright && npx playwright install chromium
//   node tests/browser/rescue-card-image.mjs 出力先のフォルダ
// 画像の写真には docs/demo の PNG を代わりに使う。データはすべて架空。
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = process.argv[2] || path.join(repo, "tests/browser/out");
fs.mkdirSync(out, { recursive: true });

const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  const f = p.startsWith("/demo/") ? path.join(repo, "docs/demo", p.slice(6)) : path.join(repo, "app", p === "/" ? "index.html" : p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": { ".html": "text/html", ".js": "text/javascript", ".png": "image/png" }[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const port = srv.address().port;

const fill = (s, n) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
const maxProfile = {
  full_name: fill("豆田 鳩蔵", 40), birth_date: "1948-05-01", height_cm: 165, height_approx: true, height_measured_on: "2026-11-01",
  weight_kg: 58, weight_approx: true, weight_measured_on: "2026-10-15", shoe_cm: 25.5, shoe_approx: true, shoe_measured_on: "2026-09-01",
  features: fill("白髪の短髪で黒縁の眼鏡。右足を引きずる。", 300), belongings: fill("黒い手提げかばん、木の杖、緑のタオル。", 300),
  notes: fill("耳が遠いので正面からゆっくり話しかけてください。", 400), address: fill("東京都千代田区千代田一丁目一番地一号", 120),
  face_photo_taken_on: "2026-10-20", updated_at: "2026-11-05T01:00:00Z",
};
const maxClothes = Array.from({ length: 6 }, (_, i) => ({ note: fill(`服${i + 1}のひとことを六十文字まで書けるので長く書いた場合。`, 60) }));
const cases = [
  ["card-max", maxProfile, maxClothes, { face: true, photos: true, withAddress: true }],
  ["card-min", { full_name: "豆田 鳩蔵", height_cm: 165 }, [], { face: false, photos: false, withAddress: false }],
  ["card-text-only", maxProfile, maxClothes.slice(0, 3), { face: false, photos: false, withAddress: false }],
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
await page.goto(`http://localhost:${port}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
for (const [name, profile, clothes, o] of cases) {
  const b64 = await page.evaluate(async ({ profile, clothes, o }) => {
    const R = await import("/rescue.js");
    const toUrl = async (n) => URL.createObjectURL(await (await fetch(`/demo/${n}`)).blob());
    const blob = await R.cardImage({ profile, clothes, todayStr: "2026-11-05", withAddress: o.withAddress,
      faceUrl: o.face ? await toUrl("skill-after.png") : null,
      clothesUrls: o.photos ? await Promise.all(clothes.map(() => toUrl("title.png"))) : [],
      font: '"Zen Kaku Gothic New", "Hiragino Sans", "Noto Sans JP", sans-serif' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (const b of buf) s += String.fromCharCode(b);
    return btoa(s);
  }, { profile, clothes, o });
  const file = path.join(out, `${name}.jpg`);
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
  const [w, h] = await page.evaluate((b64) => new Promise((r) => { const i = new Image(); i.onload = () => r([i.width, i.height]); i.src = "data:image/jpeg;base64," + b64; }), b64);
  console.log(`${name}: ${w}x${h} → ${file}`);
}
await browser.close();
srv.close();
