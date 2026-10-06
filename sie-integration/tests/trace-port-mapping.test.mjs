/**
 * trace-port-mapping.test.mjs — L8 → L9: what the trace row actually stores.
 * ------------------------------------------------------------
 * The real Supabase port (supabase-port.supabase.js) maps a TraceEvent onto
 * chat_engine_trace_events columns. WP2 adds route, layer statuses, the sent
 * vs intended text and the executed outcome; these drive the real port with a
 * capturing client and check the row it would insert.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRealSupabasePort } from '../../sie/action/supabase-port.supabase.js';
import { buildTraceEvent } from '../../sie/observability/trace-logger.js';

function capturingClient() {
    const inserted = [];
    return {
        inserted,
        from(table) {
            return { insert: async (row) => { inserted.push({ table, row }); return { error: null }; } };
        },
        async rpc() { return { data: null, error: null }; }
    };
}

const event = (over = {}) => buildTraceEvent({
    sessionId: 's', turn: 2, rawText: 'x', normalizedTokens: [{ canonical: 'entity_account' }], diagnosticState: null,
    ranking: null, decision: { action: 'CREATE_TICKET' }, timestamp: '2026-01-01T00:00:00.000Z', ...over
});

test('[G-L9-2][G-L9-3] the row stores the sent text, the intended text, the route and the layer statuses', async () => {
    const client = capturingClient();
    const port = createRealSupabasePort(client);
    const layers = [{ layer: 'L1', status: 'ran' }, { layer: 'L6', status: 'ran' }];
    const outcome = { committed: true, delivered: true, effects: [{ type: 'persist_reply', ok: true }] };
    const res = await port.insertTraceEvent({
        sessionId: 's', turn: 2,
        traceEvent: event({ responseText: 'question sent', intendedText: 'ticket text', route: 'diagnostic', layers }),
        actionResult: outcome, renderedOptions: [{ label: 'a', value: 'a' }]
    });
    assert.equal(res.success, true);
    const { table, row } = client.inserted[0];
    assert.equal(table, 'chat_engine_trace_events');
    assert.deepEqual(row.rendered, { responseText: 'question sent', options: [{ label: 'a', value: 'a' }], intendedText: 'ticket text' });
    assert.equal(row.ranking.route, 'diagnostic');
    assert.deepEqual(row.ranking.layers, layers);
    assert.deepEqual(row.action_result, outcome, 'the executed outcome is its own column, apart from the decision');
    assert.equal(row.decision.action, 'CREATE_TICKET', 'the decision column keeps the intent');
});

test('[G-L8-6] a turn where nothing was sent stores responseText null, not an empty string', async () => {
    const client = capturingClient();
    const port = createRealSupabasePort(client);
    await port.insertTraceEvent({ sessionId: 's', turn: 1, traceEvent: event({ responseText: null }) });
    assert.equal(client.inserted[0].row.rendered.responseText, null);
});

test('rows written before WP2 fields existed keep their shape (no route/layers/intendedText keys)', async () => {
    const client = capturingClient();
    const port = createRealSupabasePort(client);
    await port.insertTraceEvent({ sessionId: 's', turn: 1, traceEvent: event({ responseText: 'r' }) });
    const { row } = client.inserted[0];
    assert.equal('route' in row.ranking, false);
    assert.equal('layers' in row.ranking, false);
    assert.equal('intendedText' in row.rendered, false);
});
