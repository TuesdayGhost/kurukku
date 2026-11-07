// デモ動画のプレビュー用：偽の接続先で本物のアプリ画面を撮る（豆田家ふうの架空データ）。
// 実行：node tools/demo-video/shots.mjs [出力先]（Playwright が要る）。本番のサーバーには一切つながない。
import { chromium } from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = process.argv[2] || path.join(repo, "tools/demo-video/out/shots");
fs.mkdirSync(OUT, { recursive: true });
// CDN に出られない環境では、supabase-js の ESM 束を SUPABASE_ESM に置いて差し替える
const SUPABASE_ESM = process.env.SUPABASE_ESM;
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  const f = path.join(repo, "app", p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/json" }[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(4180);

const JST = (s) => new Date(`${s}+09:00`);
const hh = { id: "h1", name: "豆田家", timezone: "Asia/Tokyo", pigeon_name: "はとやま", night_start: "21:00:00", night_end: "06:00:00", chime_kind: "pigeon_clock", is_demo: true, read_button_display: false, read_button_living: true, weather_label: "東京都千代田区", weather_lat: 35.694, weather_lon: 139.7536 };
const people = [
  { id: "dad", household_id: "h1", name: "お父さん", is_patient: true, sort_order: 0, created_at: "2026-10-01T00:00:00Z" },
  { id: "mom", household_id: "h1", name: "お母さん", is_patient: false, sort_order: 1, created_at: "2026-10-01T00:00:00Z" },
  { id: "me", household_id: "h1", name: "はと子", is_patient: false, sort_order: 2, created_at: "2026-10-01T00:00:00Z" },
];
const wk = (id, person_id, title, start, nf, nu, extra = {}) => ({ id, household_id: "h1", person_id, title, kind: "weekly", weekdays: [0, 1, 2, 3, 4, 5, 6], valid_from: "2026-10-01", start_time: start, notify_from: nf, notify_until: nu, notify_sound: true, show_on_home: false, ...extra });
const schedules = [
  wk("s1", "dad", "朝ごはん", "07:30:00", "07:20:00", "07:35:00"), wk("s2", "dad", "お薬", "08:00:00", "07:55:00", "08:10:00"),
  wk("s3", "dad", "お昼ごはん", "12:00:00", "11:50:00", "12:05:00"), wk("s4", "dad", "夕ごはん", "18:30:00", "18:20:00", "18:35:00"),
  { id: "s5", household_id: "h1", person_id: "dad", title: "デイ", kind: "weekly", weekdays: [1, 4], valid_from: "2026-10-01", start_time: "09:00:00", end_time: "17:00:00", notify_from: "08:50:00", notify_until: "09:05:00", notify_sound: true, show_on_home: true },
  { id: "s6", household_id: "h1", person_id: "mom", title: "買い物", kind: "once", on_date: "2026-11-05", start_time: "15:00:00", end_time: "16:30:00", notify_sound: true, show_on_home: true },
  { id: "s7", household_id: "h1", person_id: "me", title: "仕事", kind: "once", on_date: "2026-11-05", start_time: "09:00:00", end_time: "18:00:00", notify_sound: true, show_on_home: true },
];
let messages = [];
const notes = [
  { id: "n1", household_id: "h1", on_date: "2026-10-29", body: "デイで床屋さん。さっぱりして帰ってきた", photo_path: null, use_in_gazette: true, created_at: "2026-10-29T10:00:00Z" },
  { id: "n2", household_id: "h1", on_date: "2026-10-19", body: "芋煮会と運動会。おやつがおいしかったらしい", photo_path: null, use_in_gazette: true, created_at: "2026-10-19T10:00:00Z" },
  { id: "n3", household_id: "h1", on_date: "2026-10-12", body: "はと子、仕事で21時40分に帰宅。鳩が一番遅い戻りを記録", photo_path: null, use_in_gazette: true, created_at: "2026-10-12T13:00:00Z" },
];
const gazette = {
  id: "g1", household_id: "h1", month: "2026-10-01", issued_on: "2026-11-05",
  headline: "鳩蔵氏、芋煮会に出陣", subheadline: "デイ、10月は予定9回。本紙独占",
  articles: [
    { title: "芋煮会と運動会、同日開催", body: "10月19日、デイの行事に芋煮会と運動会が並んだ。家族メモによれば「おやつがおいしかったらしい」。本紙は現場に入れず、伝聞で報じる。" },
    { title: "はと子氏、21時40分に帰還", body: "10月の最も遅い戻りは16日の21時40分。仕事の予定は月21回にのぼり、鳩は「お疲れさま」とだけ言った。" },
    { title: "鳩、42回つつかれる", body: "今月、右下の鳩は42回つつかれた。返事は「ぽぽ……」が最多（鳩調べ）。苦情は受け付けていない。" },
  ],
  photo_path: null, stats: { month: "2026-10", pigeon_tapped: 42, messages_sent: 7, notices_shown: 93, notes: 3, photos: 0, schedules: [
    { person: "お父さん", is_patient: true, title: "デイ", planned_times: 9 }, { person: "お父さん", is_patient: true, title: "朝ごはん", planned_times: 31 },
    { person: "はと子", is_patient: false, title: "仕事", planned_times: 21, latest_end: "21:40" }, { person: "お母さん", is_patient: false, title: "買い物", planned_times: 4 } ] },
  material: {}, model: "claude-opus-5-5", generated_at: "2026-11-05T02:00:00Z", updated_at: "2026-11-05T02:10:00Z",
};
const rescue = { household_id: "h1", full_name: "豆田 鳩蔵", birth_date: "1948-05-01", height_cm: 165, height_approx: true, height_measured_on: "2026-11-01", weight_kg: 58, weight_approx: true, weight_measured_on: "2026-10-15", shoe_cm: 25.5,
  features: "白髪の短髪。黒縁の眼鏡。右足を少し引きずって歩く", belongings: "黒い手提げかばん、杖", notes: "耳が少し遠いので、正面からゆっくり話しかけてください", address: "東京都千代田区…", updated_at: "2026-11-05T01:00:00Z", face_photo_path: null };
const clothes = [{ id: "c1", note: "紺のジャンパー" }, { id: "c2", note: "グレーのセーター" }, { id: "c3", note: "茶色の帽子" }].map((c, i) => ({ ...c, household_id: "h1", photo_path: null, sort_order: i }));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
async function open(role, viewport, hash, fixedTime, scale = 2) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  if (SUPABASE_ESM) await page.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(SUPABASE_ESM) }));
  await page.route("wss://**", (r) => r.abort());
  await page.route("https://api.open-meteo.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ daily: { time: ["2026-11-05"], weather_code: [2], temperature_2m_max: [14], temperature_2m_min: [6], precipitation_probability_max: [20] }, current: { temperature_2m: 9 } }) }));
  const member = { user_id: "u1", household_id: "h1", role, display_name: role === "display" ? "鳩A／父の部屋" : "はと子", created_at: "2026-11-01T00:00:00Z" };
  await page.route("https://lcpkhfcsftmgkswwqrfm.supabase.co/**", (route) => {
    const u = route.request().url(); const m = route.request().method();
    const json = (b) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(b) });
    if (m === "POST" && u.includes("/rest/v1/messages")) { const b = route.request().postDataJSON(); messages.push({ id: "m" + messages.length, household_id: "h1", created_at: new Date().toISOString(), show_from: new Date(fixedTime.getTime() - 1000).toISOString(), ...b }); return json([]); }
    if (m === "POST") return json([]);
    if (u.includes("/rest/v1/members")) return json(member);
    if (u.includes("/rest/v1/households")) return json(hh);
    if (u.includes("/rest/v1/people")) return json(people);
    if (u.includes("/rest/v1/schedules")) return json(schedules);
    if (u.includes("/rest/v1/schedule_exceptions")) return json([]);
    if (u.includes("/rest/v1/messages")) return json(messages);
    if (u.includes("/rest/v1/invites")) return json([]);
    if (u.includes("/rest/v1/rescue_profiles")) return json(rescue);
    if (u.includes("/rest/v1/rescue_clothes")) return json(clothes);
    if (u.includes("/rest/v1/daily_notes")) return json(u.includes("photo_path=not.is.null") ? [] : notes);
    if (u.includes("/rest/v1/gazettes")) return json([gazette]);
    if (u.includes("/rest/v1/")) return json([]);
    return route.abort();
  });
  const session = { access_token: "x.y.z", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(fixedTime.getTime() / 1000) + 3600, user: { id: "u1", email: "hatoko@example.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-11-01T00:00:00Z" } };
  await page.addInitScript((s) => { localStorage.setItem("sb-lcpkhfcsftmgkswwqrfm-auth-token", JSON.stringify(s)); }, session);
  await page.clock.setFixedTime(fixedTime);
  await page.goto(`http://localhost:4180/${hash}`, { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: ".bottom-nav, .tap-sound { display: none !important }" });
  return page;
}
const tablet = { width: 1280, height: 800 }, phone = { width: 390, height: 844 };

// 1. 通常画面（14:05）と 3. 朝の画面（8:30）
for (const [name, t] of [["s1-display", "2026-11-05T14:05:00"], ["s3-morning", "2026-11-05T08:30:00"]]) {
  const page = await open("display", tablet, "", JST(t), 1);
  await page.waitForFunction(() => document.body.dataset.view === "display" && document.querySelector("#date")?.textContent, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}.png` }); await page.context().close();
}
// 4. 知らせ：家族のスマホの入力画面 → 届けたあとのタブレット
{
  const t = JST("2026-11-05T11:02:00");
  const ph = await open("family", phone, "#messages", t, 2);
  await ph.waitForSelector("#msg-body", { timeout: 20000 }); await ph.waitForTimeout(800);
  await ph.fill("#msg-body", "買い物に行ってきます。12時に戻ります"); await ph.check("#msg-sound");
  await ph.screenshot({ path: `${OUT}/s4-phone-form.png` });
  await ph.click("#msg-submit"); await ph.waitForTimeout(800);
  await ph.screenshot({ path: `${OUT}/s4-phone-sent.png` }); await ph.context().close();
  const tb = await open("display", tablet, "", t, 1);
  await tb.waitForFunction(() => document.querySelector("#msgs .msg"), null, { timeout: 20000 }); await tb.waitForTimeout(800);
  await tb.screenshot({ path: `${OUT}/s4-tablet-msg.png` }); await tb.context().close();
}
// 5. レスキューカード（スマホ）
{
  const t = JST("2026-11-05T11:10:00");
  const ph = await open("family", phone, "#rescue", t, 2);
  await ph.waitForFunction(() => document.querySelector("#rc-share") && !document.querySelector("#rc-share").disabled, null, { timeout: 30000 });
  await ph.screenshot({ path: `${OUT}/s5-rescue-top.png` });
  await ph.locator(".rescue-card").screenshot({ path: `${OUT}/s5-rescue-card.png` });
  await ph.context().close();
}
// 6. ひとこと一覧と鳩月報の紙面
{
  const t = JST("2026-11-05T11:20:00");
  const ph = await open("family", phone, "#notes", t, 2);
  await ph.waitForFunction(() => document.querySelectorAll("#note-list li .main").length > 0, null, { timeout: 20000 }); await ph.waitForTimeout(500);
  await ph.screenshot({ path: `${OUT}/s6-notes.png` }); await ph.context().close();
  const tb = await open("family", { width: 820, height: 1100 }, "#gazette", t, 2);
  await tb.waitForSelector(".gazette", { timeout: 20000 }); await tb.waitForTimeout(800);
  await tb.locator(".gazette").screenshot({ path: `${OUT}/s6-paper.png` });
  await tb.screenshot({ path: `${OUT}/s6-gazette-page.png` }); await tb.context().close();
}
// 8. 鳩をつつく
{
  const page = await open("display", tablet, "", JST("2026-11-05T14:06:00"), 1);
  await page.waitForFunction(() => document.body.dataset.view === "display" && document.querySelector("#date")?.textContent, null, { timeout: 20000 }); await page.waitForTimeout(1000);
  await page.click(".pigeon-btn"); await page.waitForTimeout(300);
  const shown = await page.evaluate(() => !document.getElementById("coo-bubble").hidden);
  if (!shown) await page.evaluate(() => { const b = document.getElementById("coo-bubble"); b.textContent = "くるっくー！"; b.hidden = false; });
  console.log("coo bubble via click:", shown);
  await page.screenshot({ path: `${OUT}/s8-poke.png` }); await page.context().close();
}
await browser.close(); srv.close();
console.log(fs.readdirSync(OUT).join(", "));
