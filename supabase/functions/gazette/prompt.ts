// 鳩月報：Claude に渡す材料と指示、返ってきた結果の確認。
// 数字はデータベースが数えたもの（gazette_stats）だけを使い、Claude には見出しと短い記事だけを書かせる。
// 本人情報（住所・生年月日など）やレスキューカードの内容・閲覧回数は渡さない。

export const MODEL = "claude-opus-5-5";

export const SYSTEM_PROMPT = `あなたは家庭新聞「鳩月報」の記者です。家族の電子伝書鳩アプリ「くるっくー」がひと月に運んだ記録をもとに、スポーツ新聞の一面のような紙面の見出しと短い記事を書きます。平凡な家の出来事を、大げさに、愛情をこめて報じるのが芸風です。

守ること：
- 数字は、渡された「集計」にあるものだけを使う。足し算や推測で新しい数字を作らない。
- 予定の回数は「予定」として書く。実際に出かけた・実施したとは書かない（例：「デイ、10月は予定9回」）。
- 渡された「メモ」と「集計」に書かれていない出来事を作らない。言い回しの誇張はよいが、事実を作るのはだめ。
- 本人（is_patient が true の人）を笑いものにしない。ちゃかすのは家族と鳩まで。病気や認知症、介護や医療の効果には触れない。
- 愚痴や重い話題を、無理に感動的な美談へ書き換えない。
- 家族の呼び名は、渡された名前のまま使う。
- 日本語で書く。見出しは20文字以内、副見出しは30文字以内、記事は2本か3本、記事の見出しは15文字以内、本文は120文字以内。`;

export const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "一面の大見出し（20文字以内）" },
    subheadline: { type: "string", description: "副見出し（30文字以内）" },
    articles: {
      type: "array",
      description: "記事（2本か3本）",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "記事の見出し（15文字以内）" },
          body: { type: "string", description: "本文（120文字以内）" },
        },
        required: ["title", "body"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "subheadline", "articles"],
  additionalProperties: false,
} as const;

export type GazetteText = {
  headline: string;
  subheadline: string;
  articles: { title: string; body: string }[];
};

type Stats = Record<string, unknown> & { schedules?: unknown[] };

/** Claude に渡す材料。カードを開いた回数は、緊急事態と誤解されないよう渡さない */
export function buildMaterial(opts: {
  month: string;
  stats: Stats;
  pigeonName: string | null;
  people: { name: string; is_patient: boolean }[];
  notes: { on_date: string; body: string }[];
  memos: { title: string; on_date: string | null; memo: string }[];
}) {
  const { rescue_card_opened: _omit, ...stats } = opts.stats;
  return {
    対象月: opts.month,
    鳩の名前: opts.pigeonName || "鳩",
    家族: opts.people.map((p) => ({ name: p.name, is_patient: p.is_patient })),
    集計: stats,
    メモ: [
      ...opts.notes.map((n) => ({ 日付: n.on_date, ひとこと: n.body })),
      ...opts.memos.map((m) => ({ 日付: m.on_date, 予定: m.title, 家族メモ: m.memo })),
    ],
  };
}

const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

/** 返ってきた結果の形と長さを確かめる。おかしければ例外 */
export function checkResult(x: unknown): GazetteText {
  const o = x as Partial<GazetteText>;
  if (!o || typeof o.headline !== "string" || typeof o.subheadline !== "string" || !Array.isArray(o.articles)) {
    throw new Error("紙面の形になっていませんでした");
  }
  const articles = o.articles
    .filter((a) => a && typeof a.title === "string" && typeof a.body === "string" && a.body.trim())
    .slice(0, 3)
    .map((a) => ({ title: clip(a.title, 30), body: clip(a.body, 240) }));
  if (!o.headline.trim() || articles.length === 0) throw new Error("見出しか記事が空でした");
  // 長さは指示の2倍まで許し、それ以上は切る（紙面が崩れないように）
  return { headline: clip(o.headline, 40), subheadline: clip(o.subheadline, 60), articles };
}
