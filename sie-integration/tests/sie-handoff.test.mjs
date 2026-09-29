/**
 * sie-handoff.test.mjs
 * ------------------------------------------------------------
 * Mad3oom Phase 2 (migration 059): the engine's side of the human handoff.
 *
 * The guarantee lives in the database (tests/sql/handoff-guarantee.test.sql
 * in the platform repo proves a bot reply cannot be persisted once a human
 * owns the conversation). These tests prove the engine keeps its end:
 *
 *   - a conversation a human owns gets no SIE turn and spends no quota;
 *   - an escalation that is FINAL puts the conversation in human hands
 *     (sie_request_human), after the engine's own message is persisted;
 *   - a plain ticket (not an escalation) does not;
 *   - nothing here can turn the bot back on.
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

const { isHumanHandoffActive, requestHumanHandoff } = await import('../sie-handoff.js');
const { getSieReply } = await import('../sie-runtime.js');
const { getSieSettings } = await import('../sie-entitlement.js');

/**
 * A Supabase double: records every RPC, answers chat_sessions.is_manual_mode
 * from `manual`, and lets the persistence RPCs succeed.
 */
function fakeSupabase({ manual = false, handoffError = null } = {}) {
    const rpcs = [];
    const state = { manual };
    return {
        rpcs,
        state,
        from(table) {
            if (table === 'sie_settings') {
                return { select: async () => ({ data: [], error: null }) };
            }
            const chain = {
                select: () => chain, eq: () => chain, neq: () => chain, gte: () => chain,
                in: () => chain, order: () => chain, limit: () => chain,
                maybeSingle: async () => ({
                    data: table === 'chat_sessions' ? { is_manual_mode: state.manual } : null,
                    error: null
                }),
                single: async () => ({ data: null, error: null }),
                insert: () => chain,
                update: () => chain,
                then: (resolve) => resolve({ data: [], error: null })
            };
            return chain;
        },
        async rpc(fn, params) {
            rpcs.push({ fn, params });
            if (fn === 'sie_consume_message') return { data: [{ allowed: true, reason: null, remaining: 99 }], error: null };
            if (fn === 'create_ticket_with_message_and_session_update') return { data: [{ ticket_number: 77 }], error: null };
            if (fn === 'sie_request_human') {
                if (handoffError) return { data: null, error: { message: handoffError } };
                state.manual = true;
                return { data: true, error: null };
            }
            if (fn === 'queue_conversation_for_review') return { data: 'review-1', error: null };
            return { data: null, error: null };
        }
    };
}

const names = (sb) => sb.rpcs.map((r) => r.fn);
const handoffCalls = (sb) => sb.rpcs.filter((r) => r.fn === 'sie_request_human');

async function turn(sb, text, botState = {}) {
    await getSieSettings(sb, { fresh: true });
    return getSieReply({ text, supabase: sb, sessionId: 'session-1', userId: 'user-1', botState });
}

function pendingEscalation(action = 'ESCALATE_TO_HUMAN') {
    return {
        sie: {
            turnCount: 1,
            pendingTicketConfirmation: {
                decision: {
                    action, turn: 1, scenarioId: null, explanation: 'test',
                    ticketDraft: { scenarioId: null, category: 'other', diagnosticTrail: [] }
                },
                rendered: { text: 'فتحتلك تذكرة', options: [] },
                language: 'ar'
            }
        }
    };
}

// ── the module itself ────────────────────────────────────────────────────

test('isHumanHandoffActive reads chat_sessions.is_manual_mode', async () => {
    assert.equal(await isHumanHandoffActive(fakeSupabase({ manual: true }), 's'), true);
    assert.equal(await isHumanHandoffActive(fakeSupabase({ manual: false }), 's'), false);
});

test('isHumanHandoffActive is advisory: a failed or throwing read answers false, never throws', async () => {
    const failing = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'x' } }) }) }) }) };
    const throwing = { from() { throw new Error('boom'); } };
    assert.equal(await isHumanHandoffActive(failing, 's'), false);
    assert.equal(await isHumanHandoffActive(throwing, 's'), false);
    assert.equal(await isHumanHandoffActive(null, 's'), false);
});

test('requestHumanHandoff calls the audited server path with the session and reason', async () => {
    const sb = fakeSupabase();
    assert.deepEqual(await requestHumanHandoff(sb, { sessionId: 's-9', reason: 'escalated_by_engine' }), { handedOff: true });
    assert.deepEqual(handoffCalls(sb).map((c) => c.params), [{ p_session: 's-9', p_reason: 'escalated_by_engine' }]);
});

test('requestHumanHandoff never throws and reports failure', async () => {
    assert.deepEqual(await requestHumanHandoff(fakeSupabase({ handoffError: 'denied' }), { sessionId: 's', reason: 'r' }), { handedOff: false });
    assert.deepEqual(await requestHumanHandoff({ rpc() { throw new Error('lost'); } }, { sessionId: 's', reason: 'r' }), { handedOff: false });
});

test('the engine never calls any path that turns the bot back on', async () => {
    const src = await readFile(new URL('../sie-handoff.js', import.meta.url), 'utf8')
        + await readFile(new URL('../sie-chat-bridge.js', import.meta.url), 'utf8');
    assert.ok(!/rpc\(\s*['"]inbox_return_to_ai/.test(src), 'no call to the staff-only handback path');
    assert.ok(!/is_manual_mode['"]?\s*:\s*false/.test(src));
    assert.ok(!/update\(\s*\{[^}]*is_manual_mode/.test(src), 'no direct write of the handoff state');
});

// ── the bridge ───────────────────────────────────────────────────────────

test('a conversation a human owns gets no SIE turn and spends no quota', async () => {
    const sb = fakeSupabase({ manual: true });
    const result = await turn(sb, 'الاشتراك بتاعي منتهي');
    assert.equal(result, null);
    assert.ok(!names(sb).includes('sie_consume_message'), 'quota must not be spent');
    assert.ok(!names(sb).includes('persist_bot_turn'), 'nothing persisted');
});

test('in bot mode the turn runs normally and does not hand off', async () => {
    const sb = fakeSupabase({ manual: false });
    const result = await turn(sb, 'الاشتراك بتاعي منتهي');
    assert.ok(result?.reply, 'SIE answered');
    assert.ok(names(sb).includes('sie_consume_message'));
    assert.equal(handoffCalls(sb).length, 0);
});

test('an escalation whose ticket is accepted hands the conversation to a human — after the reply is persisted', async () => {
    const sb = fakeSupabase();
    const result = await turn(sb, 'نعم', pendingEscalation());
    assert.equal(result.humanHandoff, true);
    assert.equal(result.ticketNumber, 77);
    const order = names(sb);
    assert.ok(order.indexOf('create_ticket_with_message_and_session_update') < order.indexOf('sie_request_human'),
        'the escalation message must be written before the handoff, or 059 refuses it');
    assert.equal(handoffCalls(sb)[0].params.p_reason, 'escalation_ticket_opened');
    assert.equal(sb.state.manual, true);
});

test('an escalation whose ticket is declined still hands the conversation to a human', async () => {
    const sb = fakeSupabase();
    const result = await turn(sb, 'مش عايز تذكرة', pendingEscalation());
    assert.equal(result.humanHandoff, true);
    const order = names(sb);
    assert.ok(order.indexOf('persist_bot_turn') < order.indexOf('sie_request_human'));
    assert.equal(handoffCalls(sb)[0].params.p_reason, 'escalation_ticket_declined');
});

test('a plain ticket (not an escalation) does not hand the conversation off', async () => {
    const sb = fakeSupabase();
    const yes = await turn(sb, 'نعم', pendingEscalation('CREATE_TICKET'));
    assert.equal(yes.humanHandoff, false);
    const sb2 = fakeSupabase();
    const no = await turn(sb2, 'مش عايز تذكرة', pendingEscalation('CREATE_TICKET'));
    assert.equal(no.humanHandoff, false);
    assert.equal(handoffCalls(sb).length + handoffCalls(sb2).length, 0);
});

test('an unclear answer to an escalation keeps asking and does not hand off yet', async () => {
    const sb = fakeSupabase();
    const result = await turn(sb, 'ممكن توضح', pendingEscalation());
    assert.ok(result?.reply);
    assert.equal(handoffCalls(sb).length, 0);
});

test('an explicit request for a human starts the escalation (confirmation) without handing off early', async () => {
    const sb = fakeSupabase();
    const result = await turn(sb, 'عايز اتكلم مع موظف');
    assert.ok(result?.reply, 'the escalation message is shown');
    assert.equal(handoffCalls(sb).length, 0, 'handoff waits for the confirmation answer');
    assert.equal(result.botState?.sie?.pendingTicketConfirmation?.decision?.action, 'ESCALATE_TO_HUMAN');
    // and the answer completes it
    const sb2 = fakeSupabase();
    const done = await turn(sb2, 'أيوه', result.botState);
    assert.equal(done.humanHandoff, true);
});

test('a failed handoff RPC does not lose the already-persisted reply', async () => {
    const sb = fakeSupabase({ handoffError: 'function does not exist' });
    const result = await turn(sb, 'نعم', pendingEscalation());
    assert.ok(result?.reply);
    assert.equal(result.alreadyPersisted, true);
    assert.equal(result.humanHandoff, false);
});
