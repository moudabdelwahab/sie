/**
 * turn-executor.test.mjs — G-L8-2 and G-L8-5 at the Action layer (WP4).
 *
 * The executor stamps every write and executes exactly the decided effects:
 * nothing added, nothing substituted, in the order pre → commit → post.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { stampState, runPreEffects, commitTurn, runPostEffects } from '../turn-executor.js';
import { ACTIONS } from '../../decision/decision-types.js';

const NOW = '2026-01-01T09:00:00.000Z';

function fakePort() {
    const calls = [];
    return {
        calls,
        persistBotTurn: async (args) => { calls.push(['persist', args]); return { success: true }; },
        createTicketWithMessageAndSessionUpdate: async (args) => { calls.push(['ticket', args]); return { success: true, ticketNumber: 1001 }; }
    };
}
const turnDecision = (commitType, decision, nextSie = { language: 'ar', decisionState: { ticket: { state: commitType === 'create_ticket' ? 'created' : 'none' } } }) => ({
    effects: { pre: [], commit: { type: commitType }, post: [] }, commitDecision: decision, nextSie
});
const ticketDecision = { action: ACTIONS.CREATE_TICKET, turn: 2, explanation: 'x', ticketDraft: { scenarioId: 's', category: 'c', diagnosticTrail: [] } };

test('[G-L8-2] every write carries this turn\'s lastTurnAt; the session\'s other keys are untouched', async () => {
    assert.deepEqual(stampState({ other: 1, sie: { old: true } }, { language: 'ar' }, NOW), { other: 1, sie: { language: 'ar', lastTurnAt: NOW } });
    for (const commit of ['persist_reply', 'create_ticket']) {
        const port = fakePort();
        await commitTurn({ turnDecision: turnDecision(commit, ticketDecision), rendered: { text: 't', options: [] }, sessionId: 's', botState: {}, port, nowIso: NOW, effects: [] });
        assert.equal(port.calls[0][1].botState.sie.lastTurnAt, NOW, commit);
    }
});

test('[G-L8-5] persist_reply never opens a ticket, whatever the decision carries', async () => {
    const port = fakePort();
    const effects = [];
    const { actionResult } = await commitTurn({ turnDecision: turnDecision('persist_reply', ticketDecision), rendered: { text: 't', options: [] }, sessionId: 's', botState: {}, port, nowIso: NOW, effects });
    assert.equal(actionResult.success, true);
    assert.deepEqual(port.calls.map((c) => c[0]), ['persist']);
    assert.deepEqual(effects.map((e) => e.type), ['persist_reply']);
});

test('[G-L8-5] create_ticket commits the ticket and its `created` state in one call, and records the number', async () => {
    const port = fakePort();
    const effects = [];
    const { botState } = await commitTurn({ turnDecision: turnDecision('create_ticket', ticketDecision), rendered: { text: 't', options: [] }, sessionId: 's', botState: {}, port, nowIso: NOW, effects });
    assert.deepEqual(port.calls.map((c) => c[0]), ['ticket']);
    assert.equal(port.calls[0][1].botState.sie.decisionState.ticket.state, 'created', 'created is written in the ticket\'s own transaction');
    assert.deepEqual(effects, [{ type: 'create_ticket', ok: true, ticketNumber: 1001 }]);
    assert.equal(botState.sie.decisionState.ticket.ref, 1001);
    await assert.rejects(
        commitTurn({ turnDecision: turnDecision('create_ticket', { ...ticketDecision, ticketDraft: null }), rendered: { text: 't', options: [] }, sessionId: 's', botState: {}, port: fakePort(), nowIso: NOW, effects: [] }),
        /without a ticket draft/
    );
});

test('[G-L8-5] pre- and post-commit effects run exactly as decided, and report their real outcome', async () => {
    const effects = [];
    const port = {
        queueReview: async () => ({ queued: true }),
        writeFacts: async (facts) => ({ saved: facts.length }),
        forgetFacts: async () => ({ success: false }),
        requestHandoff: async () => ({ handedOff: true })
    };
    const outcomes = await runPreEffects([{ type: 'queue_review', turn: 1 }, { type: 'write_facts', facts: [{ key: 'name', value: 'x' }] }, { type: 'forget_facts' }], port, effects);
    assert.deepEqual(outcomes, { queued: true, saved: 1, forgot: false });
    const { handedOff } = await runPostEffects([{ type: 'request_handoff', reason: 'r' }], port, effects);
    assert.equal(handedOff, true);
    assert.deepEqual(effects.map((e) => `${e.type}:${e.ok}`), ['queue_review:true', 'write_facts:true', 'forget_facts:false', 'request_handoff:true']);
    await assert.rejects(runPreEffects([{ type: 'open_ticket' }], port, []), /unknown pre-commit effect/);
    await assert.rejects(runPostEffects([{ type: 'queue_review' }], port, []), /unknown post-commit effect/);
});
