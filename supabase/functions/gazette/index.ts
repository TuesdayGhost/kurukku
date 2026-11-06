// 鳩月報を作る Edge Function
// 呼び出した家族のログイン情報のまま（行レベルセキュリティが効いた状態で）材料を集め、
// Claude に見出しと記事を書かせ、下書きとして gazettes に保存して返す。
// APIキーはこの関数の中だけで使い、ブラウザには出さない。
// 本体は handler.ts。ここでは本物の Supabase と Claude をつなぐだけ。
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handle } from "./handler.ts";

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

Deno.serve((req) => handle(req, {
  db: (authorization) => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  }),
  claude: (params) => client.beta.messages.create(params as never),
}));
