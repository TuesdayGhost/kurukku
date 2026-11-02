// 天気（Open-Meteo：無料・APIキー不要）。
// 取れないときは架空の値を出さず、最後に取れた値と取得時刻を返す（なければ null）。
// 表示するのは屋外の予報・観測値で、室温ではない。

const CACHE_KEY = "kurukku:weather";

/** WMO 天気コード → 日本語（短く） */
export function weatherText(code) {
  const c = Number(code);
  if (c === 0 || c === 1) return "晴れ";
  if (c === 2) return "晴れ時々くもり";
  if (c === 3) return "くもり";
  if (c === 45 || c === 48) return "霧";
  if (c >= 51 && c <= 57) return "霧雨";
  if (c >= 61 && c <= 67) return "雨";
  if (c >= 71 && c <= 77) return "雪";
  if (c >= 80 && c <= 82) return "にわか雨";
  if (c === 85 || c === 86) return "にわか雪";
  if (c >= 95) return "雷雨";
  return "";
}

/** API の返答 → 表示用の値。形が違えば null */
export function parseForecast(json, fetchedAt = Date.now()) {
  const d = json && json.daily;
  const cur = json && json.current;
  if (!d || !Array.isArray(d.time) || !d.time.length) return null;
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    date: d.time[0],
    text: weatherText(d.weather_code?.[0]),
    max: num(d.temperature_2m_max?.[0]),
    min: num(d.temperature_2m_min?.[0]),
    pop: num(d.precipitation_probability_max?.[0]),
    now: num(cur?.temperature_2m),
    fetchedAt,
  };
}

export function forecastUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    current: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "Asia/Tokyo", forecast_days: "1",
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

function readCache(lat, lon) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (c && c.lat === lat && c.lon === lon) return c.data;
  } catch (_) { /* 保存がなくても動く */ }
  return null;
}
function writeCache(lat, lon, data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ lat, lon, data })); } catch (_) { /* noop */ }
}

/** 天気を取る。失敗したら { data: 前回の値 or null, error } */
export async function fetchWeather(lat, lon) {
  const cached = readCache(lat, lon);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(forecastUrl(lat, lon), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`天気の取得に失敗（${res.status}）`);
    const data = parseForecast(await res.json());
    if (!data) throw new Error("天気のデータの形が想定と違います");
    writeCache(lat, lon, data);
    return { data, error: null };
  } catch (e) {
    return { data: cached, error: e.message || String(e) };
  }
}

/** 地名から候補を探す（家族の設定画面用） */
export async function searchPlace(name) {
  const p = new URLSearchParams({ name, language: "ja", countryCode: "JP", count: "8" });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${p}`);
  if (!res.ok) throw new Error(`地名の検索に失敗しました（${res.status}）`);
  const json = await res.json();
  return (json.results || []).map((r) => ({
    label: [r.admin1, r.admin2, r.name].filter((x, i, a) => x && a.indexOf(x) === i).join(" "),
    lat: r.latitude, lon: r.longitude,
  }));
}
