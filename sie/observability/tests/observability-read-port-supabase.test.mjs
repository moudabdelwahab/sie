import test from 'node:test';
import assert from 'node:assert/strict';
import { createObservabilityReadSupabasePort } from '../observability-read-port.supabase.js';
import { createMockSupabaseQueryClient, createFailingMockSupabaseQueryClient } from '../../scenarios/tests/helpers/mock-supabase-query-client.js';

// Mirrors the live chat_messages shape: there is no `turn` or `sender`
// column, so ordering comes from created_at and "customer" means neither
// bot nor admin. `turn` here only fixes the row order the port reads.
function messageRow(sessionId, turn, sender, text) {
    return {
        session_id: sessionId,
        message_text: text,
        is_bot_reply: sender === 'bot',
        is_admin_reply: sender === 'admin',
        created_at: new Date(Date.UTC(2026, 0, 1, 0, turn)).toISOString()
    };
}

test('supabase read port: returns only customer messages, ordered by turn', async () => {
    const client = createMockSupabaseQueryClient({
        chat_messages: [
            messageRow('s1', 2, 'customer', 'second message'),
            messageRow('s1', 1, 'customer', 'first message'),
            messageRow('s1', 1, 'bot', 'a bot reply, should be excluded')
        ]
    });
    const port = createObservabilityReadSupabasePort(client);
    const result = await port.getConversation('s1');
    assert.deepEqual(result.turns, [
        { turn: 1, rawText: 'first message' },
        { turn: 2, rawText: 'second message' }
    ]);
});

test('supabase read port: only returns messages for the requested session', async () => {
    const client = createMockSupabaseQueryClient({
        chat_messages: [messageRow('s1', 1, 'customer', 'mine'), messageRow('s2', 1, 'customer', 'not mine')]
    });
    const port = createObservabilityReadSupabasePort(client);
    const result = await port.getConversation('s1');
    assert.equal(result.turns.length, 1);
    assert.equal(result.turns[0].rawText, 'mine');
});

test('supabase read port: an unknown session returns null, not an empty conversation object', async () => {
    const client = createMockSupabaseQueryClient({ chat_messages: [] });
    const port = createObservabilityReadSupabasePort(client);
    const result = await port.getConversation('does-not-exist');
    assert.equal(result, null);
});

test('supabase read port: a query error degrades gracefully (via the interface\'s try/catch) rather than crashing', async () => {
    const client = createFailingMockSupabaseQueryClient('connection refused');
    const port = createObservabilityReadSupabasePort(client);
    const result = await port.getConversation('s1');
    assert.equal(result, null);
});
