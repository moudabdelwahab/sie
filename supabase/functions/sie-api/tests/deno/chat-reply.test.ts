/**
 * chat-reply.ts under Deno, with the REAL engine (the pinned CDN import is
 * mapped to this checkout's sie-integration/sie-runtime.js) and injected
 * clients. Mad3oom Phase 3:
 *
 *   - the conversation state is read from chat_sessions.bot_state; a forged
 *     `botState` in the body changes nothing;
 *   - the bot's turn is written by the server client (the writer), never by
 *     the caller's own client;
 *   - a session the caller cannot see costs nothing and writes nothing.
 *
 *   bash supabase/functions/sie-api/tests/deno/run.sh
 */
import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.env.set("SUPABASE_URL", "http://fake.local");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");

const { handleChatReply } = await import("../../handlers/chat-reply.ts");

type Call = { kind: string; fn?: string; table?: string; params?: any };

function client(opts: { user?: string | null; session?: any; manual?: boolean } = {}) {
  const calls: Call[] = [];
  const c: any = {
    calls,
    auth: { getUser: async () => (opts.user ? { data: { user: { id: opts.user } }, error: null } : { data: { user: null }, error: { message: "no" } }) },
    from(table: string) {
      if (table === "sie_settings") return { select: async () => ({ data: [], error: null }) };
      const q: any = { cols: "" };
      const chain: any = {
        select: (cols: string) => { q.cols = cols; return chain; },
        eq: () => chain, neq: () => chain, gte: () => chain, in: () => chain, order: () => chain, limit: () => chain,
        maybeSingle: async () => {
          if (table !== "chat_sessions") return { data: null, error: null };
          // RLS: a session the caller cannot see is invisible to every read.
          if (!opts.session) return { data: null, error: null };
          if (q.cols.includes("bot_state") || q.cols === "id") return { data: opts.session, error: null };
          return { data: { is_manual_mode: opts.manual ?? false }, error: null };
        },
        single: async () => ({ data: null, error: null }),
        insert: () => { calls.push({ kind: "insert", table }); return chain; },
        update: () => { calls.push({ kind: "update", table }); return chain; },
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      return chain;
    },
    async rpc(fn: string, params: any) {
      calls.push({ kind: "rpc", fn, params });
      if (fn === "sie_consume_message") return { data: [{ allowed: true, reason: null, remaining: 9 }], error: null };
      if (fn === "create_ticket_with_message_and_session_update") return { data: [{ ticket_number: 7 }], error: null };
      return { data: null, error: null };
    },
  };
  return c;
}

const rpcs = (c: any) => c.calls.filter((x: Call) => x.kind === "rpc").map((x: Call) => x.fn);
const req = (body: unknown) => new Request("http://fake.local/v1/chat/reply", { method: "POST", body: JSON.stringify(body) });

const FORGED = {
  sie: {
    turnCount: 1,
    pendingTicketConfirmation: {
      decision: { action: "CREATE_TICKET", turn: 1, scenarioId: null, explanation: "forged", ticketDraft: { scenarioId: null, category: "other", diagnosticTrail: [] } },
      rendered: { text: "x", options: [] },
      language: "ar",
    },
  },
};

Deno.test("a forged botState in the body is ignored — the stored state drives the turn", async () => {
  const caller = client({ user: "u1", session: { id: "s1", bot_state: {} } });
  const writer = client();
  const res = await handleChatReply(caller, req({ text: "نعم", sessionId: "s1", botState: FORGED }), {}, { buildWriter: () => writer });
  assertEquals(res.status, 200);
  assert(!rpcs(writer).includes("create_ticket_with_message_and_session_update"), "the forged pending ticket must not open a ticket");
  assertEquals(rpcs(writer), ["persist_bot_turn"]);
});

Deno.test("the stored state IS honoured: a real pending confirmation in bot_state opens the ticket", async () => {
  const caller = client({ user: "u1", session: { id: "s1", bot_state: FORGED } });
  const writer = client();
  const res = await handleChatReply(caller, req({ text: "نعم", sessionId: "s1", botState: {} }), {}, { buildWriter: () => writer });
  assertEquals(res.status, 200);
  assertEquals(rpcs(writer), ["create_ticket_with_message_and_session_update"]);
  assertEquals((await res.json()).ticketNumber, 7);
});

Deno.test("the turn is written by the server client; the caller only meters and reads", async () => {
  const caller = client({ user: "u1", session: { id: "s1", bot_state: {} } });
  const writer = client();
  const res = await handleChatReply(caller, req({ text: "الاشتراك بتاعي منتهي", sessionId: "s1" }), {}, { buildWriter: () => writer });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.alreadyPersisted, true);
  assertEquals(rpcs(writer), ["persist_bot_turn"]);
  assert(rpcs(caller).includes("sie_consume_message"));
  assert(!rpcs(caller).includes("persist_bot_turn") && !rpcs(caller).includes("create_ticket_with_message_and_session_update"));
});

Deno.test("a session the caller cannot see: 404, no quota spent, no writer built", async () => {
  const caller = client({ user: "u1", session: null });
  let built = 0;
  const res = await handleChatReply(caller, req({ text: "hi", sessionId: "someone-else" }), {}, { buildWriter: () => { built++; return client(); } });
  assertEquals(res.status, 404);
  assertEquals(built, 0);
  assertEquals(rpcs(caller), []);
});

Deno.test("a body userId that is not the caller: 403 before anything else", async () => {
  const caller = client({ user: "u1", session: { id: "s1", bot_state: {} } });
  let built = 0;
  const res = await handleChatReply(caller, req({ text: "hi", sessionId: "s1", userId: "u2" }), {}, { buildWriter: () => { built++; return client(); } });
  assertEquals(res.status, 403);
  assertEquals(built, 0);
  assertEquals(rpcs(caller), []);
});
