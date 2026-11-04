// レスキューカードの文字のテスト： node --test tests/rescue.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../app/rescue.js";

test("「約」と測定日を付けた数字", () => {
  assert.equal(R.measure(165, "cm", true, "2026-11-01"), "約165cm（2026年11月測定）");
  assert.equal(R.measure("58.0", "kg", false, null), "58kg");
  assert.equal(R.measure(25.5, "cm", false, "2026-10-20"), "25.5cm（2026年10月測定）");
  assert.equal(R.measure(null, "cm", true, "2026-11-01"), "");
  assert.equal(R.measure("", "cm", false, null), "");
});

test("満年齢（誕生日の前日・当日）", () => {
  assert.equal(R.age("1948-11-05", "2026-11-04"), 77);
  assert.equal(R.age("1948-11-04", "2026-11-04"), 78);
  assert.equal(R.age(null, "2026-11-04"), null);
});

test("未入力の項目があってもカードの文字を作れる（空欄は書かない）", () => {
  const t = R.cardText({}, [], "2026-11-04");
  assert.equal(t, "【本人の情報（家族より）】");
  const t2 = R.cardText({ full_name: "テスト 太郎", height_cm: 165, height_approx: true, height_measured_on: "2026-11-01", updated_at: "2026-11-04T01:00:00Z" },
    [{ note: "紺のジャンパー" }, { note: "" }, { note: "グレーの帽子" }], "2026-11-04");
  assert.equal(t2, "【本人の情報（家族より）】\n名前：テスト 太郎\n身長：約165cm（2026年11月測定）\nよく着る服：紺のジャンパー／グレーの帽子\n（2026年11月4日更新）");
});

test("住所・生年月日は含めない設定にできる", () => {
  const p = { full_name: "テスト 太郎", birth_date: "1948-05-01", address: "どこか市" };
  assert.ok(R.cardText(p, [], "2026-11-04").includes("住所：どこか市"));
  const t = R.cardText(p, [], "2026-11-04", { withPrivate: false });
  assert.ok(!t.includes("住所"));
  assert.ok(!t.includes("生年月日"));
  assert.ok(t.includes("年齢：78歳"));
});
