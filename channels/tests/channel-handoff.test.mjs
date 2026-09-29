/**
 * channel-handoff.test.mjs
 * ------------------------------------------------------------
 * Mad3oom Phase 2 (migration 059): Telegram respects a human takeover.
 *
 * On a messaging channel the bot's words go straight to the customer — a
 * refusal in the database stops the bot's reply from being STORED, not a
 * fallback notice from being SENT. So the channel layer keeps its own end:
 * a conversation a human owns gets no SIE turn and no message from the bot
 * at all — not the reply, not "try again", not an entitlement notice —
 * including when the takeover lands while the engine is computing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handleInbound } from '../core/channel-adapter.js';
import { createInProcessSieClient } from '../core/sie-client.js';
import { createSessionStore } from '../core/channel-session.js';
import { createTelegramAdapter } from '../telegram/telegram-adapter.js';

const SECRET = 'test-secret-token';
const silentLogger = { info() {}, warn() {}, error() {} };

function telegramRequest(text = 'الاشتراك بتاعي منتهي', messageId = 100) {
    return {
        headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET },
        body: {
            update_id: messageId,
            message: {
                message_id: messageId, date: 1700000000,
                from: { id: 555, is_bot: false, first_name: 'عميل', language_code: 'ar' },
                chat: { id: 555, type: 'private' },
                text
            }
        },
        url: '/'
    };
}

function fakeTelegramApi() {
    const sent = [];
    return {
        sent,
        async sendMessage(chatId, text) { sent.push({ chatId, text }); return { message_id: sent.length }; },
        async sendChatAction() {}
    };
}

/** A session store double with a switchable handoff state. */
function fakeSessions({ manual = false } = {}) {
    const state = { manual, reads: 0, saved: [] };
    return {
        state,
        async getOrCreate() { return { sessionId: 'session-1', botState: {}, humanHandoff: state.manual }; },
        async saveState(id, botState) { state.saved.push(botState); },
        async isHumanHandoff() { state.reads += 1; return state.manual; }
    };
}

function build({ manual = false, runTurn } = {}) {
    const api = fakeTelegramApi();
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: SECRET, api });
    const sessions = fakeSessions({ manual });
    const calls = { engine: 0, explained: 0 };
    const getSieReply = async (params) => {
        calls.engine += 1;
        return runTurn ? runTurn(params, sessions) : { reply: 'رد المحرك', options: [], botState: { sie: {} }, alreadyPersisted: true };
    };
    const deps = {
        logger: silentLogger,
        identity: { async resolve() { return { linked: true, userId: 'user-1', reply: null }; } },
        sieClient: createInProcessSieClient({ supabase: {}, sessions, getSieReply, logger: silentLogger }),
        entitlement: { async explainRefusal() { calls.explained += 1; return 'اشتراكك مش مفعل'; } }
    };
    return { api, adapter, sessions, calls, deps };
}

test('bot mode: the engine runs and its reply is delivered (baseline)', async () => {
    const { api, adapter, deps, calls } = build();
    const result = await handleInbound({ adapter, request: telegramRequest(), deps });
    assert.equal(result.results[0].outcome, 'replied');
    assert.equal(calls.engine, 1);
    assert.equal(api.sent.length, 1);
});

test('human mode: no SIE turn and nothing sent to the customer', async () => {
    const { api, adapter, deps, calls } = build({ manual: true });
    const result = await handleInbound({ adapter, request: telegramRequest(), deps });
    assert.equal(result.results[0].outcome, 'human_handoff');
    assert.equal(calls.engine, 0, 'SIE must not be called');
    assert.equal(api.sent.length, 0, 'the bot must say nothing');
    assert.equal(calls.explained, 0, 'no entitlement notice either');
});

test('takeover lands while the engine computes: the refused turn becomes silence, not a fallback notice', async () => {
    const { api, adapter, deps, calls, sessions } = build({
        // The engine reads "bot mode", a human takes over mid-turn, the
        // database refuses the persist and the engine returns null.
        runTurn: async (_params, s) => { s.state.manual = true; return null; }
    });
    const result = await handleInbound({ adapter, request: telegramRequest(), deps });
    assert.equal(calls.engine, 1);
    assert.equal(sessions.state.reads, 1, 'the state was re-read after the empty turn');
    assert.equal(result.results[0].outcome, 'human_handoff');
    assert.equal(api.sent.length, 0);
    assert.equal(calls.explained, 0);
});

test('an empty turn in bot mode still explains itself (existing behaviour kept)', async () => {
    const { api, adapter, deps, calls } = build({ runTurn: async () => null });
    const result = await handleInbound({ adapter, request: telegramRequest(), deps });
    assert.equal(result.results[0].outcome, 'not_handled');
    assert.equal(calls.explained, 1);
    assert.equal(api.sent.length, 1);
});

test('the bot state is not overwritten for a conversation a human owns', async () => {
    const { adapter, deps, sessions } = build({ manual: true });
    await handleInbound({ adapter, request: telegramRequest(), deps });
    assert.equal(sessions.state.saved.length, 0);
});

test('a session store without isHumanHandoff (older wiring) keeps the old behaviour', async () => {
    const sessions = { async getOrCreate() { return { sessionId: 's', botState: {} }; }, async saveState() {} };
    const client = createInProcessSieClient({ supabase: {}, sessions, getSieReply: async () => null });
    assert.equal(await client.reply({ message: { text: 'x', channel: 'telegram', channelChatId: '1' }, identity: { userId: 'u' } }), null);
});

// ── the real session store against a Supabase double ─────────────────────

function sessionSupabase({ rows = [], manualById = {} } = {}) {
    return {
        from(table) {
            assert.equal(table, 'chat_sessions');
            const q = { filters: {} };
            const chain = {
                select(cols) { q.cols = cols; return chain; },
                eq(col, val) { q.filters[col] = val; return chain; },
                gte() { return chain; }, order() { return chain; },
                limit: async () => ({ data: rows, error: null }),
                maybeSingle: async () => ({ data: { is_manual_mode: manualById[q.filters.id] ?? false }, error: null }),
                insert() { return { select: () => ({ single: async () => ({ data: { id: 'new-1', bot_state: {} }, error: null }) }) }; }
            };
            return chain;
        }
    };
}

test('session store: an existing session carries its handoff state', async () => {
    const store = createSessionStore({ supabase: sessionSupabase({ rows: [{ id: 'live-1', bot_state: {}, updated_at: 'x', is_manual_mode: true }] }) });
    const s = await store.getOrCreate({ userId: 'u', channel: 'telegram', channelChatId: '1' });
    assert.deepEqual(s, { sessionId: 'live-1', botState: {}, humanHandoff: true });
});

test('session store: a new session starts in bot mode', async () => {
    const store = createSessionStore({ supabase: sessionSupabase({ rows: [] }) });
    const s = await store.getOrCreate({ userId: 'u', channel: 'telegram', channelChatId: '1' });
    assert.equal(s.humanHandoff, false);
});

test('session store: isHumanHandoff is a fresh read of is_manual_mode', async () => {
    const store = createSessionStore({ supabase: sessionSupabase({ manualById: { 'a': true, 'b': false } }) });
    assert.equal(await store.isHumanHandoff('a'), true);
    assert.equal(await store.isHumanHandoff('b'), false);
});
