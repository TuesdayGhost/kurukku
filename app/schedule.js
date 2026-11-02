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
