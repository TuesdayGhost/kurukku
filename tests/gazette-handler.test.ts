// 鳩月報の Edge Function の本体：断るべき場合に Claude（有料API）を呼ばないことを、偽の Supabase と Claude で確かめる
//   node --test tests/gazette-handler.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../supabase/functions/gazette/handler.ts";

const PAPER = {
  headline: "見出し", subheadline: "小見出し",
  articles: [{ title: "記事1", body: "本文1" }, { title: "記事2", body: "本文2" }, { title: "記事3", body: "本文3" }],
};

/** claim: gazette_claim の結果（"ok" | エラー文） */
function fakeDb({ stats = "ok", claim = "ok", issued = false } = {}) {
  const calls: string[] = [];
  const result = (table: string) => {
    if (table === "households") return { data: { id: "h1", pigeon_name: "はとやま" }, error: null };
    if (table === "gazettes") return { data: issued ? { id: "g1", issued_on: "2026-11-01" } : null, error: null };
    return { data: [], error: null };
  };
  const from = (table: string) => {
    let op = "select";
    // deno-lint-ignore no-explicit-any
    const b: any = new Proxy({}, {
      get(_t, k) {
        if (k === "then") return (res: (v: unknown) => void) => res(op === "upsert" ? { data: { id: "g1", ...PAPER }, error: null } : result(table));
        if (k === "upsert") return () => { op = "upsert"; calls.push(`upsert:${table}`); return b; };
        return () => b;
      },
    });
    return b;
  };
  const rpc = async (name: string) => {
    calls.push(`rpc:${name}`);
    if (name === "gazette_stats") return stats === "ok" ? { data: { dummy: 1 }, error: null } : { data: null, error: { message: stats } };
    if (name === "gazette_claim") return claim === "ok" ? { data: 5, error: null } : { data: null, error: { message: claim } };
    return { data: null, error: null };
  };
  return { db: { from, rpc }, calls };
}

async function call(opts: { auth?: string | null; stats?: string; claim?: string; issued?: boolean; overwrite?: boolean }) {
  const { db, calls } = fakeDb(opts);
  let claudeCalls = 0;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== null) headers.Authorization = opts.auth ?? "Bearer test-token";
  const req = new Request("http://x/gazette", { method: "POST", headers, body: JSON.stringify({ month: "2026-10", overwrite: opts.overwrite }) });
  const res = await handle(req, {
    db: () => db,
    claude: async () => { claudeCalls++; return { stop_reason: "end_turn", model: "m", content: [{ type: "text", text: JSON.stringify(PAPER) }] }; },
  });
  return { status: res.status, body: await res.json(), claudeCalls, calls };
}

test("ログインしていない：Claude を呼ばない", async () => {
  const r = await call({ auth: null });
  assert.equal(r.status, 401); assert.equal(r.claudeCalls, 0);
});

test("家族でない（集計で断られる）：Claude を呼ばない", async () => {
  const r = await call({ stats: "家族だけが作れます" });
  assert.equal(r.status, 403); assert.equal(r.claudeCalls, 0);
});

test("許可されていない家：Claude を呼ばない", async () => {
  const r = await call({ claim: "gazette_not_allowed" });
  assert.equal(r.status, 403); assert.equal(r.body.code, "not_allowed"); assert.equal(r.claudeCalls, 0);
  assert.ok(!r.calls.includes("upsert:gazettes"));
});

test("今月の回数の上限：Claude を呼ばない", async () => {
  const r = await call({ claim: "gazette_limit" });
  assert.equal(r.status, 429); assert.equal(r.body.code, "limit"); assert.equal(r.claudeCalls, 0);
});

test("発行済みで上書きなし：回数も使わず、Claude も呼ばない", async () => {
  const r = await call({ issued: true });
  assert.equal(r.status, 409); assert.equal(r.claudeCalls, 0); assert.ok(!r.calls.includes("rpc:gazette_claim"));
});

test("許可された家：回数を1つ使ってから Claude を1回だけ呼び、下書きを保存する", async () => {
  const r = await call({});
  assert.equal(r.status, 200); assert.equal(r.claudeCalls, 1);
  assert.ok(r.calls.indexOf("rpc:gazette_claim") >= 0 && r.calls.indexOf("rpc:gazette_claim") < r.calls.indexOf("upsert:gazettes"));
});
