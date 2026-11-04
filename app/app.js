// くるっくー 本体
// 画面：ログイン → （家に未所属なら）参加・家の作成 → 役割ごとの画面
//   display（父の部屋）: 表示画面だけ
//   living（居間）     : 表示画面 ＋ 予定の簡単追加
//   family（家族）     : 今日・予定の追加・予定一覧・知らせ・家と端末、表示画面のプレビュー
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY, TIMEZONE } from "./config.js";
import * as S from "./schedule.js";
import * as sound from "./sound.js";
import * as W from "./weather.js";
import * as R from "./rescue.js";
import * as G from "./gazette.js";
import { icon } from "./icons.js";
import { LOGO, pigeon, WORDMARK_PERCH } from "./brand.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
const $app = document.getElementById("app");

const LIVING_IDLE_MS = 90 * 1000;      // 居間：最後の操作からこの時間で表示画面に戻る（仮置き）
const REFRESH_MS = 5 * 60 * 1000;      // 念のための定期再読込
const WEATHER_MS = 30 * 60 * 1000;     // 天気の更新間隔
const WEATHER_STALE_MS = 2 * 60 * 60 * 1000; // これより古い天気は取得時刻を目立たせる
const PRESETS_PATIENT = ["朝ごはん", "お昼ごはん", "夕ごはん", "お薬", "デイ", "お風呂"];
const PRESETS_FAMILY = ["仕事", "買い物", "病院", "リハビリ", "出かける"];

const state = {
  session: null,
  member: null,
  household: null,
  people: [], schedules: [], exceptions: [], messages: [], members: [], invites: [],
  lastSync: null, syncError: null, rt: "",
  weather: null, weatherError: null, weatherAt: 0, weatherLoc: "",
  today: S.nowParts(new Date(), TIMEZONE).date,
  view: "", lastInvite: null,
};
let draft = freshDraft();
let edit = null;   // 変更中の予定 { id, date, scope, weekdays, back }
let lastInteraction = Date.now();
const loggedNotices = new Set();

// ---------- 小さな道具 ----------
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (id) => document.getElementById(id);
function setHTML(el, html) { if (el && el._h !== html) { el.innerHTML = html; el._h = html; } }
function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* 保存できなくても動作は続ける */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (_) { /* noop */ } }
function lsKeys() { try { return Object.keys(localStorage); } catch (_) { return []; } }
let toastTimer = null;
function toast(msg, bad = false) {
  const t = $("toast");
  t.textContent = msg; t.className = bad ? "bad" : ""; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 3000);
}
function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "通信できませんでした。電波を確かめて、もう一度押してください";
  if (/Invalid login credentials/i.test(m)) return "メールアドレスかパスワードが違います";
  if (/Email not confirmed/i.test(m)) return "確認メールのリンクをまだ開いていません。メールを確認してください";
  if (/row-level security/i.test(m)) return "この端末にはその操作の権限がありません";
  return m;
}
const role = () => state.member?.role || "";
const person = (id) => state.people.find((p) => p.id === id);
const patientFirst = () => [...state.people].sort((a, b) => (b.is_patient - a.is_patient) || (a.sort_order - b.sort_order));
function jstHM(d) { return d.toLocaleTimeString("ja-JP", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }); }
function freshDraft(keepPerson) {
  return { person: keepPerson || null, when: "today", weekdays: new Set(), notify: false, saving: false };
}

// ---------- ログインとデータ ----------
async function boot() {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  sb.auth.onAuthStateChange((_event, session) => {
    const before = state.session?.user?.id;
    state.session = session;
    // この中で Supabase を直接呼ぶと固まることがあるため、次の順番で呼ぶ
    if (before !== session?.user?.id) setTimeout(loadMember, 0);
  });
  await loadMember();
  setInterval(tick, 1000);
  setInterval(refresh, REFRESH_MS);
  setInterval(() => updateWeather(), 60 * 1000);
  addEventListener("hashchange", mount);
  addEventListener("online", refresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { refresh(); if (state.view === "display") keepAwake(); }
  });
  for (const ev of ["pointerdown", "keydown", "input"]) addEventListener(ev, () => { lastInteraction = Date.now(); }, { passive: true });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && state.view === "display" && sound.isBusy()) sound.stopAll(); });
  addEventListener("pointerdown", onAnyTap, { passive: true });
}

async function loadMember() {
  if (!state.session) { state.member = null; stopRealtime(); mount(); return; }
  const { data, error } = await sb.from("members").select("*").eq("user_id", state.session.user.id).maybeSingle();
  if (error) state.syncError = errMsg(error);
  state.member = data || null;
  if (state.member) { await refresh(); startRealtime(); }
  mount();
}

let refreshing = null;
async function refresh() {
  if (!state.member) return;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const since = S.addDays(state.today, -1);
      const reqs = [
        sb.from("households").select("*").maybeSingle(),
        sb.from("people").select("*").order("sort_order").order("created_at"),
        sb.from("schedules").select("*"),
        sb.from("schedule_exceptions").select("*").gte("on_date", since),
        sb.from("messages").select("*").gte("show_until", new Date().toISOString()),
      ];
      if (role() === "family") {
        reqs.push(sb.from("members").select("*").order("created_at"));
        reqs.push(sb.from("invites").select("*").is("used_by", null).gt("expires_at", new Date().toISOString()).order("created_at"));
      }
      const res = await Promise.all(reqs);
      const bad = res.find((r) => r.error);
      if (bad) throw bad.error;
      [state.household, state.people, state.schedules, state.exceptions, state.messages] = res.slice(0, 5).map((r) => r.data);
      state.people ||= []; state.schedules ||= []; state.exceptions ||= []; state.messages ||= [];
      if (role() === "family") { state.members = res[5].data || []; state.invites = res[6].data || []; }
      state.lastSync = new Date();
      sound.setChimeKind(state.household?.chime_kind || "chime");
      updateWeather();
      state.syncError = null;
    } catch (e) {
      state.syncError = errMsg(e);
    } finally {
      refreshing = null;
    }
    fill();
    tick();
  })();
  return refreshing;
}
let refreshTimer = null;
function refreshSoon() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 300); }

let channel = null;
function startRealtime() {
  if (channel || !state.member) return;
  channel = sb.channel(`kurukku-${state.member.household_id}`);
  for (const table of ["schedules", "schedule_exceptions", "messages", "people", "households"]) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, refreshSoon);
  }
  channel.subscribe((status) => { state.rt = status; if (status === "SUBSCRIBED") refreshSoon(); });
}
function stopRealtime() { if (channel) { sb.removeChannel(channel); channel = null; } }

// ---------- 画面の切り替え ----------
function currentView() {
  if (!state.session) return "login";
  if (!state.member) return "join";
  const h = location.hash.replace("#", "");
  if (role() === "display") return "display";
  if (role() === "living") return h === "add" ? "add" : "display";
  if (h === "edit") return edit && state.schedules.some((x) => x.id === edit.id) ? "edit" : "plans";
  return ["today", "add", "plans", "messages", "notes", "gazette", "settings", "more", "display", "rescue", "rescue-edit"].includes(h) ? h : "today";
}

function mount() {
  const v = currentView();
  state.view = v;
  if (v !== "add") draft = freshDraft(draft.person);
  document.body.dataset.view = v;
  if (v === "login") $app.innerHTML = viewLogin();
  else if (v === "join") $app.innerHTML = viewJoin();
  else if (v === "display") { $app.innerHTML = viewDisplay(); keepAwake(); }
  else $app.innerHTML = viewFamily(v);
  if (v === "rescue" || v === "rescue-edit") openRescue(v);
  if (v === "notes") openNotes();
  if (v === "settings") sound.checkFiles().then((kinds) => {
    for (const k of kinds) {
      const o = document.querySelector(`#chime-kind option[value="${k.value}"]`);
      if (o) { o.disabled = !k.available; o.textContent = k.label + (k.available ? "" : "（音の準備中）"); }
    }
  });
  if (v === "gazette") openGazette();
  fill();
  tick();
}

// データが変わったときに、入力欄を消さずに一覧部分だけ書き直す
function fill() {
  const v = state.view;
  if (v === "add") { renderChips(); }
  if (v === "edit") renderEditChips();
  if (v === "today") setHTML($("today-list"), todayListHTML());
  if (v === "plans") setHTML($("plans-list"), plansListHTML());
  if (v === "messages") { setHTML($("msg-from"), msgFromChipsHTML()); setHTML($("msg-list"), msgListHTML()); }
  if (v === "settings") { setHTML($("people-list"), peopleListHTML()); setHTML($("member-list"), memberListHTML()); setHTML($("invite-list"), inviteListHTML()); }
  const hn = $("hh-name"); if (hn) hn.textContent = state.household?.name || "";
  const db = $("demo-badge"); if (db) db.hidden = !state.household?.is_demo;
  const pn = $("pigeon-name"); if (pn && !pn.dataset.touched) pn.value = pigeonName();
  const ck = $("chime-kind"); if (ck && !ck.dataset.touched) ck.value = state.household?.chime_kind || "chime";
  const ns = $("night-start"), ne = $("night-end");
  if (ns && !ns.dataset.touched) ns.value = S.hm(state.household?.night_start || "21:00");
  if (ne && !ne.dataset.touched) ne.value = S.hm(state.household?.night_end || "06:00");
  const pp = $("pigeon-preview"); if (pp) pp.textContent = pigeonName() ? `${pigeonName()}です。` : "";
  const wl = $("weather-label"); if (wl) wl.textContent = state.household?.weather_label || "未設定（天気は表示されません）";
}

// ---------- 毎秒の処理：時計・通知 ----------
function tick() {
  if (!state.member) return;
  const np = S.nowParts(new Date(), TIMEZONE);
  if (np.date !== state.today) { state.today = np.date; cleanupSounded(np.date); refreshSoon(); fill(); }
  const occ = S.occurrencesOn(state.schedules, state.exceptions, np.date);
  const active = S.activeNotices(occ, np.time);
  if (role() === "display" || role() === "living" || state.view === "display") handleNotices(active, np);
  if (state.view === "display") updateDisplay(np, occ, active);
  if (role() === "living" && state.view === "add") {
    const idle = Date.now() - lastInteraction;
    if (idle > LIVING_IDLE_MS) {
      hideIdleWarning();
      location.hash = "#display";  // 入力途中の内容は保存せずに戻る（仮置き）
    } else if (idle > LIVING_IDLE_MS - IDLE_WARN_MS) {
      showIdleWarning(Math.ceil((LIVING_IDLE_MS - idle) / 1000));
    } else {
      hideIdleWarning();
    }
  } else {
    hideIdleWarning();
  }
}

// 居間の自動復帰の予告（WCAG 2.2 SC 2.2.1：20秒以上前に知らせ、簡単な操作で何度でも延ばせる）
const IDLE_WARN_MS = 25 * 1000;
function showIdleWarning(sec) {
  let w = document.getElementById("idle-warn");
  if (!w) {
    w = document.createElement("div");
    w.id = "idle-warn";
    w.className = "sheet-backdrop";
    w.innerHTML = `<div class="sheet" role="alertdialog" aria-labelledby="idle-msg">
      <h2 id="idle-msg">まもなく表示の画面に戻ります</h2>
      <p class="hint">あと <strong id="idle-sec" class="num"></strong> 秒。入力の途中の内容は保存されません。</p>
      <button class="btn primary" type="button" id="idle-continue">続ける</button></div>`;
    document.body.appendChild(w);
    w.querySelector("#idle-continue").addEventListener("click", () => { lastInteraction = Date.now(); hideIdleWarning(); });
    w.querySelector("#idle-continue").focus();
  }
  w.querySelector("#idle-sec").textContent = String(sec);
}
function hideIdleWarning() { document.getElementById("idle-warn")?.remove(); }

const pigeonName = () => (state.household?.pigeon_name || "").trim();
function speechText(s) {
  return S.noticeSpeech(s, person(s.person_id), pigeonName());
}

function handleNotices(active, np) {
  for (const s of active) {
    const key = S.noticeKey(s.id, np.date);
    if (!loggedNotices.has(key)) { loggedNotices.add(key); logNotice(s, np.date, key); }
    const soundKey = `kurukku:sounded:${key}`;
    if (s.notify_sound && !lsGet(soundKey) && sound.isReady()) {
      lsSet(soundKey, "1");   // 再読込しても同じ通知で二度鳴らさない
      sound.announce({ times: 2, text: speechText(s) });
    }
  }
  for (const m of S.activeMessages(state.messages)) {
    const soundKey = `kurukku:sounded:msg:${m.id}`;
    if (m.with_sound && !lsGet(soundKey) && sound.isReady()) {
      lsSet(soundKey, "1");
      const p = person(m.person_id);
      sound.announce({ times: 1, text: S.messageSpeech(m, p, pigeonName()) });
    }
  }
}

function cleanupSounded(today) {
  for (const k of lsKeys()) {
    const m = k.match(/^kurukku:sounded:notify:[^:]+:(\d{4}-\d{2}-\d{2})$/);
    if (m && m[1] !== today) lsDel(k);
  }
}

async function logNotice(s, date, key) {
  // 端末は履歴を読めないため、重複しない記録はデータベースの関数に任せる
  const { error } = await sb.rpc("log_notice", { p_schedule_id: s.id, p_on_date: date });
  if (error) loggedNotices.delete(key);  // 次の秒にもう一度試す
}

async function onAnyTap(e) {
  // お知らせ中に通知画面にさわったら、音と読み上げを止める（表示はそのまま）
  if (state.view === "display" && e?.target?.closest?.(".notice") && sound.isBusy()) { sound.stopAll(); return; }
  if (!state.member || sound.isReady()) return;
  if (role() === "family" && state.view !== "display") return;  // 家族のスマホは鳴らさない
  const ok = await sound.unlock();
  if (ok) tick();
}

let wakeLock = null;
async function keepAwake() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  if (wakeLock && !wakeLock.released) return;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch (_) { wakeLock = null; }
}

// ---------- 天気 ----------
let weatherBusy = false;
async function updateWeather(force = false) {
  const h = state.household;
  if (!h || h.weather_lat == null || h.weather_lon == null || weatherBusy) return;
  const loc = `${h.weather_lat},${h.weather_lon}`;
  if (!force && loc === state.weatherLoc && Date.now() - state.weatherAt < WEATHER_MS) return;
  weatherBusy = true;
  try {
    const { data, error } = await W.fetchWeather(h.weather_lat, h.weather_lon);
    state.weather = data;
    state.weatherError = error;
    state.weatherLoc = loc;
    // 失敗したときは5分後にもう一度試す
    state.weatherAt = error ? Date.now() - WEATHER_MS + 5 * 60 * 1000 : Date.now();
  } finally {
    weatherBusy = false;
  }
  tick();
}

function weatherHTML(np) {
  const h = state.household;
  if (!h || h.weather_lat == null) return "";
  const w = state.weather;
  if (!w || w.date !== np.date) {
    return `<p class="w-main w-none">天気：まだ取得できていません</p>`;
  }
  const r = (v) => (v == null ? "－" : Math.round(v));
  const old = state.weatherError || Date.now() - w.fetchedAt > WEATHER_STALE_MS;
  // ふだんは天気と最高・最低気温だけ（予定の場所を広く取るため。11/4）。古いときだけ注意を出す
  return `<p class="w-main">${esc(w.text || "天気")}<span class="w-temp">最高 ${r(w.max)}℃／最低 ${r(w.min)}℃</span></p>
    ${old ? `<p class="w-sub"><span class="w-old">（${jstHM(new Date(w.fetchedAt))} の情報・更新できていません）</span></p>` : ""}`;
}

// ---------- 表示画面 ----------
function viewDisplay() {
  return `
  <div class="display">
    <section class="when" id="when" aria-label="今日の日付と時刻">
      <p class="greet" id="greet"></p>
      <p class="date num" id="date"></p>
      <p class="weekday" id="wday"></p>
      <div class="weather" id="weather"></div>
      <p class="clock num" id="clock"></p>
    </section>
    <section class="plan" id="plan" aria-label="今日の予定"></section>
    <p class="plan-more" id="plan-more" hidden>▼ ほかにも予定があります</p>
    <section class="news" aria-label="家族からの知らせ">
      <div id="msgs" class="msgs"></div>
      <div class="status-line" id="status"></div>
    </section>
    <section class="pigeon-corner" aria-label="${esc(pigeonName() || "鳩")}">
      <p class="coo-bubble" id="coo-bubble" aria-live="polite" hidden></p>
      <button type="button" class="pigeon-btn" data-act="pigeon" aria-label="${esc(pigeonName() || "鳩")}にさわる">${pigeon("pigeon-ic")}</button>
    </section>
  </div>
  <div id="night"></div>
  <div id="notice"></div>
  <div id="sheet"></div>`;
}

function updateDisplay(np, occ, active) {
  const nightStart = state.household?.night_start || "21:00";
  const nightEnd = state.household?.night_end || "06:00";
  const night = S.isNight(np.time, nightStart, nightEnd);
  // 朝の挨拶：夜が明けてから11時まで（出す時間の最終版は未決・仮置き）
  const morning = !night && S.normTime(nightEnd) <= np.time && np.time < "11:00:00";
  $("greet").textContent = morning ? "おはようございます" : "";
  document.body.classList.toggle("is-night", night);
  state.isNight = night;
  // 夜：暗い画面で日付・時計・ひとことだけを出し続ける（画面は消さない）
  setHTML($("night"), night ? `<div class="night-screen" aria-label="夜の表示">
      <p class="n-date">${np.m}月${np.d}日 ${S.WEEKDAYS[np.dow]}曜日</p>
      <p class="n-clock num">${np.time.slice(0, 5)}</p>
      <p class="n-text">今は夜です。おやすみなさい</p>
      ${sound.isReady() ? "" : `<button class="tap-sound n-tap" type="button" data-act="unlock">音を出すには、画面に一度さわってください</button>`}
    </div>` : "");
  $("date").textContent = `${np.m}月${np.d}日`;
  $("wday").textContent = `${S.WEEKDAYS[np.dow]}曜日`;
  setHTML($("weather"), weatherHTML(np));
  $("clock").textContent = np.time.slice(0, 5);

  // ふだんの画面：ごはん・お薬はお知らせ中だけ、終わった予定は消す（11/4 決定）
  const shown = S.homeItems(occ, active, np.time);
  const groups = patientFirst().map((p) => {
    const items = shown.filter((s) => s.person_id === p.id);
    const li = items.map((s) => {
      // 本人は開始の時刻だけ（デイの終わりなどは使わない。11/4）。家族は「いつ戻るか」まで出す
      const t = p.is_patient ? S.hm(s.start_time) : S.timeLabel(s);
      const sub = s.display_text ? `<span class="sub">${esc(s.display_text)}</span>` : "";
      return `<li><span class="t">${esc(t)}</span><span class="what">${esc(s.title)}${sub}</span></li>`;
    }).join("");
    return `<div class="who ${p.is_patient ? "patient" : ""}"><h2>${esc(p.name)}</h2>${li ? `<ul>${li}</ul>` : `<p class="none">このあとの予定はありません</p>`}</div>`;
  }).join("");
  setHTML($("plan"), groups || `<div class="who"><p class="none">まだ人が登録されていません</p></div>`);
  const pl = $("plan");
  $("plan-more").hidden = !(pl.scrollHeight > pl.clientHeight + 2);

  const msgs = S.activeMessages(state.messages).slice(0, 3).map((m) => {
    const p = person(m.person_id);
    return `<div class="msg">${p ? `<span class="from">${esc(p.name)}</span>` : ""}${esc(m.body)}</div>`;
  }).join("");
  setHTML($("msgs"), msgs);

  const parts = [];
  if (state.syncError) parts.push(`<span class="warn">接続できません（${state.lastSync ? jstHM(state.lastSync) + " の情報" : "情報なし"}）</span>`);
  else if (state.lastSync) parts.push(`<span>更新 ${jstHM(state.lastSync)}</span>`);
  if (state.household?.is_demo) parts.push(`<span class="demo-badge">デモ用データ（架空）</span>`);
  if (!sound.isReady()) parts.push(`<button class="tap-sound" type="button" data-act="unlock">音を出すには、画面に一度さわってください</button>`);
  if (role() === "living") parts.push(`<a class="btn primary" href="#add">予定を追加</a>`);
  if (role() === "family") parts.push(`<a class="btn small" href="#today">家族の画面へ</a>`);
  setHTML($("status"), parts.join(""));

  state.noticeActive = active.length > 0;
  if (active.length) {
    const items = active.map((s) => {
      const p = person(s.person_id);
      return `<div class="item">${p && !p.is_patient ? `<div class="who-n">${esc(p.name)}</div>` : ""}<div class="what-n">${esc(s.title)}</div>${s.display_text ? `<div class="sub-n">${esc(s.display_text)}</div>` : ""}${s.start_time ? `<div class="time-n">${esc(S.hm(s.start_time))}</div>` : ""}</div>`;
    }).join("");
    setHTML($("notice"), `<div class="notice ${active.length > 1 ? "many" : ""}" role="alert">
      <div class="top"><span>${np.m}月${np.d}日 ${S.WEEKDAYS[np.dow]}曜日</span><span class="clock-s">${np.time.slice(0, 5)}</span></div>
      <div class="items">${items}</div>
      <div class="pigeon"><span>${pigeonName() ? `${esc(pigeonName())}からのお知らせ` : "くるっくー　お知らせです"}</span>${sound.isBusy() ? `<button class="btn stop-sound" type="button" data-act="stop-sound">音を止める</button>` : ""}${sound.isReady() ? "" : `<button class="tap-sound" type="button" data-act="unlock">音を出すには、画面に一度さわってください</button>`}</div></div>`);
  } else {
    setHTML($("notice"), "");
  }
}

// ---------- おしゃべり鳩（ちょっと役に立たない鳩） ----------
// 触ると意味のない優しい鳴き声を返す。ツッコミはしない（父の端末で注意と受け取られないため）。
// お知らせ中は黙る。返事のあとは少し黙る。タップは毎回、月報の材料として数える。
const COO_QUIET_MS = 4000;
let lastCoo = 0;
let bubbleTimer = null;
async function onPigeon() {
  if (state.member) sb.from("activity_log").insert({ household_id: state.member.household_id, kind: "pigeon_tapped" }).then(() => {});
  if (state.noticeActive) return;                         // お知らせ中はおしゃべりしない
  if (Date.now() - lastCoo < COO_QUIET_MS) return;        // 返事のあとは少し黙る
  if (!sound.isReady()) await sound.unlock();
  lastCoo = Date.now();
  // 夜は音を出さず、吹き出しだけ（家族を起こさないための仮置き）
  const c = state.isNight ? sound.COOS[Math.floor(Math.random() * sound.COOS.length)] : sound.coo();
  if (!c) return;
  const b = $("coo-bubble");
  if (!b) return;
  b.textContent = c.text;
  b.hidden = false;
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => { b.hidden = true; }, 2500);
}

// 時計を長押しすると端末メニュー（設定は変えられない。音の有効化とログアウトだけ）
// 父が偶然開かないよう5秒（11/3 決定）。暗証番号は付けない。
const MENU_PRESS_MS = 5000;
let pressTimer = null;
addEventListener("pointerdown", (e) => {
  if (state.view !== "display" || !e.target.closest?.("#when, .night-screen")) return;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(openSheet, MENU_PRESS_MS);
});
// 長押し中にブラウザのメニューが出て止まらないようにする
addEventListener("contextmenu", (e) => { if (state.view === "display") e.preventDefault(); });
for (const ev of ["pointerup", "pointercancel", "pointerleave"]) addEventListener(ev, () => clearTimeout(pressTimer));
function openSheet() {
  const roleName = { display: "見るだけ", living: "見る＋予定の追加", family: "家族" }[role()];
  $("sheet").innerHTML = `<div class="sheet-backdrop"><div class="sheet" role="dialog" aria-label="この端末">
    <h2>この端末：${esc(state.member.display_name)}</h2>
    <p class="hint">役割：${roleName}／音：${sound.isReady() ? "鳴らせます" : "まだ鳴らせません"}／画面点灯：${wakeLock && !wakeLock.released ? "維持中" : "維持できていません"}</p>
    <button class="btn" data-act="unlock-test">音を鳴らして試す</button>
    <button class="btn danger" data-act="logout-ask">この端末からログアウト</button>
    <button class="btn primary" data-act="sheet-close">閉じる</button></div></div>`;
}

// ---------- ログイン・参加 ----------
function viewLogin() {
  return `<main class="page">
    <header class="bar"><h1 class="logo-h1">${LOGO}<span class="vh">くるっくー</span></h1></header>
    <form class="card" id="login-form">
      <h2>ログイン</h2>
      <label class="field"><span>メールアドレス</span><input type="email" id="login-email" autocomplete="username" required></label>
      <label class="field"><span>パスワード（6文字以上）</span><input type="password" id="login-pass" autocomplete="current-password" minlength="6" required></label>
      <div class="row">
        <button class="btn primary" type="submit" data-mode="in">ログイン</button>
        <button class="btn" type="submit" data-mode="up">新しく登録</button>
      </div>
      <p class="hint">端末ごとにアカウントを分けます。Gmailなら「名前+hatoa@gmail.com」のように「+」を付けると、同じ受信箱で別のアカウントを作れます。</p>
      <p class="error" id="login-err" hidden></p>
    </form>
  </main>`;
}

function viewJoin() {
  return `<main class="page">
    <header class="bar"><h1 class="logo-h1">${LOGO}<span class="vh">くるっくー</span></h1><button class="btn small" data-act="logout">ログアウト</button></header>
    <p class="hint">${esc(state.session.user.email)} でログインしています。この端末をどの家で使うかを決めます。</p>
    <form class="card" id="join-form">
      <h2>招待コードで参加する</h2>
      <p class="hint">家族のスマホの「家と端末」で作ったコードを入れます。端末（父の部屋・居間）はこちら。</p>
      <label class="field"><span>招待コード</span><input type="text" id="join-code" autocomplete="off" autocapitalize="characters" required></label>
      <button class="btn primary" type="submit">参加する</button>
    </form>
    <form class="card" id="create-form">
      <h2>最初の家族として、家を作る</h2>
      <p class="hint">一番はじめに一度だけ。作った人は「家族」として全部を管理できます。</p>
      <label class="field"><span>家の名前</span><input type="text" id="create-name" placeholder="例：うちの鳩小屋" required></label>
      <label class="field"><span>あなたの名前</span><input type="text" id="create-me" placeholder="例：葵依" required></label>
      <button class="btn" type="submit">家を作る</button>
    </form>
  </main>`;
}

// ---------- 家族・居間の画面 ----------
function viewFamily(v) {
  if (v === "add" && role() === "living") {
    return `<main class="page"><header class="bar"><h1>予定を追加</h1><a class="btn" href="#display">表示に戻る</a></header>${addFormHTML(false)}
      <p class="hint">しばらく操作しないと、入力途中の内容は保存されずに表示画面へ戻ります。</p></main>`;
  }
  // 下にいつも出ているメニュー（11/4 決定：案A）。「その他」の中の画面にいるときは「その他」を光らせる
  const MORE = ["plans", "notes", "settings", "more"];
  const navItems = [["today", "今日", "house"], ["add", "予定を追加", "calendar-plus"], ["messages", "知らせ", "mail"], ["gazette", "鳩月報", "newspaper"], ["more", "その他", "ellipsis"]];
  const current = MORE.includes(v) ? "more" : v;
  const tabs = navItems.map(([k, label, ic]) => `<a href="#${k}" ${k === current ? 'aria-current="page"' : ""}>${icon(ic, "nav-ic")}<span>${label}</span></a>`).join("");
  let body = "";
  if (v === "today") body = `<section class="card"><h2>今日の予定</h2><ul class="list" id="today-list"></ul></section>`;
  if (v === "add") body = addFormHTML(true);
  if (v === "plans") body = `<section class="card"><h2>予定一覧</h2><p class="hint">毎週の予定と、今日以降の予定です。「変更」から、時刻や内容を変えられます。</p><ul class="list" id="plans-list"></ul></section>`;
  if (v === "edit") body = editFormHTML();
  if (v === "rescue" || v === "rescue-edit") body = `<section class="card" id="rescue-root"><p class="hint">読み込み中…</p></section>`;
  if (v === "notes") body = notesHTML();
  if (v === "more") body = `<nav class="card more-menu" aria-label="その他の画面"><ul class="list">
      ${[["plans", "予定一覧", "list-checks", "毎週の予定と、これからの予定。変更・削除"], ["notes", "ひとこと・写真", "notebook-pen", "鳩月報の材料になる短いメモと写真"],
         ["settings", "家と端末", "settings", "人・端末の登録、鳩の名前、お知らせの音、夜の表示、天気の地域"], ["display", "表示画面", "monitor", "父の部屋と同じ画面を見る"]]
        .map(([k, label, ic, sub]) => `<li><a class="more-link" href="#${k}">${icon(ic, "more-ic")}<span class="main"><strong>${label}</strong><span class="sub">${sub}</span></span></a></li>`).join("")}
    </ul></nav>`;
  if (v === "gazette") body = gazetteHTML();
  if (v === "messages") body = msgFormHTML();
  if (v === "settings") body = settingsHTML();
  return `<main class="page">
    <header class="bar family-bar">
      <div class="brand"><h1 class="logo-h1">${LOGO}<span class="vh">くるっくー</span> <span class="hint" id="hh-name"></span></h1><span class="demo-badge" id="demo-badge" hidden>デモ用データ（架空）</span></div>
      <a class="btn rescue-entry" href="#rescue" ${v === "rescue" ? 'aria-current="page"' : ""}>${icon("id-card", "nav-ic")}<span>レスキューカード</span></a>
    </header>
    <nav class="bottom-nav" aria-label="画面">${tabs}</nav>
    ${state.syncError ? `<p class="error">接続できません：${esc(state.syncError)}</p>` : ""}
    ${body}
  </main>`;
}

function scheduleLine(s, extra = "") {
  const p = person(s.person_id);
  const badges = [];
  if (s.kind === "weekly") badges.push(S.repeatLabel(s));
  if (s.kind === "weekly" && s.valid_from && s.valid_from > state.today) badges.push(`${S.repeatLabel({ kind: "once", on_date: s.valid_from })}から`);
  if (s.kind === "weekly" && s.valid_until) badges.push(`${S.repeatLabel({ kind: "once", on_date: s.valid_until })}まで`);
  if (s.kind === "once" && s.replaces_schedule_id) badges.push("この日だけ変更");
  if (s.show_on_home === false) badges.push("本人の画面はお知らせのときだけ");
  if (s.notify_from) badges.push(`お知らせ ${S.hm(s.notify_from)}〜${S.hm(s.notify_until)}${s.notify_sound ? "" : "（音なし）"}`);
  return `<div class="main"><strong class="num">${esc(S.timeLabel(s) || "時刻なし")}</strong>　${esc(s.title)}
    <span class="badge">${esc(p ? p.name : "?")}</span>${badges.map((b) => `<span class="badge">${esc(b)}</span>`).join("")}
    ${s.display_text ? `<div class="sub">添える一言：${esc(s.display_text)}</div>` : ""}
    ${s.family_memo ? `<div class="sub">家族メモ：${esc(s.family_memo)}${s.memo_for_gazette ? "（月報に使う）" : ""}</div>` : ""}
    ${extra}</div>`;
}

function todayListHTML() {
  const occ = S.occurrencesOn(state.schedules, state.exceptions, state.today);
  const rows = occ.map((s) => `<li>${scheduleLine(s)}
    <button class="btn small" data-act="edit" data-id="${s.id}" data-date="${state.today}" data-back="today">変更</button>
    ${s.kind === "weekly"
      ? `<button class="btn small danger" data-act="cancel-day" data-id="${s.id}">今日だけ中止</button>`
      : `<button class="btn small danger" data-act="delete" data-id="${s.id}">削除</button>`}</li>`);
  const cancelled = state.exceptions.filter((e) => e.on_date === state.today)
    .map((e) => state.schedules.find((s) => s.id === e.schedule_id)).filter(Boolean)
    .map((s) => `<li>${scheduleLine(s, `<div class="sub">今日は中止</div>`)}<button class="btn small" data-act="uncancel" data-id="${s.id}">中止を取り消す</button></li>`);
  return rows.join("") + cancelled.join("") || `<li class="hint">今日の予定はまだありません。「予定を追加」から入れてください。</li>`;
}

function plansListHTML() {
  const list = state.schedules
    .filter((s) => (s.kind === "weekly" && (!s.valid_until || s.valid_until >= state.today)) || (s.kind === "once" && s.on_date >= state.today))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "weekly" ? -1 : 1) || (a.on_date || "").localeCompare(b.on_date || "") || S.sortKey(a).localeCompare(S.sortKey(b)));
  return list.map((s) => `<li>${scheduleLine(s, s.kind === "once" ? `<div class="sub">${esc(S.repeatLabel(s))}</div>` : "")}
    <button class="btn small" data-act="edit" data-id="${s.id}" data-date="${s.kind === "once" ? s.on_date : state.today}" data-back="plans">変更</button>
    <button class="btn small danger" data-act="delete" data-id="${s.id}">削除</button></li>`).join("")
    || `<li class="hint">予定はまだありません。</li>`;
}

// ---------- レスキューカード ----------
// 家族だけが見られる。カードは未入力の項目があっても開ける。写真は元の画像のまま扱う。
const rescue = { profile: null, clothes: [], urls: new Map(), withAddress: false, file: null, imageUrl: null, faceFile: null };
const CARD_FONT = '"Zen Kaku Gothic New", "Hiragino Sans", "Noto Sans JP", sans-serif';

async function photoUrl(path) {
  if (!path) return null;
  if (rescue.urls.has(path)) return rescue.urls.get(path);
  const { data, error } = await sb.storage.from("rescue").download(path);
  if (error || !data) return null;
  const u = URL.createObjectURL(data);
  rescue.urls.set(path, u);
  return u;
}

async function loadRescue() {
  const [p, c] = await Promise.all([
    sb.from("rescue_profiles").select("*").maybeSingle(),
    sb.from("rescue_clothes").select("*").order("sort_order").order("created_at"),
  ]);
  if (p.error) throw p.error;
  if (c.error) throw c.error;
  rescue.profile = p.data || null;
  rescue.clothes = c.data || [];
  await Promise.all([rescue.profile?.face_photo_path, ...rescue.clothes.map((x) => x.photo_path)].filter(Boolean).map(photoUrl));
}

async function openRescue(v) {
  try {
    await loadRescue();
  } catch (e) {
    setHTML($("rescue-root"), `<p class="error">読み込めませんでした：${esc(errMsg(e))}</p><button class="btn" data-act="rescue-retry">もう一度読み込む</button>`);
    return;
  }
  if (state.view !== v) return;
  if (v === "rescue") {
    // 開いた記録（月報の材料。緊急事態の件数としては扱わない）
    sb.from("activity_log").insert({ household_id: state.member.household_id, kind: "rescue_card_opened" }).then(() => {});
    renderRescueCard();
  } else {
    $("rescue-root").outerHTML = rescueEditHTML();
    renderClothesEdit();
  }
}

function renderRescueCard() {
  const p = rescue.profile || {};
  const rows = R.cardRows(p, rescue.clothes, state.today, { withAddress: true });
  const get = (k) => rows.find((r) => r.key === k);
  const val = (k) => get(k).value ? esc(get(k).value) : `<span class="rc-empty">未登録</span>`;
  const face = rescue.urls.get(p.face_photo_path);
  const faceDates = [p.face_photo_taken_on ? `撮影 ${R.ymd(p.face_photo_taken_on)}ごろ` : "撮影日 不明",
    p.face_photo_uploaded_at ? `登録 ${R.ymd(String(p.face_photo_uploaded_at).slice(0, 10))}` : ""].filter(Boolean).join("／");
  const clothes = rescue.clothes.map((c) => {
    const u = rescue.urls.get(c.photo_path);
    return `<figure class="rc-cloth">${u ? `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="${esc(c.note || "よく着る服")}"></a>` : `<div class="rc-noimg">写真なし</div>`}
      <figcaption>${esc(c.note || "")}</figcaption></figure>`;
  }).join("");
  $("rescue-root").outerHTML = `
  <section class="rescue-card" id="rescue-root">
    ${rescue.profile ? "" : `<div class="rc-start"><strong>まだ登録されていません</strong><p class="hint">いざという時のために、最近の顔写真と身長などを入れておきましょう。分かる項目だけで大丈夫です。</p><a class="btn primary" href="#rescue-edit">内容を入れる</a></div>`}
    <div class="rc-top">
      <figure class="rc-face">${face ? `<a href="${face}" target="_blank" rel="noopener"><img src="${face}" alt="最近の顔写真"></a>` : `<div class="rc-noimg">顔写真なし</div>`}
        <figcaption>${esc(faceDates)}${face ? `<br><a href="${face}" target="_blank" rel="noopener">元の写真を開く</a>` : ""}</figcaption></figure>
      <div class="rc-big">
        <p class="rc-name">${get("name").value ? esc(get("name").value) : `<span class="rc-empty">名前：未登録</span>`}</p>
        ${get("age").value ? `<p class="rc-age">${esc(get("age").value)}</p>` : ""}
        <dl class="rc-stats">
          ${["height", "weight", "shoe"].map((k) => `<div><dt>${get(k).label}</dt><dd>${get(k).main ? esc(get(k).main) : `<span class="rc-empty">未登録</span>`}</dd>${get(k).note ? `<p class="rc-note">${esc(get(k).note)}</p>` : ""}</div>`).join("")}
        </dl>
      </div>
    </div>
    <dl class="rc-rows">
      ${["features", "belongings", "notes", "address"].map((k) => `<div><dt>${get(k).label}</dt><dd>${val(k)}</dd></div>`).join("")}
    </dl>
    <h3>よく着る服</h3>
    <p class="hint">このうちどれかを着ていることが多い</p>
    <div class="rc-clothes">${clothes || `<p class="rc-empty">未登録</p>`}</div>
    <p class="hint">${p.updated_at ? `情報の更新 ${esc(R.ymd(String(p.updated_at).slice(0, 10)))}` : "まだ登録されていません"}　<a href="#rescue-edit">内容を直す</a></p>
  </section>
  <section class="card">
    <h2>見せる・読み上げる・送る</h2>
    <label class="check"><input type="checkbox" id="rc-private"> 住所も入れる（警察に伝えるときなど）</label>
    <label class="field"><span>文字（読み上げ・コピー用）</span><textarea id="rc-text" readonly rows="8"></textarea></label>
    <div class="row">
      <button class="btn" type="button" data-act="rc-copy">文字をコピー</button>
      <button class="btn primary" type="button" data-act="rc-share" id="rc-share" disabled>画像を作っています…</button>
    </div>
    <div id="rc-out"></div>
    <details><summary>スマホのホーム画面から直接開くには</summary>
      <p class="hint">このページを開いたまま、iPhoneはSafariの共有ボタン→「ホーム画面に追加」、AndroidはChromeのメニュー→「ホーム画面に追加」。<br>
      アドレス：<span class="num">${esc(location.href.split("#")[0])}#rescue</span></p>
    </details>
  </section>`;
  $("rc-private").checked = rescue.withAddress;
  prepareShare();
}

async function prepareShare() {
  const p = rescue.profile || {};
  $("rc-text").value = R.cardText(p, rescue.clothes, state.today, { withAddress: rescue.withAddress });
  const btn = $("rc-share");
  btn.disabled = true; btn.textContent = "画像を作っています…";
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const blob = await R.cardImage({ profile: p, clothes: rescue.clothes, todayStr: state.today, withAddress: rescue.withAddress,
      faceUrl: rescue.urls.get(p.face_photo_path), clothesUrls: rescue.clothes.map((c) => rescue.urls.get(c.photo_path)), font: CARD_FONT });
    if (rescue.imageUrl) URL.revokeObjectURL(rescue.imageUrl);
    rescue.imageUrl = URL.createObjectURL(blob);
    rescue.file = new File([blob], "kurukku-card.jpg", { type: "image/jpeg" });
    if (state.view !== "rescue" || !$("rc-share")) return;
    btn.disabled = false;
    btn.textContent = navigator.canShare?.({ files: [rescue.file] }) ? "画像と文字を送る" : "画像を表示する";
  } catch (e) {
    btn.textContent = "画像を作れませんでした";
  }
}

async function shareCard() {
  const text = $("rc-text").value;
  if (rescue.file && navigator.canShare?.({ files: [rescue.file] })) {
    try { await navigator.share({ files: [rescue.file], text }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  setHTML($("rc-out"), `<p class="hint">画像を長押し（パソコンは右クリック）して保存できます。</p><img class="rc-share-img" src="${rescue.imageUrl}" alt="送るための画像">`);
}

function rescueEditHTML() {
  const p = rescue.profile || {};
  const v = (x) => esc(x ?? "");
  const num = (id, label, unit, value, approx, on) => `
    <fieldset><legend>${label}</legend>
      <div class="row">
        <label class="field"><span>${unit}</span><input type="number" inputmode="decimal" step="0.1" min="0" id="rs-${id}" value="${v(value)}"></label>
        <label class="field"><span>測った日</span><input type="date" id="rs-${id}-on" value="${v(on)}"></label>
      </div>
      <label class="check"><input type="checkbox" id="rs-${id}-approx" ${approx ? "checked" : ""}> 正確でない（「約」を付ける）</label>
    </fieldset>`;
  const face = rescue.urls.get(p.face_photo_path);
  return `<form class="card" id="rescue-form" novalidate>
    <h2>レスキューカードの内容</h2>
    <p class="hint">分からない項目は空欄のままで保存できます。家族の役割の人だけが見られます（表示端末には出ません）。</p>
    <fieldset><legend>最近の顔写真</legend>
      <div id="rs-face-preview">${face ? `<img class="rs-thumb" src="${face}" alt="いまの顔写真">` : `<p class="hint">まだありません</p>`}</div>
      <label class="field"><span>写真を選ぶ（加工せず元の画像のまま保存します）</span><input type="file" id="rs-face" accept="image/*"></label>
      <label class="field"><span>撮影日（分かる範囲で）</span><input type="date" id="rs-face-taken" value="${v(p.face_photo_taken_on)}"></label>
    </fieldset>
    <label class="field"><span>名前</span><input type="text" id="rs-name" maxlength="40" value="${v(p.full_name)}"></label>
    <label class="field"><span>生年月日</span><input type="date" id="rs-birth" value="${v(p.birth_date)}"></label>
    ${num("height", "身長", "cm", p.height_cm, p.height_approx, p.height_measured_on)}
    ${num("weight", "体重", "kg", p.weight_kg, p.weight_approx, p.weight_measured_on)}
    ${num("shoe", "靴のサイズ", "cm", p.shoe_cm, p.shoe_approx, p.shoe_measured_on)}
    <label class="field"><span>身体の特徴（髪型・眼鏡・歩き方など）</span><textarea id="rs-features" maxlength="300">${v(p.features)}</textarea></label>
    <label class="field"><span>いつもの持ち物</span><textarea id="rs-belongings" maxlength="300">${v(p.belongings)}</textarea></label>
    <label class="field"><span>住所</span><input type="text" id="rs-address" maxlength="120" value="${v(p.address)}"></label>
    <label class="field"><span>その他、伝えたいこと</span><textarea id="rs-notes" maxlength="400">${v(p.notes)}</textarea></label>
    <div class="row">
      <button class="btn primary" type="submit" id="rs-submit">保存する</button>
      <a class="btn" href="#rescue">カードを見る</a>
    </div>
  </form>
  <section class="card">
    <h2>よく着る服</h2>
    <p class="hint">毎日入れる必要はありません。よく着る服を登録しておくと、いざという時に「このうちどれか」として見せられます（6枚まで）。</p>
    <div class="rc-clothes" id="rs-clothes"></div>
    <form id="cloth-form" class="row">
      <label class="field"><span>服の写真</span><input type="file" id="cloth-photo" accept="image/*"></label>
      <label class="field"><span>ひとこと（例：紺のジャンパー）</span><input type="text" id="cloth-note" maxlength="60"></label>
      <button class="btn" type="submit">追加</button>
    </form>
  </section>`;
}

function renderClothesEdit() {
  setHTML($("rs-clothes"), rescue.clothes.map((c) => {
    const u = rescue.urls.get(c.photo_path);
    return `<figure class="rc-cloth">${u ? `<img src="${u}" alt="${esc(c.note || "よく着る服")}">` : `<div class="rc-noimg">写真なし</div>`}
      <figcaption>${esc(c.note || "")}</figcaption>
      <button class="btn small danger" type="button" data-act="cloth-delete" data-id="${c.id}">削除</button></figure>`;
  }).join("") || `<p class="hint">まだありません</p>`);
}

function photoExt(file) {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp" })[file.type] || "jpg";
}
function localDate(ms) {
  return S.nowParts(new Date(ms), TIMEZONE).date;
}

async function uploadPhoto(file, prefix) {
  if (!file) return null;
  if (file.size > 20 * 1024 * 1024) throw new Error("写真が大きすぎます（20MBまで）");
  const path = `${state.member.household_id}/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${photoExt(file)}`;
  const { error } = await sb.storage.from("rescue").upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
  if (error) throw error;
  return path;
}

async function submitRescue() {
  const val = (id) => $(id).value.trim();
  const numv = (id) => { const x = $(id).value; return x === "" ? null : Number(x); };
  const row = {
    household_id: state.member.household_id,
    full_name: val("rs-name") || null,
    birth_date: $("rs-birth").value || null,
    height_cm: numv("rs-height"), height_approx: $("rs-height-approx").checked, height_measured_on: $("rs-height-on").value || null,
    weight_kg: numv("rs-weight"), weight_approx: $("rs-weight-approx").checked, weight_measured_on: $("rs-weight-on").value || null,
    shoe_cm: numv("rs-shoe"), shoe_approx: $("rs-shoe-approx").checked, shoe_measured_on: $("rs-shoe-on").value || null,
    features: val("rs-features") || null, belongings: val("rs-belongings") || null,
    address: val("rs-address") || null, notes: val("rs-notes") || null,
    face_photo_taken_on: $("rs-face-taken").value || null,
  };
  for (const k of ["height_cm", "weight_kg", "shoe_cm"]) if (row[k] !== null && !(row[k] > 0)) throw new Error("身長・体重・靴のサイズは、正の数で入れてください");
  const oldPath = rescue.profile?.face_photo_path || null;
  const file = $("rs-face").files[0];
  let newPath = null;
  if (file) {
    newPath = await uploadPhoto(file, "face");
    row.face_photo_path = newPath;
    row.face_photo_uploaded_at = new Date().toISOString();
  }
  const { error } = await sb.from("rescue_profiles").upsert(row, { onConflict: "household_id" });
  if (error) {
    if (newPath) await sb.storage.from("rescue").remove([newPath]);  // 保存できなかった写真は残さない
    throw error;
  }
  if (newPath && oldPath) await sb.storage.from("rescue").remove([oldPath]);
  toast("保存しました");
  location.hash = "#rescue";
}

// ---------- ひとこと・写真（鳩月報の材料） ----------
// 任意。片方だけでも、何もない日があってもよい。家族だけが見られる。
const notesState = { list: [], urls: new Map() };

async function memoryUrl(path) {
  if (!path) return null;
  if (notesState.urls.has(path)) return notesState.urls.get(path);
  const { data, error } = await sb.storage.from("memories").download(path);
  if (error || !data) return null;
  const u = URL.createObjectURL(data);
  notesState.urls.set(path, u);
  return u;
}

function notesHTML() {
  return `<form class="card" id="note-form" novalidate>
      <h2>ひとこと・写真</h2>
      <p class="hint">思い出すための短いきっかけを残します。書かない日があっても大丈夫です。「月報に使う」を選んだものだけが鳩月報の材料になります。</p>
      <label class="field"><span>日付</span><input type="date" id="note-date" value="${esc(state.today)}" max="${esc(state.today)}"></label>
      <label class="field"><span>ひとこと（200文字まで・なくてもよい）</span><textarea id="note-body" maxlength="200" placeholder="例：デイで紅葉。おやつがおいしかったらしい"></textarea></label>
      <label class="field"><span>写真（なくてもよい。元の画像のまま保存します）</span><input type="file" id="note-photo" accept="image/*"></label>
      <label class="check"><input type="checkbox" id="note-gazette" checked> 鳩月報に使ってよい</label>
      <button class="btn primary" type="submit">残す</button>
    </form>
    <section class="card"><h2>これまでのひとこと</h2><ul class="list" id="note-list"><li class="hint">読み込み中…</li></ul></section>`;
}

async function openNotes() {
  const { data, error } = await sb.from("daily_notes").select("*").order("on_date", { ascending: false }).order("created_at", { ascending: false }).limit(60);
  if (error) { setHTML($("note-list"), `<li class="error">${esc(errMsg(error))}</li>`); return; }
  notesState.list = data || [];
  await Promise.all(notesState.list.map((n) => memoryUrl(n.photo_path)));
  if (state.view !== "notes") return;
  setHTML($("note-list"), notesState.list.map((n) => {
    const u = notesState.urls.get(n.photo_path);
    return `<li><div class="main"><strong class="num">${esc(R.ymd(n.on_date))}</strong>${n.use_in_gazette ? "" : '<span class="badge">月報に使わない</span>'}
      ${n.body ? `<div>${esc(n.body)}</div>` : ""}${u ? `<a href="${u}" target="_blank" rel="noopener"><img class="note-thumb" src="${u}" alt="${esc(n.on_date)}の写真"></a>` : ""}</div>
      <button class="btn small" data-act="note-toggle" data-id="${n.id}">${n.use_in_gazette ? "月報に使わない" : "月報に使う"}</button>
      <button class="btn small danger" data-act="note-delete" data-id="${n.id}">削除</button></li>`;
  }).join("") || `<li class="hint">まだありません。</li>`);
}

async function submitNote() {
  const on_date = $("note-date").value || state.today;
  const body = $("note-body").value.trim() || null;
  const file = $("note-photo").files[0];
  if (!body && !file) throw new Error("ひとことか写真のどちらかを入れてください");
  let photo_path = null;
  if (file) {
    if (file.size > 20 * 1024 * 1024) throw new Error("写真が大きすぎます（20MBまで）");
    photo_path = `${state.member.household_id}/${on_date}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${photoExt(file)}`;
    const up = await sb.storage.from("memories").upload(photo_path, file, { contentType: file.type || "image/jpeg", upsert: false });
    if (up.error) throw up.error;
  }
  const { error } = await sb.from("daily_notes").insert({
    on_date, body, photo_path, use_in_gazette: $("note-gazette").checked,
    photo_taken_on: file && file.lastModified ? localDate(file.lastModified) : null,
  });
  if (error) { if (photo_path) await sb.storage.from("memories").remove([photo_path]); throw error; }
  $("note-form").reset();
  $("note-date").value = state.today;
  toast("残しました");
  await openNotes();
}

// ---------- 鳩月報 ----------
// 対象月を選ぶ → 集計（コード）＋選んだメモを Claude に渡して見出しと記事 → 固定の紙面で表示 → 直して保存。
// 紙面を直しても、元の予定・メモ・履歴は書き換えない。
const gz = { month: null, paper: null, list: [], photos: [], busy: false, editing: false };

function prevMonth() {
  const [y, m] = state.today.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

function gazetteHTML() {
  gz.month = gz.month || prevMonth();
  return `<section class="card">
      <h2>鳩月報</h2>
      <p class="hint">その月にくるっくーが運んだ記録から、${esc(pigeonName() || "鳩")}が一枚の新聞を作ります。数字は記録から数え、見出しと記事はClaudeが書きます。</p>
      <div class="row">
        <label class="field"><span>対象月</span><input type="month" id="gz-month" value="${esc(gz.month)}" max="${esc(state.today.slice(0, 7))}"></label>
        <button class="btn primary" type="button" data-act="gz-make" id="gz-make">この月の鳩月報を作る</button>
      </div>
      <p class="hint" id="gz-status"></p>
    </section>
    <div id="gz-paper"></div>
    <section class="card"><h2>これまでの鳩月報</h2><ul class="list" id="gz-list"><li class="hint">読み込み中…</li></ul></section>`;
}

async function openGazette() {
  const { data, error } = await sb.from("gazettes").select("*").order("month", { ascending: false });
  if (error) { setHTML($("gz-list"), `<li class="error">${esc(errMsg(error))}</li>`); return; }
  gz.list = data || [];
  if (state.view !== "gazette") return;
  setHTML($("gz-list"), gz.list.map((g) => `<li><div class="main"><strong>${esc(g.month.slice(0, 7).replace("-", "年"))}月号</strong>　${esc(g.headline || "")}
      <div class="sub">${g.issued_on ? `${esc(R.ymd(g.issued_on))}発行` : "下書き"}</div></div>
      <button class="btn small" data-act="gz-open" data-id="${g.id}">開く</button></li>`).join("") || `<li class="hint">まだありません。</li>`);
  const current = gz.list.find((g) => g.month.slice(0, 7) === gz.month);
  if (current) await showPaper(current);
}

async function monthPhotos(month) {
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const { data } = await sb.from("daily_notes").select("photo_path, on_date, body").eq("use_in_gazette", true)
    .not("photo_path", "is", null).gte("on_date", `${month}-01`).lte("on_date", end).order("on_date");
  return data || [];
}

async function showPaper(g) {
  gz.paper = g;
  gz.month = g.month.slice(0, 7);
  if ($("gz-month")) $("gz-month").value = gz.month;
  gz.photos = (await monthPhotos(gz.month)).filter((p) => p.photo_path);
  if (!g.photo_path && gz.photos.length) g.photo_path = gz.photos[gz.photos.length - 1].photo_path;
  await Promise.all(gz.photos.map((p) => memoryUrl(p.photo_path)));
  renderPaper();
}

function renderPaper() {
  const g = gz.paper;
  if (!g) { setHTML($("gz-paper"), ""); return; }
  const photoUrl = notesState.urls.get(g.photo_path);
  const [y, m] = g.month.split("-").map(Number);
  const ed = gz.editing;
  const arts = (g.articles || []).map((a, i) => ed
    ? `<div class="gz-article"><input type="text" class="gz-edit" id="gz-at-${i}" value="${esc(a.title)}" maxlength="30"><textarea class="gz-edit" id="gz-ab-${i}" maxlength="240">${esc(a.body)}</textarea></div>`
    : `<article class="gz-article"><h3>${esc(a.title)}</h3><p>${esc(a.body)}</p></article>`).join("");
  const photoPick = ed && gz.photos.length ? `<div class="chips">${gz.photos.map((p) => `<button type="button" class="chip" data-act="gz-photo" data-path="${esc(p.photo_path)}" aria-pressed="${p.photo_path === g.photo_path}">${esc(R.ymd(p.on_date))}</button>`).join("")}<button type="button" class="chip" data-act="gz-photo" data-path="" aria-pressed="${!g.photo_path}">写真なし</button></div>` : "";
  setHTML($("gz-paper"), `
    <section class="gazette" aria-label="鳩月報 ${y}年${m}月号">
      <header class="gz-mast">
        <span class="gz-titles"><span class="gz-wordmark">${WORDMARK_PERCH}<span class="vh">くるっくー</span></span><span class="gz-title">鳩月報</span></span>
        <span class="gz-issue">${y}年${m}月号　${g.issued_on ? `${esc(R.ymd(g.issued_on))}発行` : "下書き"}　発行：${esc(pigeonName() || "鳩")}</span>
      </header>
      ${state.household?.is_demo ? `<p class="gz-demo">この紙面はデモ用の架空データから作りました</p>` : ""}
      ${ed ? `<input type="text" class="gz-edit gz-edit-head" id="gz-h" value="${esc(g.headline)}" maxlength="40">
              <input type="text" class="gz-edit" id="gz-sh" value="${esc(g.subheadline || "")}" maxlength="60">`
           : `<h2 class="gz-head">${esc(g.headline)}</h2><p class="gz-sub">${esc(g.subheadline || "")}</p>`}
      <div class="gz-body">
        <figure class="gz-photo">${photoUrl ? `<a href="${photoUrl}" target="_blank" rel="noopener"><img src="${photoUrl}" alt="今月の一枚"></a><figcaption>今月の一枚（写真と記事の出来事は同じとは限りません）</figcaption>` : `<div class="gz-nophoto">写真なし</div>`}${photoPick}</figure>
        <div class="gz-articles">${arts}</div>
        <aside class="gz-stats"><h3>今月の記録</h3><ul class="gz-tiles">${G.statTiles(g.stats || {}, pigeonName() || "鳩").map((t) => `<li class="gz-tile">
            <span class="gz-icon">${t.icon === "pigeon" ? pigeon("gz-ic gz-pigeon") : icon(t.icon, "gz-ic")}</span>
            <span class="gz-num num">${esc(t.num)}<small>${esc(t.unit)}</small></span>
            <span class="gz-label">${esc(t.label)}</span>
            ${t.who || t.note ? `<span class="gz-who">${esc([t.who, t.note].filter(Boolean).join("・"))}</span>` : ""}</li>`).join("")}</ul>
          <p class="gz-note">回数は記録から数えたものです。「予定」は予定の回数で、実際に出かけた回数ではありません。</p></aside>
      </div>
      <footer class="gz-foot">見出しと記事：${esc(g.model || "Claude")}　${g.generated_at ? `作成 ${esc(R.ymd(String(g.generated_at).slice(0, 10)))}` : ""}</footer>
    </section>
    <div class="row">
      ${ed ? `<button class="btn primary" data-act="gz-save">保存して発行する</button><button class="btn" data-act="gz-cancel">直すのをやめる</button>`
           : `<button class="btn" data-act="gz-edit">見出し・記事を直す</button>${g.issued_on ? "" : `<button class="btn primary" data-act="gz-save">このまま保存して発行する</button>`}`}
    </div>`);
}

async function makeGazette(overwrite = false) {
  if (gz.busy) return;
  const month = $("gz-month").value;
  if (!month) throw new Error("対象月を選んでください");
  gz.month = month;
  const existing = gz.list.find((g) => g.month.slice(0, 7) === month);
  if (existing?.issued_on && !overwrite) {
    $("gz-status").innerHTML = `この月はもう発行済みです。<button class="btn small danger" data-act="gz-overwrite">作り直す（上書き）</button>`;
    return;
  }
  gz.busy = true;
  const btn = $("gz-make");
  btn.disabled = true;
  $("gz-status").textContent = `${pigeonName() || "鳩"}が記事を書いています…（1分ほどかかることがあります）`;
  try {
    const { data, error } = await sb.functions.invoke("gazette", { body: { month, overwrite } });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch (_) { /* そのまま */ }
      throw new Error(msg);
    }
    $("gz-status").textContent = "できました。直したいところがあれば直して、保存してください。";
    gz.editing = false;
    await showPaper(data.gazette);
    await openGazette();
  } catch (e) {
    $("gz-status").textContent = `作れませんでした：${errMsg(e)}　入力した内容や記録は消えていません。もう一度試せます。`;
  } finally {
    gz.busy = false;
    btn.disabled = false;
  }
}

async function saveGazette() {
  const g = gz.paper;
  const patch = { issued_on: state.today, photo_path: g.photo_path || null };
  if (gz.editing) {
    patch.headline = $("gz-h").value.trim() || g.headline;
    patch.subheadline = $("gz-sh").value.trim();
    patch.articles = (g.articles || []).map((a, i) => ({ title: $(`gz-at-${i}`).value.trim(), body: $(`gz-ab-${i}`).value.trim() })).filter((a) => a.body);
  }
  const { data, error } = await sb.from("gazettes").update(patch).eq("id", g.id).select().single();
  if (error) throw error;
  gz.editing = false;
  toast("鳩月報を保存しました");
  await showPaper({ ...g, ...patch, ...(data || {}) });
  await openGazette();
}

// ---------- 予定の変更 ----------
function editFormHTML() {
  const s = state.schedules.find((x) => x.id === edit.id);
  const weekly = s.kind === "weekly";
  const t = (v) => esc(S.hm(v));
  return `<form class="card" id="edit-form" novalidate>
    <h2>予定を変更</h2>
    <ul class="list"><li>${scheduleLine(s)}</li></ul>
    ${weekly ? `
    <fieldset><legend>どこを変えますか</legend>
      <div class="chips" id="ed-scope"></div>
      <label class="field" id="ed-once-wrap" hidden><span>変える日</span><input type="date" id="ed-once-date" value="${esc(edit.date)}" min="${esc(state.today)}"></label>
      <label class="field" id="ed-from-wrap" hidden><span>この日から先を変える</span><input type="date" id="ed-from-date" value="${esc(state.today)}" min="${esc(state.today)}">
        <small>前の日までは、今までどおりの予定として残ります。</small></label>
    </fieldset>` : ""}
    ${s.replaces_schedule_id ? `<p class="hint">この予定は、毎週の予定を「この日だけ変更」したものです。</p>
      <button class="btn small" type="button" data-act="revert-once" data-id="${s.id}">この日の変更を取り消して、いつもの予定に戻す</button>` : ""}
    <label class="field"><span>用件</span><input type="text" id="ed-title" maxlength="40" value="${esc(s.title)}" required></label>
    <div class="row">
      <label class="field"><span>時刻</span><input type="time" id="ed-start" value="${t(s.start_time)}"></label>
      <label class="field"><span>戻る・終わる時刻（未定なら空欄）</span><input type="time" id="ed-end" value="${t(s.end_time)}"></label>
    </div>
    ${weekly ? `<fieldset id="ed-weekdays-wrap" hidden><legend>くりかえす曜日</legend><div class="chips" id="ed-weekdays"></div></fieldset>` : ""}
    <label class="check"><input type="checkbox" id="ed-notify" ${s.notify_from ? "checked" : ""}> 時間になったら表示端末でお知らせする</label>
    <div class="row" id="ed-notify-times" ${s.notify_from ? "" : "hidden"}>
      <label class="field"><span>お知らせ開始</span><input type="time" id="ed-nfrom" value="${t(s.notify_from)}"></label>
      <label class="field"><span>お知らせ終了</span><input type="time" id="ed-nuntil" value="${t(s.notify_until)}"></label>
      <label class="check"><input type="checkbox" id="ed-nsound" ${s.notify_from && !s.notify_sound ? "" : "checked"}> 鳩の音と読み上げ</label>
    </div>
    <label class="field"><span>本人の画面に小さく添える一言（20文字まで。例：芋煮会と運動会）</span><input type="text" id="ed-display" maxlength="20" value="${esc(s.display_text || "")}"></label>
    <label class="field"><span>家族メモ（本人の画面には出ません）</span><textarea id="ed-memo" maxlength="400">${esc(s.family_memo || "")}</textarea></label>
    <label class="check"><input type="checkbox" id="ed-gazette" ${s.memo_for_gazette ? "checked" : ""}> このメモを鳩月報に使ってよい</label>
    <label class="check"><input type="checkbox" id="ed-home" ${s.show_on_home === false ? "" : "checked"}> 本人のふだんの画面にも出す（外すと、お知らせのときだけ出ます）</label>
    <div class="row">
      <button class="btn primary" type="submit" id="ed-submit">変更を保存</button>
      <a class="btn" href="#${esc(edit.back)}">やめる</a>
    </div>
  </form>`;
}

function renderEditChips() {
  if (!edit) return;
  const s = state.schedules.find((x) => x.id === edit.id);
  if (!s || s.kind !== "weekly" || !$("ed-scope")) return;
  setHTML($("ed-scope"), [["once", "この日だけ変える"], ["from", "この日から先をずっと変える"]]
    .map(([k, l]) => `<button type="button" class="chip" data-act="ed-scope" data-v="${k}" aria-pressed="${edit.scope === k}">${l}</button>`).join(""));
  $("ed-once-wrap").hidden = edit.scope !== "once";
  $("ed-from-wrap").hidden = edit.scope !== "from";
  $("ed-weekdays-wrap").hidden = edit.scope !== "from";
  setHTML($("ed-weekdays"), S.WEEKDAYS.map((w, i) => `<button type="button" class="chip" data-act="ed-wd" data-v="${i}" aria-pressed="${edit.weekdays.has(i)}">${w}</button>`).join(""));
}

function readScheduleFields(prefix) {
  const v = (id) => $(prefix + id);
  const title = v("title").value.trim();
  if (!title) throw new Error("用件を入れてください");
  const row = {
    title,
    start_time: v("start").value || null,
    end_time: v("end").value || null,
    display_text: v("display").value.trim() || null,
    family_memo: v("memo").value.trim() || null,
    memo_for_gazette: v("gazette").checked,
    show_on_home: v("home").checked,
    notify_from: null, notify_until: null, notify_sound: true,
  };
  if (v("notify").checked) {
    const nf = v("nfrom").value, nu = v("nuntil").value;
    if (!nf || !nu) throw new Error("お知らせの開始と終了の時刻を入れてください");
    if (S.normTime(nu) <= S.normTime(nf)) throw new Error("お知らせ終了は、開始より後の時刻にしてください");
    Object.assign(row, { notify_from: nf, notify_until: nu, notify_sound: v("nsound").checked });
  }
  return row;
}

async function submitEdit() {
  const s = state.schedules.find((x) => x.id === edit.id);
  if (!s) throw new Error("この予定は見つかりません（削除されたかもしれません）");
  const row = readScheduleFields("ed-");
  let msg = "変更しました";
  if (s.kind === "once") {
    const { error } = await sb.from("schedules").update(row).eq("id", s.id);
    if (error) throw error;
  } else if (edit.scope === "once") {
    const date = $("ed-once-date").value;
    if (!date || date < state.today) throw new Error("変える日を、今日以降で選んでください");
    if (!S.occursOn(s, date)) throw new Error("その日は、この予定がくりかえす日ではありません");
    const { error } = await sb.rpc("change_schedule_once", { p_id: s.id, p_date: date, p_changes: row });
    if (error) throw error;
    msg = `${S.repeatLabel({ kind: "once", on_date: date })}だけ変更しました`;
  } else if (edit.scope === "from") {
    const from = $("ed-from-date").value;
    if (!from || from < state.today) throw new Error("変え始める日を、今日以降で選んでください");
    if (!edit.weekdays.size) throw new Error("くりかえす曜日を選んでください");
    const { error } = await sb.rpc("change_schedule_from", { p_id: s.id, p_from: from, p_changes: { ...row, weekdays: [...edit.weekdays].sort() } });
    if (error) throw error;
    msg = `${S.repeatLabel({ kind: "once", on_date: from })}から先を変更しました`;
  } else {
    throw new Error("「この日だけ」か「この日から先」かを選んでください");
  }
  toast(msg);
  const back = edit.back;
  edit = null;
  await refresh();
  location.hash = `#${back}`;
}

// 予定の追加フォーム（full=false は居間用の簡単版）
function addFormHTML(full) {
  return `<form class="card" id="add-form" novalidate>
    <h2>予定を追加</h2>
    <fieldset><legend>誰の予定</legend><div class="chips" id="add-person"></div></fieldset>
    <fieldset><legend>用件</legend>
      <div class="chips" id="add-presets"></div>
      <label class="field"><span class="hint">ボタンを選ぶか、自由に書きます</span><input type="text" id="add-title" maxlength="40" required></label>
    </fieldset>
    <fieldset><legend>いつ</legend>
      <div class="chips" id="add-when"></div>
      <label class="field" id="add-date-wrap" hidden><span>日付</span><input type="date" id="add-date"></label>
      <div class="chips" id="add-weekdays" hidden></div>
    </fieldset>
    <div class="row">
      <label class="field"><span>時刻</span><input type="time" id="add-start"></label>
      <button class="btn" type="button" data-act="now">今から</button>
      <label class="field"><span>戻る・終わる時刻（未定なら空欄）</span><input type="time" id="add-end"></label>
    </div>
    ${full ? `
    <details>
      <summary>くわしい設定（お知らせ・表示文・家族メモ）</summary>
      <div class="card" style="margin-top:8px">
        <label class="check"><input type="checkbox" id="add-notify"> 時間になったら表示端末でお知らせする</label>
        <div class="row" id="add-notify-times" hidden>
          <label class="field"><span>お知らせ開始</span><input type="time" id="add-nfrom"></label>
          <label class="field"><span>お知らせ終了</span><input type="time" id="add-nuntil"></label>
          <label class="check"><input type="checkbox" id="add-nsound" checked> 鳩の音と読み上げ</label>
        </div>
        <p class="hint">追加しただけでは鳴りません。鳴るのは、お知らせ開始の時刻になったときだけです。</p>
        <label class="field"><span>本人の画面に小さく添える一言（20文字まで）</span><input type="text" id="add-display" maxlength="20" placeholder="例：芋煮会と運動会"></label>
        <label class="field"><span>家族メモ（本人の画面には出ません）</span><textarea id="add-memo" maxlength="400"></textarea></label>
        <label class="check"><input type="checkbox" id="add-gazette"> このメモを鳩月報に使ってよい</label>
        <label class="check"><input type="checkbox" id="add-home" checked> 本人のふだんの画面にも出す（外すと、お知らせのときだけ出ます。ごはん・お薬は最初から外れています）</label>
      </div>
    </details>` : ""}
    <button class="btn primary" type="submit" id="add-submit">追加する</button>
  </form>`;
}

function renderChips() {
  if (!$("add-form")) return;
  const people = patientFirst();
  if (!draft.person || !person(draft.person)) draft.person = people[0]?.id || null;
  setHTML($("add-person"), people.map((p) => `<button type="button" class="chip" data-act="pick-person" data-id="${p.id}" aria-pressed="${p.id === draft.person}">${esc(p.name)}</button>`).join("")
    || `<span class="hint">先に「家と端末」で人を登録してください</span>`);
  const p = person(draft.person);
  const presets = p?.is_patient ? PRESETS_PATIENT : PRESETS_FAMILY;
  setHTML($("add-presets"), presets.map((t) => `<button type="button" class="chip" data-act="preset" data-v="${esc(t)}">${esc(t)}</button>`).join(""));
  const whens = [["today", "今日"], ["tomorrow", "明日"], ["date", "日付を選ぶ"]];
  if (role() === "family") whens.push(["weekly", "毎週くりかえす"]);
  setHTML($("add-when"), whens.map(([k, l]) => `<button type="button" class="chip" data-act="pick-when" data-v="${k}" aria-pressed="${draft.when === k}">${l}</button>`).join(""));
  $("add-date-wrap").hidden = draft.when !== "date";
  $("add-weekdays").hidden = draft.when !== "weekly";
  setHTML($("add-weekdays"), S.WEEKDAYS.map((w, i) => `<button type="button" class="chip" data-act="pick-wd" data-v="${i}" aria-pressed="${draft.weekdays.has(i)}">${w}</button>`).join("")
    + `<button type="button" class="chip" data-act="pick-wd-all">毎日</button>`);
}

function msgFormHTML() {
  return `<form class="card" id="msg-form" novalidate>
      <h2>家族からの知らせ</h2>
      <p class="hint">表示端末の下のほうに出ます。音で知らせるのは、チェックしたときだけです。</p>
      <fieldset><legend>誰から</legend><div class="chips" id="msg-from"></div></fieldset>
      <label class="field"><span>ひとこと（200文字まで）</span><textarea id="msg-body" maxlength="200" required placeholder="例：5時ごろ帰ります"></textarea></label>
      <label class="field"><span>表示する時間</span>
        <select id="msg-dur"><option value="60">1時間</option><option value="180" selected>3時間</option><option value="eod">今日いっぱい</option></select></label>
      <label class="check"><input type="checkbox" id="msg-sound"> 鳩の音と読み上げで知らせる</label>
      <button class="btn primary" type="submit" id="msg-submit">届ける</button>
    </form>
    <section class="card"><h2>表示中・これから表示する知らせ</h2><ul class="list" id="msg-list"></ul></section>`;
}
let msgFrom = null;
let placeResults = [];
function msgFromChipsHTML() {
  const fam = state.people.filter((p) => !p.is_patient);
  if (!msgFrom || !person(msgFrom)) msgFrom = fam[0]?.id || null;
  return fam.map((p) => `<button type="button" class="chip" data-act="msg-from" data-id="${p.id}" aria-pressed="${p.id === msgFrom}">${esc(p.name)}</button>`).join("")
    || `<span class="hint">「家と端末」で家族を登録すると選べます（なしでも届けられます）</span>`;
}
function msgListHTML() {
  return state.messages.slice().sort((a, b) => Date.parse(b.show_from) - Date.parse(a.show_from)).map((m) => {
    const p = person(m.person_id);
    return `<li><div class="main">${p ? `<strong>${esc(p.name)}</strong>　` : ""}${esc(m.body)}
      <div class="sub">${jstHM(new Date(m.show_from))}〜${jstHM(new Date(m.show_until))}${m.with_sound ? "・音あり" : ""}</div></div>
      <button class="btn small danger" data-act="msg-delete" data-id="${m.id}">取り下げる</button></li>`;
  }).join("") || `<li class="hint">いまはありません。</li>`;
}

function settingsHTML() {
  return `
  <section class="card"><h2>予定を表示する人</h2>
    <ul class="list" id="people-list"></ul>
    <form id="person-form" class="row">
      <label class="field"><span>名前</span><input type="text" id="person-name" maxlength="20" required placeholder="例：お父さん、母、葵依"></label>
      <label class="check"><input type="checkbox" id="person-patient"> 本人（表示の一番上に大きく出す）</label>
      <button class="btn" type="submit">追加</button>
    </form>
  </section>
  <section class="card"><h2>端末と家族を登録する</h2>
    <p class="hint">登録したい端末でアカウントを作ってログインし、ここで作ったコードを入れます。コードの期限は1日です。</p>
    <form id="invite-form" class="row">
      <label class="field"><span>名前</span><input type="text" id="invite-name" maxlength="30" required placeholder="例：鳩A／父の部屋"></label>
      <label class="field"><span>役割</span><select id="invite-role">
        <option value="display">父の部屋（見るだけ）</option>
        <option value="living">居間（見る＋予定の追加）</option>
        <option value="family">家族（全部を管理）</option></select></label>
      <button class="btn" type="submit">コードを作る</button>
    </form>
    <div id="invite-new"></div>
    <h2>使われていないコード</h2><ul class="list" id="invite-list"></ul>
    <h2>登録済み</h2><ul class="list" id="member-list"></ul>
  </section>
  <section class="card"><h2>鳩の名前</h2>
    <form id="pigeon-form" class="row">
      <label class="field"><span>名前（12文字まで。空欄なら名乗りません）</span><input type="text" id="pigeon-name" maxlength="12" placeholder="例：ぽーちゃん"></label>
      <button class="btn" type="submit">保存</button>
    </form>
    <p class="hint">お知らせのとき「くるっくー。<span id="pigeon-preview"></span>お父さん、6時半から夕ごはんです。」のように名乗ります。</p>
  </section>
  <section class="card"><h2>お知らせの音</h2>
    <p class="hint">表示端末でお知らせが始まるときに鳴る音です。振り子時計は、時刻と取り違えないよう1回だけ鳴ります。</p>
    <div class="row">
      <label class="field"><span>音</span><select id="chime-kind">${sound.CHIME_KINDS.map((k) => `<option value="${k.value}" ${k.file ? "disabled" : ""}>${k.label}${k.file ? "（音の準備中）" : ""}</option>`).join("")}</select></label>
      <button class="btn" type="button" data-act="chime-try">試しに鳴らす</button>
      <button class="btn primary" type="button" data-act="chime-save">保存</button>
    </div>
  </section>
  <section class="card"><h2>夜の表示</h2>
    <p class="hint">この時間は、表示端末が暗い画面になり、日付と時計と「今は夜です」だけを出します（画面は消えません）。</p>
    <form id="night-form" class="row">
      <label class="field"><span>夜の始まり</span><input type="time" id="night-start" required></label>
      <label class="field"><span>朝（夜の終わり）</span><input type="time" id="night-end" required></label>
      <button class="btn" type="submit">保存</button>
    </form>
  </section>
  <section class="card"><h2>天気の地域</h2>
    <p class="hint">いまの設定：<strong id="weather-label"></strong></p>
    <form id="place-form" class="row">
      <label class="field"><span>地名で探す</span><input type="text" id="place-q" maxlength="30" placeholder="例：泉区、仙台" required></label>
      <button class="btn" type="submit">探す</button>
    </form>
    <ul class="list" id="place-results"></ul>
  </section>
  <section class="card"><h2>このスマホ</h2>
    <p class="hint">${esc(state.session.user.email)}（${esc(state.member.display_name)}）</p>
    <button class="btn danger" data-act="logout-ask">ログアウト</button>
  </section>`;
}
const roleLabel = (r) => ({ display: "父の部屋（見るだけ）", living: "居間", family: "家族" }[r] || r);
function peopleListHTML() {
  return patientFirst().map((p) => `<li><div class="main">${esc(p.name)}${p.is_patient ? '<span class="badge">本人</span>' : ""}</div></li>`).join("")
    || `<li class="hint">まだいません。最初に「本人」と家族を登録してください。</li>`;
}
function memberListHTML() {
  return state.members.map((m) => `<li><div class="main">${esc(m.display_name)}<span class="badge">${roleLabel(m.role)}</span></div></li>`).join("");
}
function inviteListHTML() {
  return state.invites.map((i) => `<li><div class="main"><span class="code" style="font-size:1.2rem">${esc(i.code)}</span>　${esc(i.display_name)}<span class="badge">${roleLabel(i.role)}</span></div>
    <button class="btn small danger" data-act="invite-delete" data-id="${esc(i.code)}">取り消す</button></li>`).join("")
    || `<li class="hint">ありません。</li>`;
}

// ---------- 操作 ----------
let confirmTarget = null;
function needsConfirm(btn, label) {
  const key = btn.dataset.act + ":" + (btn.dataset.id || "");
  if (confirmTarget === key) { confirmTarget = null; return false; }
  confirmTarget = key;
  const old = btn.textContent;
  btn.textContent = label;
  setTimeout(() => { if (confirmTarget === key) { confirmTarget = null; btn.textContent = old; } }, 4000);
  return true;
}

async function guarded(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { await fn(); } catch (e) { toast(errMsg(e), true); } finally { btn.disabled = false; }
}

$app.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act, id = btn.dataset.id;
  if (act === "pigeon") { onPigeon(); return; }
  if (act === "stop-sound") { sound.stopAll(); tick(); return; }
  if (act === "chime-try") { await sound.unlock(); sound.announce({ times: 2, kind: $("chime-kind").value, text: `くるっくー。${pigeonName() ? pigeonName() + "です。" : ""}お父さん、6時半から夕ごはんです。` }); return; }
  if (act === "chime-save") guarded(btn, async () => {
    const kind = $("chime-kind").value;
    const { error } = await sb.from("households").update({ chime_kind: kind }).eq("id", state.member.household_id);
    if (error) throw error;
    delete $("chime-kind").dataset.touched;
    toast(`お知らせの音を「${sound.CHIME_KINDS.find((k) => k.value === kind).label}」にしました`);
    await refresh();
  });
  if (act === "unlock") { const ok = await sound.unlock(); toast(ok ? "音を出せるようになりました" : "音を有効にできませんでした", !ok); tick(); }
  if (act === "unlock-test") { await sound.unlock(); sound.announce({ times: 1, text: `くるっくー。${pigeonName() ? pigeonName() + "です。" : ""}音のテストです。` }); }
  if (act === "sheet-close") $("sheet").innerHTML = "";
  if (act === "logout-ask") { if (!needsConfirm(btn, "もう一度押すとログアウト")) { stopRealtime(); await sb.auth.signOut(); location.hash = ""; } }
  if (act === "logout") { stopRealtime(); await sb.auth.signOut(); location.hash = ""; }
  if (act === "pick-person") { draft.person = id; renderChips(); }
  if (act === "preset") { $("add-title").value = btn.dataset.v; syncHomeDefault(); }
  if (act === "pick-when") { draft.when = btn.dataset.v; renderChips(); }
  if (act === "pick-wd") { const d = Number(btn.dataset.v); draft.weekdays.has(d) ? draft.weekdays.delete(d) : draft.weekdays.add(d); renderChips(); }
  if (act === "pick-wd-all") { draft.weekdays = new Set([0, 1, 2, 3, 4, 5, 6]); renderChips(); }
  if (act === "now") { $("add-start").value = S.nowParts(new Date(), TIMEZONE).time.slice(0, 5); syncNotifyDefaults(); }
  if (act === "place-pick") guarded(btn, async () => {
    const p = placeResults[Number(btn.dataset.i)];
    if (!p) return;
    const { error } = await sb.from("households").update({ weather_label: p.label, weather_lat: p.lat, weather_lon: p.lon }).eq("id", state.member.household_id);
    if (error) throw error;
    setHTML($("place-results"), "");
    toast(`天気の地域を「${p.label}」にしました`);
    await refresh();
    updateWeather(true);
  });
  if (act === "msg-from") { msgFrom = id; setHTML($("msg-from"), msgFromChipsHTML()); }
  if (act === "cancel-day") guarded(btn, async () => {
    const { error } = await sb.from("schedule_exceptions").insert({ schedule_id: id, on_date: state.today });
    if (error && error.code !== "23505") throw error;
    toast("今日だけ中止にしました"); await refresh();
  });
  if (act === "uncancel") guarded(btn, async () => {
    const { error } = await sb.from("schedule_exceptions").delete().eq("schedule_id", id).eq("on_date", state.today);
    if (error) throw error; toast("中止を取り消しました"); await refresh();
  });
  if (act === "rescue-retry") openRescue(state.view);
  if (act === "note-toggle") guarded(btn, async () => {
    const n = notesState.list.find((x) => x.id === id);
    const { error } = await sb.from("daily_notes").update({ use_in_gazette: !n.use_in_gazette }).eq("id", id);
    if (error) throw error; await openNotes();
  });
  if (act === "note-delete") { if (needsConfirm(btn, "もう一度押すと削除")) return; guarded(btn, async () => {
    const n = notesState.list.find((x) => x.id === id);
    const { error } = await sb.from("daily_notes").delete().eq("id", id);
    if (error) throw error;
    if (n?.photo_path) await sb.storage.from("memories").remove([n.photo_path]);
    toast("削除しました"); await openNotes();
  }); }
  if (act === "gz-make") guarded(btn, () => makeGazette(false));
  if (act === "gz-overwrite") { if (needsConfirm(btn, "もう一度押すと作り直します")) return; guarded(btn, () => makeGazette(true)); }
  if (act === "gz-open") { const g = gz.list.find((x) => x.id === id); if (g) { gz.editing = false; await showPaper(g); $("gz-paper").scrollIntoView({ behavior: "smooth" }); } }
  if (act === "gz-edit") { gz.editing = true; renderPaper(); }
  if (act === "gz-cancel") { gz.editing = false; renderPaper(); }
  if (act === "gz-photo") { gz.paper.photo_path = btn.dataset.path || null; renderPaper(); }
  if (act === "gz-save") guarded(btn, saveGazette);
  if (act === "rc-copy") {
    const t = $("rc-text");
    try { await navigator.clipboard.writeText(t.value); toast("文字をコピーしました"); }
    catch (_) { t.focus(); t.select(); toast("文字を選択しました。長押しでコピーしてください"); }
  }
  if (act === "rc-share") shareCard();
  if (act === "cloth-delete") { if (needsConfirm(btn, "もう一度押すと削除")) return; guarded(btn, async () => {
    const c = rescue.clothes.find((x) => x.id === id);
    const { error } = await sb.from("rescue_clothes").delete().eq("id", id);
    if (error) throw error;
    if (c?.photo_path) await sb.storage.from("rescue").remove([c.photo_path]);
    await loadRescue(); renderClothesEdit(); toast("削除しました");
  }); }
  if (act === "edit") {
    const s = state.schedules.find((x) => x.id === id);
    edit = { id, date: btn.dataset.date || state.today, scope: null, weekdays: new Set((s?.weekdays || []).map(Number)), back: btn.dataset.back || "plans" };
    if (location.hash === "#edit") mount(); else location.hash = "#edit";
  }
  if (act === "ed-scope") { edit.scope = btn.dataset.v; renderEditChips(); }
  if (act === "ed-wd") { const d = Number(btn.dataset.v); edit.weekdays.has(d) ? edit.weekdays.delete(d) : edit.weekdays.add(d); renderEditChips(); }
  if (act === "revert-once") { if (needsConfirm(btn, "もう一度押すと、いつもの予定に戻します")) return; guarded(btn, async () => {
    const { error } = await sb.rpc("revert_schedule_once", { p_once_id: id });
    if (error) throw error;
    toast("いつもの予定に戻しました");
    const back = edit?.back || "plans"; edit = null;
    await refresh(); location.hash = `#${back}`;
  }); }
  if (act === "delete") { if (needsConfirm(btn, "もう一度押すと削除")) return; guarded(btn, async () => {
    const { error } = await sb.from("schedules").delete().eq("id", id);
    if (error) throw error; toast("削除しました"); await refresh();
  }); }
  if (act === "msg-delete") guarded(btn, async () => {
    const { error } = await sb.from("messages").update({ show_until: new Date().toISOString() }).eq("id", id);
    if (error) throw error; toast("取り下げました"); await refresh();
  });
  if (act === "invite-delete") guarded(btn, async () => {
    const { error } = await sb.from("invites").delete().eq("code", id);
    if (error) throw error; await refresh();
  });
});

// 一度だけ設定されるシート（表示画面の外側に置かれる）用
document.addEventListener("click", (e) => {
  if (e.target.classList?.contains("sheet-backdrop")) e.target.remove();
});

// ごはん・お薬を選んだら「お知らせのときだけ」に（家族が自分で切り替えたら、それを優先）
function syncHomeDefault() {
  const h = $("add-home");
  if (h && !h.dataset.touched) h.checked = S.defaultShowOnHome($("add-title").value);
}

function syncNotifyDefaults(prefix = "add-") {
  const n = $(prefix + "notify");
  if (!n) return;
  $(prefix + "notify-times").hidden = !n.checked;
  const start = $(prefix + "start").value;
  if (n.checked && start) {
    if (!$(prefix + "nfrom").value) $(prefix + "nfrom").value = S.shiftTime(start, -10);
    if (!$(prefix + "nuntil").value) $(prefix + "nuntil").value = S.shiftTime(start, 5);
  }
}
$app.addEventListener("input", (e) => {
  if (["pigeon-name", "night-start", "night-end", "chime-kind", "add-home"].includes(e.target.id)) e.target.dataset.touched = "1";
  if (e.target.id === "add-title") syncHomeDefault();
});
$app.addEventListener("change", (e) => {
  if (e.target.id === "add-notify" || e.target.id === "add-start") syncNotifyDefaults("add-");
  if (e.target.id === "ed-notify" || e.target.id === "ed-start") syncNotifyDefaults("ed-");
  if (e.target.id === "gz-month") {
    gz.month = e.target.value; gz.paper = null; gz.editing = false; setHTML($("gz-paper"), ""); $("gz-status").textContent = "";
    const g = gz.list.find((x) => x.month.slice(0, 7) === gz.month); if (g) showPaper(g);
  }
  if (e.target.id === "rc-private") { rescue.withAddress = e.target.checked; setHTML($("rc-out"), ""); prepareShare(); }
  if (e.target.id === "rs-face") {
    const f = e.target.files[0];
    if (f) {
      $("rs-face-preview").innerHTML = `<img class="rs-thumb" src="${URL.createObjectURL(f)}" alt="選んだ写真">`;
      if (!$("rs-face-taken").value && f.lastModified) $("rs-face-taken").value = localDate(f.lastModified);
    }
  }
});

$app.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = e.submitter || form.querySelector('[type="submit"]');
  if (form.id === "login-form") return guarded(btn, () => submitLogin(btn.dataset.mode));
  if (form.id === "join-form") return guarded(btn, async () => {
    const { error } = await sb.rpc("join_household", { invite_code: $("join-code").value });
    if (error) throw error; toast("家に参加しました"); location.hash = ""; await loadMember();
  });
  if (form.id === "create-form") return guarded(btn, async () => {
    const { error } = await sb.rpc("create_household", { household_name: $("create-name").value.trim(), my_name: $("create-me").value.trim() });
    if (error) throw error; toast("家を作りました。次に人を登録しましょう"); location.hash = "#settings"; await loadMember();
  });
  if (form.id === "add-form") return guarded(btn, submitSchedule);
  if (form.id === "edit-form") return guarded(btn, submitEdit);
  if (form.id === "rescue-form") return guarded(btn, submitRescue);
  if (form.id === "note-form") return guarded(btn, submitNote);
  if (form.id === "cloth-form") return guarded(btn, async () => {
    if (rescue.clothes.length >= 6) throw new Error("よく着る服は6枚までです。先に1枚削除してください");
    const f = $("cloth-photo").files[0];
    const note = $("cloth-note").value.trim();
    if (!f && !note) throw new Error("写真かひとことを入れてください");
    const path = await uploadPhoto(f, "clothes");
    const { error } = await sb.from("rescue_clothes").insert({ photo_path: path, note: note || null, sort_order: rescue.clothes.length });
    if (error) { if (path) await sb.storage.from("rescue").remove([path]); throw error; }
    form.reset();
    await loadRescue(); renderClothesEdit(); toast("追加しました");
  });
  if (form.id === "msg-form") return guarded(btn, submitMessage);
  if (form.id === "night-form") return guarded(btn, async () => {
    const a = $("night-start").value, b = $("night-end").value;
    if (!a || !b) throw new Error("夜の始まりと朝の時刻を入れてください");
    if (a === b) throw new Error("夜の始まりと朝を、違う時刻にしてください");
    const { error } = await sb.from("households").update({ night_start: a, night_end: b }).eq("id", state.member.household_id);
    if (error) throw error;
    delete $("night-start").dataset.touched; delete $("night-end").dataset.touched;
    toast(`夜の表示を ${a}〜${b} にしました`);
    await refresh();
  });
  if (form.id === "pigeon-form") return guarded(btn, async () => {
    const name = $("pigeon-name").value.trim();
    const { error } = await sb.from("households").update({ pigeon_name: name || null }).eq("id", state.member.household_id);
    if (error) throw error;
    delete $("pigeon-name").dataset.touched;
    toast(name ? `鳩の名前を「${name}」にしました` : "鳩の名前を消しました");
    await refresh();
  });
  if (form.id === "place-form") return guarded(btn, async () => {
    const q = $("place-q").value.trim();
    if (!q) throw new Error("地名を入れてください");
    placeResults = await W.searchPlace(q);
    setHTML($("place-results"), placeResults.map((p, i) => `<li><div class="main">${esc(p.label)}</div><button class="btn small" type="button" data-act="place-pick" data-i="${i}">これにする</button></li>`).join("")
      || `<li class="hint">見つかりませんでした。市や区の名前で試してください。</li>`);
  });
  if (form.id === "person-form") return guarded(btn, async () => {
    const name = $("person-name").value.trim();
    if (!name) throw new Error("名前を入れてください");
    const { error } = await sb.from("people").insert({ name, is_patient: $("person-patient").checked, sort_order: state.people.length });
    if (error) throw error; form.reset(); toast(`${name} を登録しました`); await refresh();
  });
  if (form.id === "invite-form") return guarded(btn, async () => {
    const name = $("invite-name").value.trim();
    if (!name) throw new Error("名前を入れてください");
    const { data, error } = await sb.from("invites").insert({ display_name: name, role: $("invite-role").value }).select().single();
    if (error) throw error;
    form.reset();
    $("invite-new").innerHTML = `<div class="card"><p>「${esc(data.display_name)}」の招待コード</p><p class="code">${esc(data.code)}</p><p class="hint">登録する端末でログインして、このコードを入れてください。明日のこの時刻まで使えます。</p></div>`;
    await refresh();
  });
});

async function submitLogin(mode) {
  const email = $("login-email").value.trim(), password = $("login-pass").value;
  $("login-err").hidden = true;
  if (!email || password.length < 6) { $("login-err").textContent = "メールアドレスと6文字以上のパスワードを入れてください"; $("login-err").hidden = false; return; }
  if (mode === "up") {
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split("#")[0] } });
    if (error) throw error;
    if (!data.session) { $("login-err").textContent = "確認メールを送りました。メールのリンクを開いてから、ここでログインしてください。"; $("login-err").hidden = false; }
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }
}

async function submitSchedule() {
  const title = $("add-title").value.trim();
  const start = $("add-start").value || null;
  const end = $("add-end").value || null;
  if (!draft.person) throw new Error("誰の予定かを選んでください");
  if (!title) throw new Error("用件を入れてください");
  const row = { person_id: draft.person, title, start_time: start, end_time: end,
    show_on_home: $("add-home") ? $("add-home").checked : S.defaultShowOnHome(title) };
  if (draft.when === "weekly") {
    if (!draft.weekdays.size) throw new Error("くりかえす曜日を選んでください");
    Object.assign(row, { kind: "weekly", weekdays: [...draft.weekdays].sort(), valid_from: state.today });
  } else {
    const date = draft.when === "today" ? state.today : draft.when === "tomorrow" ? S.addDays(state.today, 1) : $("add-date").value;
    if (!date) throw new Error("日付を選んでください");
    Object.assign(row, { kind: "once", on_date: date });
  }
  if ($("add-notify")?.checked) {
    const nf = $("add-nfrom").value, nu = $("add-nuntil").value;
    if (!nf || !nu) throw new Error("お知らせの開始と終了の時刻を入れてください");
    if (S.normTime(nu) <= S.normTime(nf)) throw new Error("お知らせ終了は、開始より後の時刻にしてください");
    Object.assign(row, { notify_from: nf, notify_until: nu, notify_sound: $("add-nsound").checked });
  }
  if ($("add-display")) {
    row.display_text = $("add-display").value.trim() || null;
    row.family_memo = $("add-memo").value.trim() || null;
    row.memo_for_gazette = $("add-gazette").checked;
  }
  const { error } = await sb.from("schedules").insert(row);
  if (error) throw error;
  toast(`追加しました：${title}`);
  const keep = draft.person;
  $("add-form").reset();
  if ($("add-home")) delete $("add-home").dataset.touched;
  draft = freshDraft(keep);
  renderChips();
  syncNotifyDefaults();
  await refresh();
  if (role() === "living") location.hash = "#display";
}

async function submitMessage() {
  const body = $("msg-body").value.trim();
  if (!body) throw new Error("ひとことを入れてください");
  const dur = $("msg-dur").value;
  const until = dur === "eod" ? new Date(`${state.today}T23:59:59+09:00`) : new Date(Date.now() + Number(dur) * 60000);
  const { error } = await sb.from("messages").insert({
    person_id: msgFrom, body, show_until: until.toISOString(), with_sound: $("msg-sound").checked,
  });
  if (error) throw error;
  toast("届けました");
  $("msg-form").reset();
  await refresh();
}

boot().catch((e) => { $app.innerHTML = `<main class="page"><p class="error">起動できませんでした：${esc(errMsg(e))}</p></main>`; });
