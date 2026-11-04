// 鳩月報のタイルのテスト： node --test tests/gazette.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { iconFor, statTiles } from "../app/gazette.js";

test("用件の名前から絵を選ぶ", () => {
  assert.equal(iconFor("朝ごはん"), "🍞");
  assert.equal(iconFor("お昼ごはん"), "🍙");
  assert.equal(iconFor("夕ごはん"), "🍲");
  assert.equal(iconFor("お薬"), "💊");
  assert.equal(iconFor("デイ"), "🚌");
  assert.equal(iconFor("仕事"), "💼");
  assert.equal(iconFor("町内会"), "📅");
});

test("タイルは本人の予定が先、予定には「予定」と付く、数字は集計のまま", () => {
  const t = statTiles({
    pigeon_tapped: 42, messages_sent: 0, notices_shown: 5, notes: 1,
    schedules: [
      { person: "ぽっぽ", title: "仕事", is_patient: false, planned_times: 21, latest_end: "21:40" },
      { person: "お父さん", title: "デイ", is_patient: true, planned_times: 9 },
      { person: "お父さん", title: "朝ごはん", is_patient: true, planned_times: 31 },
      { person: "お母さん", title: "買い物", is_patient: false, planned_times: 0 },
    ],
  }, "はとやま");
  assert.deepEqual(t.slice(0, 3).map((x) => x.label), ["朝ごはん", "デイ", "仕事"]);
  assert.equal(t[0].note, "予定");
  assert.equal(t[0].num, "31");
  assert.ok(!t.some((x) => x.label === "買い物"));          // 0回は出さない
  assert.equal(t.find((x) => x.label === "いちばん遅い戻り").num, "21:40");
  assert.equal(t.find((x) => x.label === "はとやまがつつかれた").num, "42");
  assert.equal(t.find((x) => x.label === "家族の知らせ").num, "0");
});
