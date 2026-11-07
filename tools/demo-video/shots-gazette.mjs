// 場面6用：本物の10月号（データベースの実際の行）と写真で、紙面を偽の接続先で高解像度に描く
import { chromium } from "playwright"; import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(repo, "tools/demo-video/out/ui"); fs.mkdirSync(OUT, { recursive: true });
const PHOTOS = process.env.PHOTOS;   // 芋煮会・書道の写真があるフォルダ
const G = JSON.parse(fs.readFileSync(path.join(repo, "tools/demo-video/out/gazette-2026-10.json"), "utf8"));
const srv = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html"; const f = path.join(repo, "app", p); if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/json" }[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res); }).listen(0);
const port = srv.address().port; const fixed = new Date("2026-11-07T12:12:00+09:00");
const hh = { id: "h1", name: "豆田家", timezone: "Asia/Tokyo", pigeon_name: "はとやま", is_demo: true };
const notes = G.notes.map((n, i) => ({ id: "n" + i, household_id: "h1", ...n, photo_path: n.photo ? `h1/${n.photo}` : null, created_at: n.on_date + "T10:00:00Z" }));
const gaz = { id: "g1", household_id: "h1", ...G.gazette, photo_path: `h1/${G.paperPhoto}` };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 980, height: 1400 }, deviceScaleFactor: 2, locale: "ja-JP", timezoneId: "Asia/Tokyo" }); const page = await ctx.newPage();
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
if (process.env.SUPABASE_ESM) await page.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(process.env.SUPABASE_ESM) }));
await page.route("wss://**", (r) => r.abort());
await page.route("https://lcpkhfcsftmgkswwqrfm.supabase.co/**", (route) => { const u = route.request().url(); const json = (b) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(b) });
  if (u.includes("/storage/v1/object/memories/")) { const name = decodeURIComponent(u.split("/memories/h1/")[1]); return route.fulfill({ status: 200, contentType: "image/jpeg", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(path.join(PHOTOS, name)) }); }
  if (route.request().method() === "POST") return json([]); if (u.includes("/rest/v1/members")) return json({ user_id: "u1", household_id: "h1", role: "family", display_name: "はと子" }); if (u.includes("/rest/v1/households")) return json(hh);
  if (u.includes("/rest/v1/people")) return json([{ id: "dad", name: "お父さん", is_patient: true, sort_order: 0 }, { id: "mom", name: "お母さん", is_patient: false, sort_order: 1 }, { id: "me", name: "はと子", is_patient: false, sort_order: 2 }]);
  if (u.includes("/rest/v1/daily_notes")) return json(u.includes("photo_path=not.is.null") ? notes.filter((n) => n.photo_path) : notes); if (u.includes("/rest/v1/gazettes")) return json([gaz]); if (u.includes("/rest/v1/")) return json([]); return route.abort(); });
await page.addInitScript((s) => { localStorage.setItem("sb-lcpkhfcsftmgkswwqrfm-auth-token", JSON.stringify(s)); }, { access_token: "x.y.z", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(fixed.getTime() / 1000) + 3600, user: { id: "u1", email: "a@example.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-11-01T00:00:00Z" } });
await page.clock.setFixedTime(fixed);
await page.goto(`http://localhost:${port}/#gazette`, { waitUntil: "domcontentloaded" });
await page.addStyleTag({ content: ".bottom-nav { display:none !important } .page { max-width: 940px }" });
await page.waitForSelector(".gazette img, .gazette .gz-nophoto", { timeout: 20000 }); await page.waitForTimeout(1200);
await page.locator(".gazette").screenshot({ path: path.join(OUT, "paper.png") });
const b = await page.locator(".gazette").boundingBox(); const parts = {};
for (const [k, sel] of [["head", ".gz-head"], ["sub", ".gz-sub"], ["photo", ".gz-photo"], ["articles", ".gz-articles"], ["stats", ".gz-stats"], ["a1", ".gz-article:nth-of-type(1)"], ["a2", ".gz-article:nth-of-type(2)"], ["a3", ".gz-article:nth-of-type(3)"]]) { const bb = await page.locator(sel).first().boundingBox(); if (bb) parts[k] = { x: bb.x - b.x, y: bb.y - b.y, w: bb.width, h: bb.height }; }
parts.paper = { w: b.width, h: b.height }; fs.writeFileSync(path.join(OUT, "paper-parts.json"), JSON.stringify(parts, null, 1)); console.log(parts);
await page.goto(`http://localhost:${port}/#notes`, { waitUntil: "domcontentloaded" }); await page.addStyleTag({ content: ".bottom-nav { display:none !important }" });
await page.waitForFunction(() => document.querySelectorAll("#note-list li .main").length > 2, null, { timeout: 20000 }); await page.waitForTimeout(1500);
await page.locator("#note-list").screenshot({ path: path.join(OUT, "notes-list.png") });
await browser.close(); srv.close();
