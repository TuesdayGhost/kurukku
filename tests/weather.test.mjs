// 天気の変換のテスト： node --test tests/weather.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { weatherText, parseForecast, forecastUrl } from "../app/weather.js";

test("天気コードを日本語に", () => {
  assert.equal(weatherText(0), "晴れ");
  assert.equal(weatherText(3), "くもり");
  assert.equal(weatherText(63), "雨");
  assert.equal(weatherText(73), "雪");
  assert.equal(weatherText(95), "雷雨");
  assert.equal(weatherText(undefined), "");
});

test("予報の返答を表示用の値に", () => {
  const json = {
    current: { time: "2026-11-02T18:00", temperature_2m: 9.4, weather_code: 3 },
    daily: { time: ["2026-11-02"], weather_code: [61], temperature_2m_max: [14.2], temperature_2m_min: [5.8], precipitation_probability_max: [70] },
  };
  assert.deepEqual(parseForecast(json, 1000), { date: "2026-11-02", text: "雨", max: 14.2, min: 5.8, pop: 70, now: 9.4, fetchedAt: 1000 });
});

test("形が違う・値が欠けていても架空の値を作らない", () => {
  assert.equal(parseForecast({}), null);
  assert.equal(parseForecast({ daily: { time: [] } }), null);
  const p = parseForecast({ daily: { time: ["2026-11-02"], weather_code: [2] } });
  assert.equal(p.max, null);
  assert.equal(p.now, null);
});

test("日本時間で今日1日分を頼む", () => {
  const u = new URL(forecastUrl(38.32, 140.88));
  assert.equal(u.searchParams.get("timezone"), "Asia/Tokyo");
  assert.equal(u.searchParams.get("forecast_days"), "1");
});
