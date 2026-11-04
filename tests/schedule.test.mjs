// 予定の計算のテスト： node --test tests/schedule.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../app/schedule.js";

const lunch = { id: "L", person_id: "p", title: "お昼ごはん", kind: "weekly", weekdays: [0,1,2,3,4,5,6], start_time: "12:00:00", notify_from: "11:50:00", notify_until: "12:05:00" };
const day = { id: "D", person_id: "p", title: "デイ", kind: "weekly", weekdays: [1,4], start_time: "09:00:00", valid_from: "2026-11-02" };
const shop = { id: "S", person_id: "m", title: "買い物", kind: "once", on_date: "2026-11-02", start_time: "15:00:00", end_time: "16:00:00" };
const notime = { id: "N", person_id: "m", title: "メモ", kind: "once", on_date: "2026-11-02" };

test("日本時間の日付と曜日", () => {
  const np = S.nowParts(new Date("2026-11-01T15:30:00Z")); // JST 11/2 0:30 月曜
  assert.equal(np.date, "2026-11-02");
  assert.equal(np.dow, 1);
  assert.equal(np.time, "00:30:00");
});

test("日付をまたぐ計算", () => {
  assert.equal(S.addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(S.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(S.dowOf("2026-11-08"), 0);
});

test("毎週の予定は指定曜日だけ、開始日より前は出ない", () => {
  assert.ok(S.occursOn(day, "2026-11-02"));   // 月
  assert.ok(!S.occursOn(day, "2026-11-03"));  // 火
  assert.ok(S.occursOn(day, "2026-11-05"));   // 木
  assert.ok(!S.occursOn(day, "2026-10-29"));  // 開始前の木曜
  assert.ok(!S.occursOn({ ...day, valid_until: "2026-11-04" }, "2026-11-05"));
});

test("今日の予定：中止を除き時刻順、時刻なしは最後", () => {
  const occ = S.occurrencesOn([shop, notime, lunch, day], [], "2026-11-02");
  assert.deepEqual(occ.map((s) => s.id), ["D", "L", "S", "N"]);
  const cancelled = S.occurrencesOn([shop, lunch, day], [{ schedule_id: "L", on_date: "2026-11-02" }], "2026-11-02");
  assert.deepEqual(cancelled.map((s) => s.id), ["D", "S"]);
  const nextDay = S.occurrencesOn([lunch], [{ schedule_id: "L", on_date: "2026-11-02" }], "2026-11-03");
  assert.deepEqual(nextDay.map((s) => s.id), ["L"]);  // 中止はその日だけ
});

test("お知らせ 11:50〜12:05：開始で出て、終了で消える", () => {
  const occ = [lunch];
  assert.equal(S.activeNotices(occ, "11:49:59").length, 0);
  assert.equal(S.activeNotices(occ, "11:50:00").length, 1);
  assert.equal(S.activeNotices(occ, "12:04:59").length, 1);
  assert.equal(S.activeNotices(occ, "12:05:00").length, 0);
});

test("お知らせが重なったら、時刻の早い順に全部出す", () => {
  const med = { ...lunch, id: "M", title: "お薬", start_time: "11:55:00", notify_from: "11:45:00", notify_until: "12:00:00" };
  const act = S.activeNotices([lunch, med], "11:52:00");
  assert.deepEqual(act.map((s) => s.id), ["M", "L"]);
});

test("通知の重複防止の鍵は端末によらず同じ", () => {
  assert.equal(S.noticeKey("L", "2026-11-02"), "notify:L:2026-11-02");
});

test("表示用の文字", () => {
  assert.equal(S.timeLabel(shop), "15:00〜16:00");
  assert.equal(S.timeLabel(notime), "");
  assert.equal(S.speechTime("12:00:00"), "12時");
  assert.equal(S.speechTime("09:30"), "9時30分");
  assert.equal(S.shiftTime("12:00", -10), "11:50");
  assert.equal(S.shiftTime("00:05", -10), "00:00");
  assert.equal(S.repeatLabel(lunch), "毎日");
  assert.equal(S.repeatLabel(day), "毎週 月・木");
  assert.equal(S.repeatLabel(shop), "11月2日（月）");
});

test("知らせは表示期間中だけ", () => {
  const m = { id: "x", show_from: "2026-11-02T05:00:00Z", show_until: "2026-11-02T08:00:00Z" };
  assert.equal(S.activeMessages([m], Date.parse("2026-11-02T04:59:00Z")).length, 0);
  assert.equal(S.activeMessages([m], Date.parse("2026-11-02T06:00:00Z")).length, 1);
  assert.equal(S.activeMessages([m], Date.parse("2026-11-02T08:00:00Z")).length, 0);
});

test("読み上げの時刻は話し言葉で", () => {
  assert.equal(S.spokenTime("18:30:00"), "6時半");
  assert.equal(S.spokenTime("09:15"), "9時15分");
  assert.equal(S.spokenTime("12:00"), "12時");
  assert.equal(S.spokenTime("00:00"), "12時");
});

test("お知らせの読み上げ（11/2 決定の案2）", () => {
  const dad = { name: "お父さん", is_patient: true };
  const mom = { name: "母", is_patient: false };
  const dinner = { title: "夕ごはん", start_time: "18:30:00" };
  assert.equal(S.noticeSpeech(dinner, dad, "ぽーちゃん"), "くるっくー。ぽーちゃんです。お父さん、6時半から夕ごはんです。");
  assert.equal(S.noticeSpeech(dinner, dad, ""), "くるっくー。お父さん、6時半から夕ごはんです。");
  assert.equal(S.noticeSpeech({ title: "お薬" }, dad, "ぽーちゃん"), "くるっくー。ぽーちゃんです。お父さん、お薬です。");
  const shop = { title: "買い物", start_time: "15:00:00", end_time: "16:30:00" };
  assert.equal(S.noticeSpeech(shop, mom, "ぽーちゃん"), "くるっくー。ぽーちゃんです。母は、3時から買い物です。4時半に帰ってきます。");
  assert.equal(S.messageSpeech({ body: "6時半ごろ帰ります" }, { name: "葵依" }, "ぽーちゃん"), "くるっくー。ぽーちゃんです。葵依から、お知らせです。6時半ごろ帰ります");
});

test("夜の時間帯：21時〜翌6時（0時をまたぐ）", () => {
  assert.equal(S.isNight("20:59:59"), false);
  assert.equal(S.isNight("21:00:00"), true);
  assert.equal(S.isNight("00:30:00"), true);
  assert.equal(S.isNight("05:59:59"), true);
  assert.equal(S.isNight("06:00:00"), false);
  assert.equal(S.isNight("12:00:00"), false);
  assert.equal(S.isNight("01:00:00", "00:00", "05:00"), true);   // またがない設定
  assert.equal(S.isNight("23:00:00", "00:00", "05:00"), false);
  assert.equal(S.isNight("03:00:00", "06:00", "06:00"), false);  // 開始=終了なら夜なし
});

test("本人のふだんの画面：ごはん・お薬はお知らせ中だけ、終わった予定は消す（11/4）", () => {
  const dinner = { id: "d", title: "夕ごはん", start_time: "18:30:00", notify_from: "18:20:00", notify_until: "18:35:00", show_on_home: false };
  const day = { id: "y", title: "デイ", start_time: "09:00:00", end_time: "16:00:00" };
  const shop = { id: "s", title: "買い物", start_time: "15:00:00" };
  const memo = { id: "m", title: "メモ" };
  const occ = [day, shop, dinner, memo];
  const at = (t) => S.homeItems(occ, S.activeNotices(occ, t), t).map((x) => x.id);
  assert.deepEqual(at("08:00:00"), ["y", "s", "m"]);         // ごはんは出ない
  assert.deepEqual(at("15:30:00"), ["y", "m"]);              // 買い物（15:00）は終わったので消える
  assert.deepEqual(at("16:00:01"), ["m"]);                   // デイも終わった
  assert.deepEqual(at("18:25:00"), ["d", "m"]);              // お知らせ中は夕ごはんが出る
  assert.deepEqual(at("18:40:00"), ["m"]);
  assert.equal(S.defaultShowOnHome("お昼ごはん"), false);
  assert.equal(S.defaultShowOnHome("お薬"), false);
  assert.equal(S.defaultShowOnHome("デイ"), true);
});
