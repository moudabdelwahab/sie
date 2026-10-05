import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createConversationCore, createSupabaseConversationStore, ConversationStoreError,
    validatePart, validateParts, partsToText, messageFromRow, MessageValidationError,
    CONVERSATION_EVENTS, eventFromRow, CORE_FLAG_KEYS, readCoreFlags, isChannelOnCore, PART_TYPES
} from '../index.js';

/**
 * An in-memory store with the same decisions 064 makes in the database, so the
 * Core contract (who may run an agent, what a rejection means) is exercised
 * without Postgres. The concurrency itself is proved in Mad3oom's
 * tests/sql/conversation-core.test.sql — not here.
 */
function fakeStore() {
    const s = { conversations: new Map(), messages: [], calls: [] };
    let seq = 0;
    const key = (r) => `${r.userId}|${r.channel}|${r.externalThreadId}`;
    s.ingest = async (r) => {
        s.calls.push(['ingest', r]);
        let c = [...s.conversations.values()].find((x) => x.key === key(r) && x.status === 'active');
        const dup = s.messages.find((m) => m.key === key(r) && m.externalId === r.externalId);
        if (dup) {
            const conv = s.conversations.get(dup.conversationId);
            return { created: false, duplicate: true, conversation: { ...conv }, message: { id: dup.id }, owner: conv.owner, stateVersion: conv.version };
        }
        if (!c) {
            c = { id: `c${s.conversations.size + 1}`, key: key(r), status: 'active', owner: 'agent', version: 0, state: {} };
            s.conversations.set(c.id, c);
        }
        const m = { id: `m${++seq}`, key: key(r), externalId: r.externalId, conversationId: c.id, text: r.text };
        s.messages.push(m);
        c.version += 1;
        return { created: true, duplicate: false, conversation: { id: c.id, status: c.status }, message: { id: m.id }, owner: c.owner, stateVersion: c.version };
    };
    s.commitTurn = async (r) => {
        s.calls.push(['commitTurn', r]);
        const c = s.conversations.get(r.conversationId);
        const prev = s.messages.find((m) => m.externalId === `turn:${r.turnKey}`);
        if (prev) return { committed: true, duplicate: true, messageId: prev.id, stateVersion: c.version };
        const reason = c.status === 'closed' ? 'closed' : c.owner === 'human' ? 'human_owner'
            : c.version !== r.expectedVersion ? 'version_conflict' : null;
        if (reason) return { committed: false, reason, stateVersion: c.version, owner: c.owner };
        const m = { id: `m${++seq}`, externalId: `turn:${r.turnKey}`, conversationId: c.id, text: r.text };
        s.messages.push(m);
        c.version += 1; c.state = r.state ?? c.state;
        return { committed: true, duplicate: false, messageId: m.id, stateVersion: c.version, owner: c.owner };
    };
    s.claimed = new Set();
    s.claimDelivery = async (id) => {
        const claimed = !s.claimed.has(id);
        s.claimed.add(id);
        return { claimed, messageId: id };
    };
    s.recordDelivery = async (id, state) => ({ updated: true, deliveryState: state });
    return s;
}

const text = (t) => [{ type: 'text', text: t }];
const tg = (externalId, t = 'السلام عليكم') => ({ channel: 'telegram', userId: 'u1', externalThreadId: '555', externalId, parts: text(t) });

// ══ الرسالة القياسية ══════════════════════════════════════════════════════

test('every Part type validates in its canonical shape', () => {
    const samples = [
        { type: 'text', text: 'hi' },
        { type: 'media', kind: 'image', ref: 'u1/a.png', mime: 'image/png' },
        { type: 'location', latitude: 30.04, longitude: 31.23, name: 'القاهرة' },
        { type: 'choices', prompt: 'اختار', options: [{ value: 'a', label: 'أ' }] },
        { type: 'choice_reply', value: 'a', label: 'أ' },
        { type: 'template', name: 'welcome', language: 'ar', params: ['x'] },
        { type: 'event', name: 'conversation.opened', data: { from: 'widget' } }
    ];
    assert.deepEqual(samples.map((p) => p.type).sort(), [...PART_TYPES].sort());
    for (const p of samples) assert.deepEqual(validatePart(p), p);
});

test('provider structures are refused, not translated, inside Core', () => {
    // WhatsApp interactive reply and a Telegram callback as they arrive on the wire.
    const vendorShapes = [
        { type: 'choice_reply', value: 'a', interactive: { type: 'button_reply', button_reply: { id: 'a' } } },
        { type: 'text', text: 'x', messaging_product: 'whatsapp' },
        { type: 'interactive', interactive: { button_reply: { id: 'a', title: 'A' } } },
        { type: 'choice_reply', value: 'a', callback_query: { data: 'a' } },
        { type: 'choices', options: [{ value: 'a', label: 'A', reply: { id: 'a' } }] }
    ];
    for (const p of vendorShapes) assert.throws(() => validatePart(p), MessageValidationError, JSON.stringify(p));
});

test('invalid parts are refused with a reason', () => {
    for (const p of [null, [], 'text', { type: 'text' }, { type: 'text', text: 5 }, { type: 'media', kind: 'exe', ref: 'x' },
        { type: 'location', latitude: 200, longitude: 0 }, { type: 'choices', options: [] }, { type: 'event', name: 'x', data: [] }]) {
        assert.throws(() => validatePart(p), MessageValidationError, JSON.stringify(p));
    }
    assert.throws(() => validateParts([]), MessageValidationError);
});

test('partsToText keeps legacy readers working (message_text)', () => {
    assert.equal(partsToText(validateParts([{ type: 'text', text: 'سطر' },
        { type: 'media', kind: 'image', ref: 'r', caption: 'صورة' },
        { type: 'choice_reply', value: 'renew', label: 'جدّد' }])), 'سطر\nصورة\nجدّد');
});

test('messageFromRow maps 064 rows and legacy rows to the canonical Message', () => {
    const core = messageFromRow({
        id: 'm1', session_id: 'c1', seq: 3, is_bot_reply: true, is_admin_reply: false, channel: 'telegram',
        message_text: 'أكيد', metadata: { parts: [{ type: 'text', text: 'أكيد' }], agentId: 'sie' },
        delivery_state: 'sent', delivery_attempts: 1, provider_message_id: 'p1', created_at: 't'
    });
    assert.deepEqual({ ...core, content: { parts: [...core.content.parts] } }, {
        id: 'm1', conversationId: 'c1', seq: 3, author: 'agent', source: 'telegram',
        content: { parts: [{ type: 'text', text: 'أكيد' }] }, metadata: { agentId: 'sie' },
        delivery: { state: 'sent', attempts: 1, providerMessageId: 'p1', error: null }, createdAt: 't'
    });
    const legacy = messageFromRow({ id: 'm0', session_id: 'c1', is_admin_reply: true, message_text: 'رد الدعم' });
    assert.equal(legacy.author, 'human');
    assert.equal(legacy.source, 'legacy');
    assert.equal(legacy.seq, null);
    assert.deepEqual([...legacy.content.parts], [{ type: 'text', text: 'رد الدعم' }]);
});

// ══ ingest ════════════════════════════════════════════════════════════════

test('ingest: only the first delivery may run an agent; a duplicate never does', async () => {
    const store = fakeStore();
    const core = createConversationCore({ store });
    const first = await core.ingest(tg('tg:555:1'));
    const again = await core.ingest(tg('tg:555:1'));
    assert.equal(first.created, true);
    assert.equal(first.shouldRunAgent, true);
    assert.equal(again.created, false);
    assert.equal(again.duplicate, true);
    assert.equal(again.shouldRunAgent, false);
    assert.equal(store.messages.length, 1);
});

test('ingest: a human-owned conversation stores the message but runs no agent', async () => {
    const store = fakeStore();
    const core = createConversationCore({ store });
    const first = await core.ingest(tg('tg:555:1'));
    store.conversations.get(first.conversation.id).owner = 'human';
    const next = await core.ingest(tg('tg:555:2', 'لسه مستني'));
    assert.equal(next.created, true);
    assert.equal(next.owner, 'human');
    assert.equal(next.shouldRunAgent, false);
});

test('ingest: refuses requests the database would refuse, before calling it', async () => {
    const store = fakeStore();
    const core = createConversationCore({ store });
    const bad = [
        { ...tg('x'), channel: 'whatsapp' },
        { ...tg('x'), userId: '' },
        { ...tg(''), externalId: '  ' },
        { ...tg('x'), externalThreadId: '' },
        { channel: 'website', userId: 'u1', externalThreadId: '5', externalId: 'w1', parts: text('x') },
        { ...tg('x'), parts: [{ type: 'text', text: 'x', messaging_product: 'whatsapp' }] },
        { ...tg('x'), metadata: { parts: [] } },
        { ...tg('x'), idleAfterMinutes: -1 }
    ];
    for (const req of bad) await assert.rejects(core.ingest(req), MessageValidationError, JSON.stringify(req));
    assert.equal(store.calls.length, 0);
});

test('ingest: the store receives text, validated parts and the trimmed key', async () => {
    const store = fakeStore();
    const core = createConversationCore({ store });
    await core.ingest({ channel: 'website', userId: 'u1', externalId: '  web-1 ', parts: text('سؤال'), idleAfterMinutes: 1440 });
    const [, req] = store.calls[0];
    assert.equal(req.externalId, 'web-1');
    assert.equal(req.externalThreadId, '');
    assert.equal(req.text, 'سؤال');
    assert.equal(req.idleAfterMinutes, 1440);
    assert.ok(Object.isFrozen(req.parts));
});

// ══ commitTurn ════════════════════════════════════════════════════════════

test('commitTurn: the stale version is rejected and nothing is written', async () => {
    const store = fakeStore();
    const core = createConversationCore({ store });
    const a = await core.ingest(tg('tg:555:1', 'واحد'));
    const b = await core.ingest(tg('tg:555:2', 'اتنين'));
    const stale = await core.commitTurn({ conversationId: a.conversation.id, expectedVersion: a.stateVersion, turnKey: 'ta', parts: text('رد 1'), state: { from: 'a' } });
    const fresh = await core.commitTurn({ conversationId: b.conversation.id, expectedVersion: b.stateVersion, turnKey: 'tb', parts: text('رد 2'), state: { from: 'b' } });
    assert.deepEqual([stale.committed, stale.reason], [false, 'version_conflict']);
    assert.deepEqual([fresh.committed, fresh.reason], [true, null]);
    assert.deepEqual(store.conversations.get(a.conversation.id).state, { from: 'b' });
});

test('commitTurn: a human owner wins — the agent commit is refused', async () => {
    const store = fakeStore();
    const core = createConversationCore({ store });
    const a = await core.ingest(tg('tg:555:1'));
    store.conversations.get(a.conversation.id).owner = 'human';
    const r = await core.commitTurn({ conversationId: a.conversation.id, expectedVersion: a.stateVersion, turnKey: 't1', parts: text('رد') });
    assert.deepEqual([r.committed, r.reason], [false, 'human_owner']);
    assert.equal(store.messages.filter((m) => m.externalId.startsWith('turn:')).length, 0);
});

test('commitTurn: retrying the same turn returns the first result, no second reply', async () => {
    const store = fakeStore();
    const core = createConversationCore({ store });
    const a = await core.ingest(tg('tg:555:1'));
    const req = { conversationId: a.conversation.id, expectedVersion: a.stateVersion, turnKey: 'turn-1', parts: text('رد'), deliveryRequired: true };
    const one = await core.commitTurn(req);
    const two = await core.commitTurn(req);
    assert.equal(one.committed, true);
    assert.equal(two.duplicate, true);
    assert.equal(two.messageId, one.messageId);
    assert.equal(store.calls.filter(([op]) => op === 'commitTurn').at(-1)[1].deliveryRequired, true);
});

test('commitTurn: input the database would refuse is refused first', async () => {
    const store = fakeStore();
    const core = createConversationCore({ store });
    for (const req of [
        { conversationId: '', expectedVersion: 1, turnKey: 't', parts: text('x') },
        { conversationId: 'c1', expectedVersion: -1, turnKey: 't', parts: text('x') },
        { conversationId: 'c1', expectedVersion: 1.5, turnKey: 't', parts: text('x') },
        { conversationId: 'c1', expectedVersion: 1, turnKey: ' ', parts: text('x') },
        { conversationId: 'c1', expectedVersion: 1, turnKey: 't', parts: text('   ') },
        { conversationId: 'c1', expectedVersion: 1, turnKey: 't', parts: [{ type: 'event', name: 'typing' }] },
        { conversationId: 'c1', expectedVersion: 1, turnKey: 't', parts: text('x'), state: [] }
    ]) {
        await assert.rejects(core.commitTurn(req), MessageValidationError, JSON.stringify(req));
    }
    assert.equal(store.calls.length, 0);
});

test('delivery: claimed=false means do not send; only terminal states are recorded', async () => {
    const core = createConversationCore({ store: fakeStore() });
    assert.equal((await core.claimDelivery('m1')).claimed, true);
    assert.equal((await core.claimDelivery('m1')).claimed, false);
    assert.equal((await core.recordDelivery('m1', 'sent', { providerMessageId: 'p' })).updated, true);
    await assert.rejects(core.recordDelivery('m1', 'sending'), MessageValidationError);
    await assert.rejects(core.recordDelivery('m1', 'bogus'), MessageValidationError);
});

test('a store missing a method is refused at construction', () => {
    assert.throws(() => createConversationCore({ store: { ingest() {} } }), TypeError);
});

// ══ store-supabase: نفس أسماء معاملات 064 ════════════════════════════════

test('store-supabase calls the 064 functions with their exact parameter names', async () => {
    const calls = [];
    const client = { async rpc(fn, args) { calls.push([fn, args]); return { data: { created: true }, error: null }; } };
    const store = createSupabaseConversationStore({ client });
    await store.ingest({ channel: 'telegram', userId: 'u', externalThreadId: '5', externalId: 'e', text: 't', parts: [], metadata: {}, channelIdentityId: null, idleAfterMinutes: 1440 });
    await store.commitTurn({ conversationId: 'c', expectedVersion: 1, turnKey: 'k', text: 't', parts: [], state: null, agentId: 'sie', deliveryRequired: true, ticket: null, handoffReason: null });
    await store.claimDelivery('m');
    await store.recordDelivery('m', 'sent', 'p', null);
    // migrations/064_conversation_core.sql in Mad3oom — the signatures, in order.
    assert.deepEqual(calls.map(([fn, a]) => [fn, Object.keys(a)]), [
        ['conv_ingest_message', ['p_channel', 'p_user_id', 'p_external_thread_id', 'p_external_id', 'p_text', 'p_parts', 'p_metadata', 'p_channel_identity_id', 'p_idle_after']],
        ['conv_commit_turn', ['p_conversation_id', 'p_expected_version', 'p_turn_key', 'p_reply_text', 'p_reply_parts', 'p_state', 'p_agent_id', 'p_delivery_required', 'p_ticket', 'p_handoff_reason']],
        ['conv_claim_delivery', ['p_message_id']],
        ['conv_record_delivery', ['p_message_id', 'p_state', 'p_provider_message_id', 'p_error']]
    ]);
    assert.equal(calls[0][1].p_idle_after, '1440 minutes');
});

test('store-supabase surfaces database errors instead of swallowing them', async () => {
    const store = createSupabaseConversationStore({ client: { async rpc() { return { data: null, error: { message: 'permission denied', code: '42501' } }; } } });
    await assert.rejects(store.ingest({}), (e) => e instanceof ConversationStoreError && e.code === '42501');
    assert.throws(() => createSupabaseConversationStore({ client: {} }), TypeError);
});

// ══ الأحداث والأعلام ═════════════════════════════════════════════════════

test('events: the seven conversation events map to inbox_events kinds', () => {
    assert.deepEqual(Object.keys(CONVERSATION_EVENTS).sort(), ['AgentReplied', 'AgentResumed', 'ConversationClosed',
        'ConversationCreated', 'HumanReply', 'HumanTakeover', 'MessageReceived']);
    assert.equal(eventFromRow({ id: 1, kind: 'handoff_to_human', session_id: 'c', payload: { reason: 'r' } }).type, 'HumanTakeover');
    assert.equal(eventFromRow({ id: 2, kind: 'tagged', session_id: 'c' }), null);
});

test('flags: closed unless literally true; a failed read means the old path', () => {
    assert.deepEqual(Object.values(CORE_FLAG_KEYS).sort(), ['agent_runtime_enabled', 'core_ingest_telegram', 'core_ingest_website']);
    const closed = readCoreFlags(null);
    assert.deepEqual({ ...closed }, { coreIngestWebsite: false, coreIngestTelegram: false, agentRuntimeEnabled: false });
    const odd = readCoreFlags([{ key: 'core_ingest_website', value: 'true' }, { key: 'core_ingest_telegram', value: 1 }]);
    assert.equal(isChannelOnCore(odd, 'website'), false);
    assert.equal(isChannelOnCore(odd, 'telegram'), false);
    const open = readCoreFlags([{ key: 'core_ingest_telegram', value: true }]);
    assert.equal(isChannelOnCore(open, 'telegram'), true);
    assert.equal(isChannelOnCore(open, 'website'), false);
    assert.equal(isChannelOnCore(open, 'whatsapp'), false);
});
