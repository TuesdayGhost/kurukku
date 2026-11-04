// 鳩月報の材料・結果確認のテスト： node --test tests/gazette-prompt.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildMaterial, checkResult, OUTPUT_SCHEMA } from "../supabase/functions/gazette/prompt.ts";

test("材料にカードを開いた回数を入れない・本人情報を入れない", () => {
  const m = buildMaterial({
    month: "2026-10", pigeonName: "はとやま",
    stats: { month: "2026-10", pigeon_tapped: 42, rescue_card_opened: 2, schedules: [] },
    people: [{ name: "お父さん", is_patient: true }, { name: "ぽっぽ", is_patient: false }],
    notes: [{ on_date: "2026-10-12", body: "おやつがおいしかった" }],
    memos: [{ title: "デイ", on_date: null, memo: "紅葉を見に行った" }],
  });
  const s = JSON.stringify(m);
  assert.ok(!s.includes("rescue_card_opened"));
  assert.ok(s.includes("\"pigeon_tapped\":42"));
  assert.equal(m.鳩の名前, "はとやま");
  assert.equal(m.メモ.length, 2);
});

test("結果の形を確かめ、長すぎる文字は切る", () => {
  const r = checkResult({ headline: "あ".repeat(50), subheadline: "副", articles: [{ title: "t", body: "b" }, { title: "x", body: "  " }] });
  assert.equal(r.headline.length, 40);
  assert.equal(r.articles.length, 1);
  assert.throws(() => checkResult({ headline: "", subheadline: "", articles: [] }));
  assert.throws(() => checkResult(null));
});

test("出力の形の定義は厳密（余分な項目を許さない）", () => {
  assert.equal(OUTPUT_SCHEMA.additionalProperties, false);
  assert.deepEqual([...OUTPUT_SCHEMA.required], ["headline", "subheadline", "articles"]);
});
