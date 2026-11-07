// 予定の計算（画面やデータベースに依存しない部分）。node でテストできる。

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 指定タイムゾーンでの「今」を、日付・曜日・時刻の文字列で返す */
export function nowParts(d = new Date(), tz = "Asia/Tokyo") {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return {
    date,
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
    dow: dowOf(date),
    time: `${p.hour}:${p.minute}:${p.second}`,
  };
}

export function dowOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "12:00:00" / "12:00" → 秒まで揃えた "12:00:00" */
export function normTime(t) {
  if (!t) return null;
  const [h, m = "00", s = "00"] = t.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}:${s.padStart(2, "0")}`;
}

/** 表示用 "12:00" */
export function hm(t) {
  return t ? normTime(t).slice(0, 5) : "";
}

/** 読み上げ用 "12時" / "12時30分" */
export function speechTime(t) {
  const [h, m] = normTime(t).split(":").map(Number);
  return m ? `${h}時${m}分` : `${h}時`;
}

/** 時刻を分単位でずらす（0:00〜23:59 に収める） */
export function shiftTime(t, minutes) {
  const [h, m] = normTime(t).split(":").map(Number);
  const total = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + minutes));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** その日に予定があるか（中止は別に判定） */
export function occursOn(s, dateStr) {
  if (s.kind === "once") return s.on_date === dateStr;
  if (s.kind === "weekly") {
    if (s.valid_from && dateStr < s.valid_from) return false;
    if (s.valid_until && dateStr > s.valid_until) return false;
    return (s.weekdays || []).map(Number).includes(dowOf(dateStr));
  }
  return false;
}

export function sortKey(s) {
  return normTime(s.start_time) || normTime(s.notify_from) || "99:99:99";
}

/** その日の予定（中止を除き、時刻順。時刻なしは最後） */
export function occurrencesOn(schedules, exceptions, dateStr) {
  const cancelled = new Set(
    exceptions.filter((e) => e.on_date === dateStr).map((e) => e.schedule_id),
  );
  return schedules
    .filter((s) => occursOn(s, dateStr) && !cancelled.has(s.id))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || (a.title || "").localeCompare(b.title || ""));
}

/** 今お知らせ中の予定（開始 <= 今 < 終了）。時刻の早い順に全て返す */
export function activeNotices(occurrences, time) {
  const now = normTime(time);
  return occurrences
    .filter((s) => s.notify_from && s.notify_until && normTime(s.notify_from) <= now && now < normTime(s.notify_until))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

/** 表示期間中の家族の知らせ（新しい順） */
export function activeMessages(messages, nowMs = Date.now()) {
  return messages
    .filter((m) => Date.parse(m.show_from) <= nowMs && nowMs < Date.parse(m.show_until))
    .sort((a, b) => Date.parse(b.show_from) - Date.parse(a.show_from));
}

/** 通知の重複記録を防ぐ鍵（全端末で同じ値になる） */
export function noticeKey(scheduleId, dateStr) {
  return `notify:${scheduleId}:${dateStr}`;
}

/** 予定の時刻表示 "12:00" / "14:00〜16:00" / "" */
export function timeLabel(s) {
  const a = hm(s.start_time), b = hm(s.end_time);
  if (a && b) return `${a}〜${b}`;
  if (a) return a;
  if (b) return `〜${b}`;
  return "";
}

/** 予定の頻度表示 */
export function repeatLabel(s) {
  if (s.kind === "once") {
    const [, m, d] = s.on_date.split("-").map(Number);
    return `${m}月${d}日（${WEEKDAYS[dowOf(s.on_date)]}）`;
  }
  const days = (s.weekdays || []).map(Number).sort();
  if (days.length === 7) return "毎日";
  return "毎週 " + days.map((d) => WEEKDAYS[d]).join("・");
}

/** 読み上げ用の話し言葉の時刻 "6時半" / "9時15分" / "12時"（午前午後は言わない） */
export function spokenTime(t) {
  const [h24, m] = normTime(t).split(":").map(Number);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  if (m === 0) return `${h}時`;
  if (m === 30) return `${h}時半`;
  return `${h}時${m}分`;
}

/**
 * 時計の表示（11/5 決定：時計だけ12時間表記に「午前・午後」を付ける。予定の時刻は 9:00 のまま）
 * "18:30:00" → { ampm: "午後", hm: "6:30" }。0時台と12時台は 12 と書く（読み上げの spokenTime と同じ）
 */
export function clock12(t) {
  const [h24, m] = normTime(t).split(":").map(Number);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return { ampm: h24 < 12 ? "午前" : "午後", hm: `${h}:${String(m).padStart(2, "0")}` };
}

function intro(pigeonName) {
  return pigeonName ? `くるっくー。${pigeonName}です。` : "くるっくー。";
}

/**
 * お知らせの読み上げ文（11/2 決定：時刻を先に言う）
 *   本人：「くるっくー。ぽーちゃんです。お父さん、6時半から夕ごはんです。」
 *   家族：「くるっくー。ぽーちゃんです。母は買い物です。4時半に帰ってきます。」
 */
export function noticeSpeech(s, person, pigeonName = "") {
  const name = person?.name || "";
  const extra = s.display_text ? s.display_text : "";
  if (!person || person.is_patient) {
    const call = name ? `${name}、` : "";
    const body = s.start_time ? `${spokenTime(s.start_time)}から${s.title}です。` : `${s.title}です。`;
    return `${intro(pigeonName)}${call}${body}${extra}`;
  }
  let body = s.start_time ? `${name}は、${spokenTime(s.start_time)}から${s.title}です。` : `${name}は、${s.title}です。`;
  if (s.end_time) body += `${spokenTime(s.end_time)}に帰ってきます。`;
  return `${intro(pigeonName)}${body}${extra}`;
}

/** 家族からの知らせの読み上げ文 */
export function messageSpeech(m, person, pigeonName = "") {
  const from = person ? `${person.name}から、` : "";
  return `${intro(pigeonName)}${from}お知らせです。${m.body}`;
}

/** 夜の時間帯か（0時をまたぐ設定にも対応。開始=終了なら夜なし） */
export function isNight(time, start = "21:00", end = "06:00") {
  const t = normTime(time), a = normTime(start), b = normTime(end);
  if (a === b) return false;
  return a < b ? a <= t && t < b : t >= a || t < b;
}

/** ごはん・お薬は、最初から「お知らせのときだけ」にする（11/4 決定） */
export function defaultShowOnHome(title) {
  return !/(ごはん|食事|薬)/.test(title || "");
}

/**
 * 本人のふだんの画面に出す予定（11/4 決定）
 * - 「お知らせのときだけ」の予定は、お知らせ中だけ出す
 * - 終わった予定は消す（終わる時刻、なければ予定の時刻を過ぎたら）。お知らせ中なら残す
 * - 時刻のない予定は一日中出す
 */
export function homeItems(occurrences, active, time) {
  const now = normTime(time);
  const activeIds = new Set(active.map((s) => s.id));
  return occurrences.filter((s) => {
    if (activeIds.has(s.id)) return true;
    if (s.show_on_home === false) return false;
    const endish = normTime(s.end_time || s.start_time);
    return !endish || endish >= now;
  });
}

/**
 * 「今日の予定を聞く」で読む文（11/5 決定。天気は読まない）
 * 日付・曜日・時刻 → 本人のこれからの予定 → 家族のこれからの予定（戻る時刻も） → 家族の知らせ
 * items は本人のふだんの画面に出ている予定（homeItems の結果）を渡す
 */
export function readAloudText({ np, items, people, messages = [], pigeonName = "" }) {
  const parts = [intro(pigeonName)];
  // 今の時刻は朝か夕方か分かるよう「午前・午後」を付ける（予定の時刻はお知らせと同じ読み方）
  const ampm = Number(normTime(np.time).slice(0, 2)) < 12 ? "午前" : "午後";
  parts.push(`${np.m}月${np.d}日、${WEEKDAYS[np.dow]}曜日。今は${ampm}${spokenTime(np.time)}です。`);
  const now = normTime(np.time);
  const upcoming = items.filter((s) => !s.start_time || normTime(s.start_time) >= now || (s.end_time && normTime(s.end_time) >= now));
  const what = (s) => `${s.start_time ? `${spokenTime(s.start_time)}から` : ""}${s.title}${s.display_text ? `、${s.display_text}` : ""}`;
  const patient = people.find((p) => p.is_patient);
  const mine = patient ? upcoming.filter((s) => s.person_id === patient.id) : [];
  parts.push(mine.length ? `今日の予定は、${mine.map(what).join("。")}です。` : "このあとの予定はありません。");
  for (const p of people.filter((x) => !x.is_patient)) {
    const theirs = upcoming.filter((s) => s.person_id === p.id);
    if (!theirs.length) continue;
    parts.push(theirs.map((s) => `${p.name}は、${what(s)}${s.end_time ? `で、${spokenTime(s.end_time)}に帰ってきます` : ""}。`).join(""));
  }
  for (const m of messages) {
    const p = people.find((x) => x.id === m.person_id);
    parts.push(`${p ? p.name + "から、" : ""}お知らせです。${m.body}`);
  }
  return parts.join("");
}
