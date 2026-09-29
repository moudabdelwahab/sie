/**
 * sie-turn-writer.test.mjs
 * ------------------------------------------------------------
 * Mad3oom Phase 3 (migration 062): the bot's turn is written by the server.
 *
 * persist_bot_turn and create_ticket_with_message_and_session_update are
 * taken away from the customer's role, so the website (sie-api) hands the
 * engine a server client as `writer`. These tests pin the split:
 *
 *   - the turn (bot message + bot_state, or ticket + message + bot_state) is
 *     written through `writer`, and ONLY through it;
 *   - metering (sie_consume_message), the handoff read and traces stay on the
 *     caller's own client — the quota is still charged to the caller;
 *   - without `writer` the caller's client writes, exactly as before (the
 *     Telegram channel already passes a server client as `supabase`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input?.href ?? String(input);
    if (href.startsWith('file:')) {
        const body = await readFile(new URL(href), 'utf8');
        return { ok: true, status: 200, async json() { return JSON.parse(body); } };
    }
    return realFetch(input, init);
};

const { getSieReply } = await import('../sie-runtime.js');
const { getSieSettings } = await import('../sie-entitlement.js');
const { createRealSupabasePort } = await import('../../sie/action/supabase-port.supabase.js');

const TURN_RPCS = new Set(['persist_bot_turn', 'create_ticket_with_message_and_session_update']);

/** A Supabase double that records every RPC and table write it receives. */
function fakeClient(name) {
    const calls = [];
    return {
        name,
        calls,
        from(table) {
            if (table === 'sie_settings') return { select: async () => ({ data: [], error: null }) };
            const chain = {
                select: () => chain, eq: () => chain, neq: () => chain, gte: () => chain,
                in: () => chain, order: () => chain, limit: () => chain,
                maybeSingle: async () => ({ data: table === 'chat_sessions' ? { is_manual_mode: false } : null, error: null }),
                single: async () => ({ data: null, error: null }),
                insert: () => { calls.push({ kind: 'insert', table }); return chain; },
                update: () => { calls.push({ kind: 'update', table }); return chain; },
                then: (resolve) => resolve({ data: [], error: null })
            };
            return chain;
        },
        async rpc(fn, params) {
            calls.push({ kind: 'rpc', fn, params });
            if (fn === 'sie_consume_message') return { data: [{ allowed: true, reason: null, remaining: 9 }], error: null };
            if (fn === 'create_ticket_with_message_and_session_update') return { data: [{ ticket_number: 41 }], error: null };
            return { data: null, error: null };
        }
    };
}

const rpcNames = (c) => c.calls.filter((x) => x.kind === 'rpc').map((x) => x.fn);

async function turn({ text, botState = {}, withWriter = true }) {
    const caller = fakeClient('caller');
    const writer = withWriter ? fakeClient('writer') : undefined;
    await getSieSettings(caller, { fresh: true });
    const result = await getSieReply({ text, supabase: caller, sessionId: 'session-1', userId: 'user-1', botState, writer });
    return { result, caller, writer };
}

const pendingTicket = {
    sie: {
        turnCount: 1,
        pendingTicketConfirmation: {
            decision: { action: 'CREATE_TICKET', turn: 1, scenarioId: null, explanation: 'test', ticketDraft: { scenarioId: null, category: 'other', diagnosticTrail: [] } },
            rendered: { text: 'فتحتلك تذكرة', options: [] },
            language: 'ar'
        }
    }
};

test('port: the turn RPCs go through the writer; nothing else does', async () => {
    const caller = fakeClient('caller');
    const writer = fakeClient('writer');
    const port = createRealSupabasePort(caller, { writer });
    await port.persistBotTurn({ sessionId: 's', turn: 1, messageText: 'm', botState: {} });
    await port.createTicketWithMessageAndSessionUpdate({ sessionId: 's', turn: 1, messageText: 'm', botState: {}, ticket: { scenarioId: null, category: 'other', description: 'd' } });
    await port.insertTraceEvent({ sessionId: 's', turn: 1, traceEvent: {} });
    assert.deepEqual(rpcNames(writer), ['persist_bot_turn', 'create_ticket_with_message_and_session_update']);
    assert.deepEqual(rpcNames(caller), []);
    assert.ok(caller.calls.some((c) => c.kind === 'insert' && c.table === 'chat_engine_trace_events'), 'traces stay on the caller');
    assert.ok(!writer.calls.some((c) => c.kind === 'insert'), 'the writer inserts nothing directly');
});

test('port: without a writer the caller writes the turn (Telegram / older callers unchanged)', async () => {
    const caller = fakeClient('caller');
    const port = createRealSupabasePort(caller);
    await port.persistBotTurn({ sessionId: 's', turn: 1, messageText: 'm', botState: {} });
    assert.deepEqual(rpcNames(caller), ['persist_bot_turn']);
});

test('a website turn: persisted by the writer, metered on the caller', async () => {
    const { result, caller, writer } = await turn({ text: 'الاشتراك بتاعي منتهي' });
    assert.ok(result?.reply, 'SIE answered');
    assert.equal(result.alreadyPersisted, true);
    assert.deepEqual(rpcNames(writer), ['persist_bot_turn']);
    assert.ok(rpcNames(caller).includes('sie_consume_message'), 'the quota is charged to the caller');
    assert.ok(!rpcNames(caller).some((n) => TURN_RPCS.has(n)), 'the caller never writes the turn');
});

test('a ticket turn: the ticket, its message and the state are written by the writer', async () => {
    const { result, caller, writer } = await turn({ text: 'نعم', botState: pendingTicket });
    assert.equal(result.ticketNumber, 41);
    assert.deepEqual(rpcNames(writer), ['create_ticket_with_message_and_session_update']);
    assert.ok(!rpcNames(caller).some((n) => TURN_RPCS.has(n)));
});

test('without a writer the whole turn stays on the caller, as before', async () => {
    const { result, caller } = await turn({ text: 'الاشتراك بتاعي منتهي', withWriter: false });
    assert.ok(result?.reply);
    assert.ok(rpcNames(caller).includes('persist_bot_turn'));
});
