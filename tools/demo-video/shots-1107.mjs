// 場面3用：11/7 の録画と同じ内容で、本人の画面を偽の接続先で高解像度に撮り、部品（日付・曜日・天気・時計・予定の枠）ごとに切り出す
import { chromium } from "playwright"; import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(repo, "tools/demo-video/out/ui"); fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html"; const f = path.join(repo, "app", p); if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { "content-type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/json" }[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res); }).listen(0);
const port = srv.address().port;
const JST = (s) => new Date(`${s}+09:00`); const BANK = process.env.BANK === "1"; const fixed = JST(BANK ? "2026-11-07T10:12:00" : "2026-11-07T09:49:00");
const hh = { id: "h1", name: "豆田家", timezone: "Asia/Tokyo", pigeon_name: "はとやま", night_start: "21:00:00", night_end: "06:00:00", chime_kind: "pigeon_clock", is_demo: true, read_button_display: false, read_button_living: true, weather_label: "東京都千代田区", weather_lat: 35.694, weather_lon: 139.7536 };
const people = [{ id: "dad", household_id: "h1", name: "お父さん", is_patient: true, sort_order: 0 }, { id: "mom", household_id: "h1", name: "お母さん", is_patient: false, sort_order: 1 }, { id: "me", household_id: "h1", name: "はと子", is_patient: false, sort_order: 2 }];
const schedules = [
  { id: "s5", household_id: "h1", person_id: "dad", title: "デイサービス", kind: "once", on_date: "2026-11-07", start_time: "09:00:00", end_time: "17:00:00", notify_sound: true, show_on_home: true },
  { id: "s6", household_id: "h1", person_id: "mom", title: "買い物", kind: "once", on_date: "2026-11-07", start_time: "09:30:00", end_time: "12:00:00", notify_sound: true, show_on_home: true },
  { id: "s7", household_id: "h1", person_id: "me", title: "仕事", kind: "once", on_date: "2026-11-07", start_time: "12:00:00", notify_sound: true, show_on_home: true },
  ...(BANK ? [{ id: "s8", household_id: "h1", person_id: "me", title: "銀行に行ってきます", kind: "once", on_date: "2026-11-07", start_time: "10:23:00", notify_from: "10:18:00", notify_until: "10:28:00", notify_sound: true, show_on_home: true }] : []),
];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
const page = await ctx.newPage();
await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
if (process.env.SUPABASE_ESM) await page.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(process.env.SUPABASE_ESM) }));
await page.route("wss://**", (r) => r.abort());
await page.route("https://api.open-meteo.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ daily: { time: ["2026-11-07"], weather_code: [51], temperature_2m_max: [10], temperature_2m_min: [6], precipitation_probability_max: [60] }, current: { temperature_2m: 8 } }) }));
await page.route("https://lcpkhfcsftmgkswwqrfm.supabase.co/**", (route) => { const u = route.request().url(); const json = (b) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(b) });
  if (route.request().method() === "POST") return json([]); if (u.includes("/rest/v1/members")) return json({ user_id: "u1", household_id: "h1", role: "display", display_name: "鳩A" }); if (u.includes("/rest/v1/households")) return json(hh); if (u.includes("/rest/v1/people")) return json(people); if (u.includes("/rest/v1/schedules")) return json(schedules); if (u.includes("/rest/v1/")) return json([]); return route.abort(); });
await page.addInitScript((s) => { localStorage.setItem("sb-lcpkhfcsftmgkswwqrfm-auth-token", JSON.stringify(s)); }, { access_token: "x.y.z", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(fixed.getTime() / 1000) + 3600, user: { id: "u1", email: "a@example.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-11-01T00:00:00Z" } });
await page.clock.setFixedTime(fixed);
await page.goto(`http://localhost:${port}/`, { waitUntil: "domcontentloaded" });
await page.addStyleTag({ content: ".tap-sound, .status-line { visibility:hidden !important }" });
await page.waitForFunction(() => document.body.dataset.view === "display" && document.querySelector("#date")?.textContent, null, { timeout: 20000 }); await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, BANK ? "display-bank.png" : "display.png") });
if (BANK) { const b = await page.locator(".who:not(.patient):nth-of-type(3)").boundingBox(); fs.writeFileSync(path.join(OUT, "bank-box.json"), JSON.stringify(b)); console.log(b); await browser.close(); srv.close(); process.exit(0); }
const boxes = {};
for (const [name, sel] of [["greet", "#greet"], ["date", "#date"], ["wday", "#wday"], ["weather", "#weather"], ["clock", "#clock"], ["plan-dad", ".who.patient"], ["plan-mom", ".who:not(.patient):nth-of-type(2)"], ["plan-me", ".who:not(.patient):nth-of-type(3)"], ["pigeon", ".pigeon-btn"]]) {
  const el = page.locator(sel).first(); const b = await el.boundingBox(); if (!b) continue; boxes[name] = b;
  await el.screenshot({ path: path.join(OUT, `${name}.png`) });
}
fs.writeFileSync(path.join(OUT, "boxes.json"), JSON.stringify(boxes, null, 1)); console.log(boxes);
await browser.close(); srv.close();
