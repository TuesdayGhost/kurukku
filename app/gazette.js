// 鳩月報の「今月の記録」：集計（数字）を、アイコン＋回数のタイルにする。
// 数字はデータベースが数えたものだけを使う。画面に依存しないので node でテストできる。

// 用件の名前 → Lucide のアイコン名（11/4：絵文字から Lucide にそろえた）
const ICONS = [
  [/朝ごはん|朝食/, "coffee"],
  [/昼ごはん|昼食|ランチ/, "sandwich"],
  [/夕ごはん|晩ごはん|夕食/, "soup"],
  [/ごはん|食事/, "utensils"],
  [/薬/, "pill"],
  [/デイ|送迎/, "bus"],
  [/買い物|スーパー/, "shopping-cart"],
  [/仕事|勤務|出勤|シフト/, "briefcase"],
  [/病院|通院|診察/, "hospital"],
  [/リハビリ|散歩/, "footprints"],
  [/風呂|入浴/, "bath"],
  [/出かけ|外出/, "map-pin"],
];

/** 用件の名前からアイコンを選ぶ（当てはまらなければカレンダー） */
export function iconFor(title) {
  for (const [re, icon] of ICONS) if (re.test(title || "")) return icon;
  return "calendar-days";
}

/**
 * タイルの一覧。{ icon, label, who, num, unit, note }
 * 予定は「予定の回数」であり実績ではないので note に「予定」と入れる。
 */
export function statTiles(st, pigeonName = "鳩") {
  st = st || {};
  const tiles = [];
  const sch = (st.schedules || []).filter((x) => x.planned_times > 0);
  // 本人の予定を先に、あとは回数の多い順
  sch.sort((a, b) => (b.is_patient - a.is_patient) || (b.planned_times - a.planned_times));
  for (const x of sch) {
    tiles.push({ icon: iconFor(x.title), label: x.title, who: x.person, num: String(x.planned_times), unit: "回", note: "予定" });
  }
  const late = (st.schedules || []).filter((x) => !x.is_patient && x.latest_end)
    .sort((a, b) => b.latest_end.localeCompare(a.latest_end))[0];
  if (late) tiles.push({ icon: "moon", label: "いちばん遅い戻り", who: `${late.person}・${late.title}`, num: late.latest_end, unit: "", note: "予定" });
  tiles.push({ icon: "pigeon", label: `${pigeonName}がつつかれた`, who: "", num: String(st.pigeon_tapped ?? 0), unit: "回", note: "" });
  tiles.push({ icon: "mail", label: "家族の知らせ", who: "", num: String(st.messages_sent ?? 0), unit: "通", note: "" });
  tiles.push({ icon: "bell", label: "お知らせ", who: "", num: String(st.notices_shown ?? 0), unit: "回", note: "表示" });
  tiles.push({ icon: "camera", label: "ひとこと・写真", who: "", num: String(st.notes ?? 0), unit: "件", note: "" });
  return tiles.slice(0, 16);
}
