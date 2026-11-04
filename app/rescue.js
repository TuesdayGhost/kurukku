// レスキュー対応カード：表示・コピー用の文字と、送るための1枚の画像を作る。
// 文字の組み立ては画面に依存しないので node でテストできる（tests/rescue.test.mjs）。

/** "2026-11-01" → "2026年11月" */
export function ym(dateStr) {
  if (!dateStr) return "";
  const [y, m] = dateStr.split("-").map(Number);
  return `${y}年${m}月`;
}

/** "2026-11-04" → "2026年11月4日" */
export function ymd(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

/** 身長などの数字を、大きく出す部分「約165cm」と小さく添える部分「2026年11月測定」に分ける */
export function measureParts(value, unit, approx, measuredOn) {
  if (value === null || value === undefined || value === "") return { main: "", note: "" };
  const n = Number(value);
  if (!Number.isFinite(n)) return { main: "", note: "" };
  const v = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
  return { main: `${approx ? "約" : ""}${v}${unit}`, note: measuredOn ? `${ym(measuredOn)}測定` : "" };
}

/** 身長などの数字：「約165cm（2026年11月測定）」。値がなければ "" */
export function measure(value, unit, approx, measuredOn) {
  const { main, note } = measureParts(value, unit, approx, measuredOn);
  return main ? `${main}${note ? `（${note}）` : ""}` : "";
}

/** 満年齢（日本時間の今日の日付 "YYYY-MM-DD" を渡す） */
export function age(birthDate, todayStr) {
  if (!birthDate || !todayStr) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = todayStr.split("-").map(Number);
  let a = ty - by;
  if (tm < bm || (tm === bm && td < bd)) a -= 1;
  return a >= 0 ? a : null;
}

/** カードの各行（ラベルと値）。空の項目は value が "" */
export function cardRows(p, clothes, todayStr, { withPrivate = true } = {}) {
  p = p || {};
  const a = age(p.birth_date, todayStr);
  const rows = [
    { key: "name", label: "名前", value: p.full_name || "" },
    { key: "age", label: "年齢", value: a !== null ? `${a}歳` : "" },
    { key: "height", label: "身長", value: measure(p.height_cm, "cm", p.height_approx, p.height_measured_on), ...measureParts(p.height_cm, "cm", p.height_approx, p.height_measured_on) },
    { key: "weight", label: "体重", value: measure(p.weight_kg, "kg", p.weight_approx, p.weight_measured_on), ...measureParts(p.weight_kg, "kg", p.weight_approx, p.weight_measured_on) },
    { key: "shoe", label: "靴のサイズ", value: measure(p.shoe_cm, "cm", p.shoe_approx, p.shoe_measured_on), ...measureParts(p.shoe_cm, "cm", p.shoe_approx, p.shoe_measured_on) },
    { key: "features", label: "身体の特徴", value: p.features || "" },
    { key: "belongings", label: "いつもの持ち物", value: p.belongings || "" },
    { key: "clothes", label: "よく着る服", value: (clothes || []).map((c) => c.note).filter(Boolean).join("／") },
    { key: "notes", label: "その他", value: p.notes || "" },
  ];
  if (withPrivate) {
    rows.push({ key: "birth", label: "生年月日", value: p.birth_date ? ymd(p.birth_date) : "" });
    rows.push({ key: "address", label: "住所", value: p.address || "" });
  }
  return rows;
}

/** コピー・読み上げ用の文字。空の項目は書かない */
export function cardText(p, clothes, todayStr, opts = {}) {
  const lines = ["【本人の情報（家族より）】"];
  for (const r of cardRows(p, clothes, todayStr, opts)) if (r.value) lines.push(`${r.label}：${r.value}`);
  if (p?.face_photo_taken_on) lines.push(`写真：${ymd(p.face_photo_taken_on)}ごろ撮影`);
  if (p?.updated_at) lines.push(`（${ymd(String(p.updated_at).slice(0, 10))}更新）`);
  return lines.join("\n");
}

// ---------- 送るための1枚の画像（ブラウザだけで動く） ----------

function wrapLines(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxWidth && line) { out.push(line); line = ch; }
      else line += ch;
    }
    out.push(line);
  }
  return out;
}

function drawCover(ctx, img, x, y, w, h) {
  const r = Math.max(w / img.width, h / img.height);
  const sw = w / r, sh = h / r;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("写真を読み込めませんでした"));
    img.src = url;
  });
}

/**
 * 1枚の画像（縦長 1080×1600）を作り、Blob を返す。
 * faceUrl / clothes[i].url はこの端末の中の一時的なURL（blob:）。
 */
export async function cardImage({ profile, clothes, todayStr, withPrivate, faceUrl, clothesUrls = [], font }) {
  const W = 1080, H = 1920, M = 56;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const F = (size, weight = 400) => `${weight} ${size}px ${font}`;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#14181c"; ctx.textBaseline = "top";

  ctx.font = F(44, 700);
  ctx.fillText("本人の情報（家族より）", M, M);

  // 顔写真
  const photoY = M + 80, photoW = 460, photoH = 580;
  if (faceUrl) {
    try { drawCover(ctx, await loadImage(faceUrl), M, photoY, photoW, photoH); }
    catch (_) { ctx.strokeRect(M, photoY, photoW, photoH); }
  } else {
    ctx.strokeStyle = "#c9d1d8"; ctx.lineWidth = 3; ctx.strokeRect(M, photoY, photoW, photoH);
    ctx.font = F(32); ctx.fillStyle = "#4f5a64"; ctx.fillText("写真なし", M + 150, photoY + 270); ctx.fillStyle = "#14181c";
  }
  if (profile?.face_photo_taken_on) {
    ctx.font = F(26); ctx.fillStyle = "#4f5a64";
    ctx.fillText(`${ymd(profile.face_photo_taken_on)}ごろ撮影`, M, photoY + photoH + 12);
    ctx.fillStyle = "#14181c";
  }

  // 右側：名前と大きな数字
  const rows = cardRows(profile, clothes, todayStr, { withPrivate });
  const get = (k) => rows.find((r) => r.key === k)?.value || "";
  const rx = M + photoW + 44, rw = W - rx - M;
  let y = photoY;
  ctx.font = F(56, 700);
  for (const l of wrapLines(ctx, get("name") || "（名前未登録）", rw)) { ctx.fillText(l, rx, y); y += 70; }
  if (get("age")) { ctx.font = F(36); ctx.fillText(get("age"), rx, y); y += 56; }
  y += 16;
  for (const k of ["height", "weight", "shoe"]) {
    const r = rows.find((x) => x.key === k);
    ctx.font = F(28); ctx.fillStyle = "#4f5a64"; ctx.fillText(r.label, rx, y); y += 38;
    ctx.fillStyle = "#14181c"; ctx.font = F(48, 700);
    ctx.fillText(r.main || "未登録", rx, y); y += 58;
    if (r.note) { ctx.font = F(24); ctx.fillStyle = "#4f5a64"; ctx.fillText(r.note, rx, y); ctx.fillStyle = "#14181c"; y += 32; }
    y += 14;
  }

  // 下側：その他の項目
  y = Math.max(y, photoY + photoH + 60);
  for (const k of ["features", "belongings", "clothes", "notes", "birth", "address"]) {
    const v = get(k);
    if (!v || y > H - 120) continue;
    const label = rows.find((x) => x.key === k).label;
    ctx.font = F(28); ctx.fillStyle = "#4f5a64"; ctx.fillText(label, M, y); y += 38;
    ctx.font = F(34); ctx.fillStyle = "#14181c";
    for (const l of wrapLines(ctx, v, W - M * 2).slice(0, 3)) { ctx.fillText(l, M, y); y += 46; }
    y += 14;
  }

  // よく着る服の写真（このうちどれか）
  const thumbs = (clothes || []).map((c, i) => ({ c, url: clothesUrls[i] })).filter((x) => x.url).slice(0, 4);
  if (thumbs.length) {
    const size = 200, gap = 20, ty = H - M - 60 - size - 40;
    if (y < ty) {
      ctx.font = F(28); ctx.fillStyle = "#4f5a64"; ctx.fillText("よく着る服（このうちどれか）", M, ty - 4); ctx.fillStyle = "#14181c";
      for (let i = 0; i < thumbs.length; i++) {
        const x = M + i * (size + gap);
        try { drawCover(ctx, await loadImage(thumbs[i].url), x, ty + 36, size, size); } catch (_) { /* 読めない写真は飛ばす */ }
        ctx.font = F(22);
        ctx.fillText(wrapLines(ctx, thumbs[i].c.note || "", size)[0] || "", x, ty + 36 + size + 6);
      }
    }
  }

  ctx.font = F(24); ctx.fillStyle = "#4f5a64";
  const upd = profile?.updated_at ? `${ymd(String(profile.updated_at).slice(0, 10))}更新` : "";
  ctx.fillText(upd, M, H - M - 24);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("画像を作れませんでした"))), "image/jpeg", 0.9));
}
