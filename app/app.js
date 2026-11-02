// くるっくー 本体
// 画面：ログイン → （家に未所属なら）参加・家の作成 → 役割ごとの画面
//   display（父の部屋）: 表示画面だけ
//   living（居間）     : 表示画面 ＋ 予定の簡単追加
//   family（家族）     : 今日・予定の追加・予定一覧・知らせ・家と端末、表示画面のプレビュー
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY, TIMEZONE } from "./config.js";
import * as S from "./schedule.js";
import * as sound from "./sound.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
const $app = document.getElementById("app");

const LIVING_IDLE_MS = 90 * 1000;      // 居間：最後の操作からこの時間で表示画面に戻る（仮置き）
const REFRESH_MS = 5 * 60 * 1000;      // 念のための定期再読込
const PRESETS_PATIENT = ["朝ごはん", "お昼ごはん", "夕ごはん", "お薬", "デイ", "お風呂"];
const PRESETS_FAMILY = ["仕事", "買い物", "病院", "リハビリ", "出かける"];

const state = {
  session: null,
  member: null,
  household: null,
  people: [], schedules: [], exceptions: [], messages: [], members: [], invites: [],
  lastSync: null, syncError: null, rt: "",
  today: S.nowParts(new Date(), TIMEZONE).date,
  view: "", lastInvite: null,
};
let draft = freshDraft();
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
  addEventListener("hashchange", mount);
  addEventListener("online", refresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { refresh(); if (state.view === "display") keepAwake(); }
  });
  for (const ev of ["pointerdown", "keydown", "input"]) addEventListener(ev, () => { lastInteraction = Date.now(); }, { passive: true });
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
  for (const table of ["schedules", "schedule_exceptions", "messages", "people"]) {
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
  return ["today", "add", "plans", "messages", "settings", "display"].includes(h) ? h : "today";
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
  fill();
  tick();
}

// データが変わったときに、入力欄を消さずに一覧部分だけ書き直す
function fill() {
  const v = state.view;
  if (v === "add") { renderChips(); }
  if (v === "today") setHTML($("today-list"), todayListHTML());
  if (v === "plans") setHTML($("plans-list"), plansListHTML());
  if (v === "messages") { setHTML($("msg-from"), msgFromChipsHTML()); setHTML($("msg-list"), msgListHTML()); }
  if (v === "settings") { setHTML($("people-list"), peopleListHTML()); setHTML($("member-list"), memberListHTML()); setHTML($("invite-list"), inviteListHTML()); }
  const hn = $("hh-name"); if (hn) hn.textContent = state.household?.name || "";
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
  if (role() === "living" && state.view === "add" && Date.now() - lastInteraction > LIVING_IDLE_MS) {
    location.hash = "#display";  // 入力途中の内容は保存せずに戻る（仮置き）
  }
}

function speechText(s) {
  const p = person(s.person_id);
  const who = p && !p.is_patient ? `${p.name}、` : "";
  const when = s.start_time ? `、${S.speechTime(s.start_time)}です。` : "です。";
  return `${who}${s.title}${when}${s.display_text ? s.display_text : ""}`;
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
      sound.announce({ times: 1, text: `${p ? p.name + "から、" : ""}お知らせです。${m.body}` });
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

async function onAnyTap() {
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

// ---------- 表示画面 ----------
function viewDisplay() {
  return `
  <div class="display">
    <section class="when" id="when" aria-label="今日の日付と時刻">
      <p class="greet" id="greet"></p>
      <p class="date num" id="date"></p>
      <p class="weekday" id="wday"></p>
      <p class="clock num" id="clock"></p>
    </section>
    <section class="plan" id="plan" aria-label="今日の予定"></section>
    <section class="news" aria-label="家族からの知らせ">
      <div id="msgs" class="msgs"></div>
      <div class="status-line" id="status"></div>
    </section>
  </div>
  <div id="notice"></div>
  <div id="sheet"></div>`;
}

function updateDisplay(np, occ, active) {
  const hour = Number(np.time.slice(0, 2));
  $("greet").textContent = hour >= 4 && hour < 11 ? "おはようございます" : "";
  $("date").textContent = `${np.m}月${np.d}日`;
  $("wday").textContent = `${S.WEEKDAYS[np.dow]}曜日`;
  $("clock").textContent = np.time.slice(0, 5);

  const now = np.time;
  const groups = patientFirst().map((p) => {
    const items = occ.filter((s) => s.person_id === p.id);
    const li = items.map((s) => {
      const endish = S.normTime(s.end_time || s.start_time);
      const past = endish && endish < now && !active.includes(s);
      const what = p.is_patient ? (s.display_text || s.title) : s.title;
      return `<li class="${past ? "past" : ""}"><span class="t">${esc(S.timeLabel(s))}</span><span class="what">${esc(what)}</span></li>`;
    }).join("");
    return `<div class="who ${p.is_patient ? "patient" : ""}"><h2>${esc(p.name)}</h2>${li ? `<ul>${li}</ul>` : `<p class="none">今日の予定はありません</p>`}</div>`;
  }).join("");
  setHTML($("plan"), groups || `<div class="who"><p class="none">まだ人が登録されていません</p></div>`);

  const msgs = S.activeMessages(state.messages).slice(0, 3).map((m) => {
    const p = person(m.person_id);
    return `<div class="msg">${p ? `<span class="from">${esc(p.name)}</span>` : ""}${esc(m.body)}</div>`;
  }).join("");
  setHTML($("msgs"), msgs);

  const parts = [];
  if (state.syncError) parts.push(`<span class="warn">接続できません（${state.lastSync ? jstHM(state.lastSync) + " の情報" : "情報なし"}）</span>`);
  else if (state.lastSync) parts.push(`<span>更新 ${jstHM(state.lastSync)}</span>`);
  if (!sound.isReady()) parts.push(`<button class="tap-sound" type="button" data-act="unlock">音を出すには、画面に一度さわってください</button>`);
  if (role() === "living") parts.push(`<a class="btn primary" href="#add">予定を追加</a>`);
  if (role() === "family") parts.push(`<a class="btn small" href="#today">家族の画面へ</a>`);
  setHTML($("status"), parts.join(""));

  if (active.length) {
    const items = active.map((s) => {
      const p = person(s.person_id);
      return `<div class="item">${p && !p.is_patient ? `<div class="who-n">${esc(p.name)}</div>` : ""}<div class="what-n">${esc(s.display_text || s.title)}</div>${s.start_time ? `<div class="time-n">${esc(S.hm(s.start_time))}</div>` : ""}</div>`;
    }).join("");
    setHTML($("notice"), `<div class="notice ${active.length > 1 ? "many" : ""}" role="alert">
      <div class="top"><span>${np.m}月${np.d}日 ${S.WEEKDAYS[np.dow]}曜日</span><span class="clock-s">${np.time.slice(0, 5)}</span></div>
      <div class="items">${items}</div>
      <div class="pigeon"><span>くるっくー　お知らせです</span>${sound.isReady() ? "" : `<button class="tap-sound" type="button" data-act="unlock">音を出すには、画面に一度さわってください</button>`}</div></div>`);
  } else {
    setHTML($("notice"), "");
  }
}

// 時計を長押しすると端末メニュー（設定は変えられない。音の有効化とログアウトだけ）
let pressTimer = null;
addEventListener("pointerdown", (e) => {
  if (state.view !== "display" || !e.target.closest?.("#when")) return;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(openSheet, 2500);
});
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
    <header class="bar"><h1>くるっくー</h1></header>
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
    <header class="bar"><h1>くるっくー</h1><button class="btn small" data-act="logout">ログアウト</button></header>
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
  const tabs = [["today", "今日"], ["add", "予定を追加"], ["plans", "予定一覧"], ["messages", "知らせ"], ["settings", "家と端末"], ["display", "表示画面"]]
    .map(([k, label]) => `<a href="#${k}" ${k === v ? 'aria-current="page"' : ""}>${label}</a>`).join("");
  let body = "";
  if (v === "today") body = `<section class="card"><h2>今日の予定</h2><ul class="list" id="today-list"></ul></section>`;
  if (v === "add") body = addFormHTML(true);
  if (v === "plans") body = `<section class="card"><h2>予定一覧</h2><p class="hint">毎週の予定と、今日以降の予定です。繰り返しの内容を変えたいときは、いったん削除して追加し直してください（変更の画面はこれから作ります）。</p><ul class="list" id="plans-list"></ul></section>`;
  if (v === "messages") body = msgFormHTML();
  if (v === "settings") body = settingsHTML();
  return `<main class="page">
    <header class="bar"><h1>くるっくー <span class="hint" id="hh-name"></span></h1></header>
    <nav class="tabs" aria-label="画面">${tabs}</nav>
    ${state.syncError ? `<p class="error">接続できません：${esc(state.syncError)}</p>` : ""}
    ${body}
  </main>`;
}

function scheduleLine(s, extra = "") {
  const p = person(s.person_id);
  const badges = [];
  if (s.kind === "weekly") badges.push(S.repeatLabel(s));
  if (s.notify_from) badges.push(`お知らせ ${S.hm(s.notify_from)}〜${S.hm(s.notify_until)}${s.notify_sound ? "" : "（音なし）"}`);
  return `<div class="main"><strong class="num">${esc(S.timeLabel(s) || "時刻なし")}</strong>　${esc(s.title)}
    <span class="badge">${esc(p ? p.name : "?")}</span>${badges.map((b) => `<span class="badge">${esc(b)}</span>`).join("")}
    ${s.display_text ? `<div class="sub">表示：${esc(s.display_text)}</div>` : ""}
    ${s.family_memo ? `<div class="sub">家族メモ：${esc(s.family_memo)}${s.memo_for_gazette ? "（月報に使う）" : ""}</div>` : ""}
    ${extra}</div>`;
}

function todayListHTML() {
  const occ = S.occurrencesOn(state.schedules, state.exceptions, state.today);
  const rows = occ.map((s) => `<li>${scheduleLine(s)}
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
    .filter((s) => s.kind === "weekly" || s.on_date >= state.today)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "weekly" ? -1 : 1) || (a.on_date || "").localeCompare(b.on_date || "") || S.sortKey(a).localeCompare(S.sortKey(b)));
  return list.map((s) => `<li>${scheduleLine(s, s.kind === "once" ? `<div class="sub">${esc(S.repeatLabel(s))}</div>` : "")}
    <button class="btn small danger" data-act="delete" data-id="${s.id}">削除</button></li>`).join("")
    || `<li class="hint">予定はまだありません。</li>`;
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
      <button class="btn small" type="button" data-act="now">今から</button>
      <label class="field"><span>戻る・終わる時刻</span><input type="time" id="add-end"><small>未定なら空欄</small></label>
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
        <label class="field"><span>本人向けの表示文（空なら用件をそのまま表示）</span><input type="text" id="add-display" maxlength="60" placeholder="例：今日はデイで紅葉を見に行きます。お迎え9時"></label>
        <label class="field"><span>家族メモ（本人の画面には出ません）</span><textarea id="add-memo" maxlength="400"></textarea></label>
        <label class="check"><input type="checkbox" id="add-gazette"> このメモを鳩月報に使ってよい</label>
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
  if (act === "unlock") { const ok = await sound.unlock(); toast(ok ? "音を出せるようになりました" : "音を有効にできませんでした", !ok); tick(); }
  if (act === "unlock-test") { await sound.unlock(); sound.announce({ times: 1, text: "くるっくー。音のテストです。" }); }
  if (act === "sheet-close") $("sheet").innerHTML = "";
  if (act === "logout-ask") { if (!needsConfirm(btn, "もう一度押すとログアウト")) { stopRealtime(); await sb.auth.signOut(); location.hash = ""; } }
  if (act === "logout") { stopRealtime(); await sb.auth.signOut(); location.hash = ""; }
  if (act === "pick-person") { draft.person = id; renderChips(); }
  if (act === "preset") { $("add-title").value = btn.dataset.v; }
  if (act === "pick-when") { draft.when = btn.dataset.v; renderChips(); }
  if (act === "pick-wd") { const d = Number(btn.dataset.v); draft.weekdays.has(d) ? draft.weekdays.delete(d) : draft.weekdays.add(d); renderChips(); }
  if (act === "pick-wd-all") { draft.weekdays = new Set([0, 1, 2, 3, 4, 5, 6]); renderChips(); }
  if (act === "now") { $("add-start").value = S.nowParts(new Date(), TIMEZONE).time.slice(0, 5); syncNotifyDefaults(); }
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

function syncNotifyDefaults() {
  const n = $("add-notify");
  if (!n) return;
  $("add-notify-times").hidden = !n.checked;
  const start = $("add-start").value;
  if (n.checked && start) {
    if (!$("add-nfrom").value) $("add-nfrom").value = S.shiftTime(start, -10);
    if (!$("add-nuntil").value) $("add-nuntil").value = S.shiftTime(start, 5);
  }
}
$app.addEventListener("change", (e) => {
  if (e.target.id === "add-notify" || e.target.id === "add-start") syncNotifyDefaults();
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
  if (form.id === "msg-form") return guarded(btn, submitMessage);
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
  const row = { person_id: draft.person, title, start_time: start, end_time: end };
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
