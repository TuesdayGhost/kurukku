// 鳩月報を作る Edge Function
// 呼び出した家族のログイン情報のまま（行レベルセキュリティが効いた状態で）材料を集め、
// Claude に見出しと記事を書かせ、下書きとして gazettes に保存して返す。
// APIキーはこの関数の中だけで使い、ブラウザには出さない。
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildMaterial, checkResult, MODEL, OUTPUT_SCHEMA, SYSTEM_PROMPT } from "./prompt.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST で呼んでください" }, 405);

  let body: { month?: string; overwrite?: boolean };
  try { body = await req.json(); } catch { return json({ error: "送られた内容が読めませんでした" }, 400); }
  const month = String(body.month || "");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: "対象月を YYYY-MM で指定してください" }, 400);
  const mStart = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const mEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  // 集計（家族でなければここで断られる）
  const stats = await sb.rpc("gazette_stats", { p_month: mStart });
  if (stats.error) return json({ error: stats.error.message }, 403);

  const [hh, people, notes, memos, existing] = await Promise.all([
    sb.from("households").select("id, pigeon_name").maybeSingle(),
    sb.from("people").select("name, is_patient").order("sort_order"),
    sb.from("daily_notes").select("on_date, body").eq("use_in_gazette", true).not("body", "is", null)
      .gte("on_date", mStart).lte("on_date", mEnd).order("on_date").limit(40),
    sb.from("schedules").select("title, on_date, family_memo, kind").eq("memo_for_gazette", true).not("family_memo", "is", null),
    sb.from("gazettes").select("id, issued_on").eq("month", mStart).maybeSingle(),
  ]);
  for (const r of [hh, people, notes, memos, existing]) if (r.error) return json({ error: r.error.message }, 500);
  if (!hh.data) return json({ error: "家が見つかりません" }, 403);
  if (existing.data?.issued_on && !body.overwrite) {
    return json({ error: "この月の鳩月報はもう保存されています。作り直すときは、上書きを選んでください", code: "already_issued" }, 409);
  }

  const monthMemos = (memos.data ?? [])
    .filter((s) => s.kind === "weekly" || (s.on_date >= mStart && s.on_date <= mEnd))
    .map((s) => ({ title: s.title, on_date: s.kind === "once" ? s.on_date : null, memo: s.family_memo as string }));
  const material = buildMaterial({
    month, stats: stats.data, pigeonName: hh.data.pigeon_name,
    people: people.data ?? [], notes: (notes.data ?? []) as { on_date: string; body: string }[], memos: monthMemos,
  });

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  let text = "";
  let servedBy = MODEL;
  try {
    // 安全のための応答拒否があったときは、サーバー側で推奨のモデルに切り替える（fallbacks: "default"）
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      messages: [{ role: "user", content: `次の材料で、今月の鳩月報を書いてください。\n\n${JSON.stringify(material, null, 2)}` }],
    } as never) as Anthropic.Beta.Messages.BetaMessage;
    if (res.stop_reason === "refusal") {
      return json({ error: "Claude がこの内容では書けませんでした。メモの内容を見直してください" }, 502);
    }
    if (res.stop_reason === "max_tokens") return json({ error: "記事が長くなりすぎました。もう一度試してください" }, 502);
    servedBy = res.model || MODEL;
    text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "混み合っています。少し待ってから試してください" }, 503);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "Claude のAPIキーが正しく設定されていません" }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: `Claude の呼び出しに失敗しました（${e.status}）` }, 502);
    return json({ error: "Claude に接続できませんでした" }, 502);
  }

  let paper;
  try { paper = checkResult(JSON.parse(text)); }
  catch (e) { return json({ error: (e as Error).message || "紙面を読み取れませんでした" }, 502); }

  // 下書きとして保存（元の予定・メモ・履歴は書き換えない）
  const row = {
    household_id: hh.data.id, month: mStart, issued_on: null,
    headline: paper.headline, subheadline: paper.subheadline, articles: paper.articles,
    stats: stats.data, material, model: servedBy, generated_at: new Date().toISOString(),
  };
  const saved = await sb.from("gazettes").upsert(row, { onConflict: "household_id,month" }).select().single();
  if (saved.error) return json({ error: saved.error.message, paper }, 500);
  return json({ gazette: saved.data });
});
