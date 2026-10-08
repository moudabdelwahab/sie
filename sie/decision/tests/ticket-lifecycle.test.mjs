/**
 * ticket-lifecycle.test.mjs — G-L5-1 and G-L5-6 at the Decision layer (WP4).
 *
 * The audit's RC1: a ticket that was decided, proposed, declined, withheld,
 * switched off or already on the account was recorded as "created", and the
 * next ticket decision told the customer about a ticket that did not exist.
 * A decision is not a ticket; only the Action layer's commit makes one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, normalizeDecisionState, recordDecision, ANSWER_FOLLOW_UPS } from '../decision-engine.js';
import { ACTIONS, createEmptyDecisionState } from '../decision-types.js';
import { resolvePolicy } from '../decision-policy.js';
import { TICKET_STATES, emptyTicket, normalizeTicket, isTicketOnFile, transitionTicket, withTicket } from '../ticket-lifecycle.js';
import { ACTIVATION_THRESHOLD } from '../../diagnostics/hypothesis-tracker.js';

const clock = () => '2026-01-01T00:00:00.000Z';

function entry(id, confidence, scenario = {}) {
    return {
        hypothesis: { scenarioId: id, status: 'active', confidence, supportingEvidenceTokens: [], missingEvidenceTokens: [], hasEverBeenActive: true, firstSeenTurn: 1, lastUpdatedTurn: 1, history: [] },
        scenario: { id, label: { ar: id, en: id }, category: 'other', evidenceSignature: [{ token: 'x', weight: 1 }], discriminatingQuestions: [], resolution: { hasAutoResolution: false }, ...scenario },
        rank: 1
    };
}
const ranking = (...ranked) => ({ ranked, topHypothesis: ranked[0] || null, runnerUp: ranked[1] || null, confidenceGap: null, isAmbiguous: false, candidateDiscriminatingQuestions: [], catalogSize: 10, scopeSize: ranked.length });

// ── the lifecycle table ─────────────────────────────────────────────

test('[G-L5-1] transition table: every event from every state', () => {
    const S = TICKET_STATES;
    const from = (state) => ({ ...emptyTicket(), state });
    const table = [
        // [from, event, to]
        [S.NONE, 'propose', S.PROPOSED], [S.NONE, 'commit', S.CREATED], [S.NONE, 'withhold', S.WITHHELD],
        [S.NONE, 'unavailable', S.UNAVAILABLE], [S.NONE, 'existing', S.EXISTING], [S.NONE, 'decline', S.DECLINED],
        [S.PROPOSED, 'commit', S.CREATED], [S.PROPOSED, 'decline', S.DECLINED], [S.PROPOSED, 'lapse', S.NONE],
        [S.DECLINED, 'propose', S.PROPOSED], [S.WITHHELD, 'propose', S.PROPOSED], [S.UNAVAILABLE, 'propose', S.PROPOSED],
        // A ticket on file is not un-made by a later proposal, decline, withhold or lapse.
        [S.CREATED, 'propose', S.CREATED], [S.CREATED, 'decline', S.CREATED], [S.CREATED, 'withhold', S.CREATED],
        [S.CREATED, 'unavailable', S.CREATED], [S.CREATED, 'lapse', S.CREATED],
        [S.EXISTING, 'propose', S.EXISTING], [S.EXISTING, 'decline', S.EXISTING], [S.EXISTING, 'commit', S.CREATED]
    ];
    const wrong = table.filter(([f, e, t]) => transitionTicket(from(f), e).state !== t).map(([f, e, t]) => `${f} --${e}--> ${transitionTicket(from(f), e).state} (want ${t})`);
    assert.deepEqual(wrong, []);
    assert.throws(() => transitionTicket(emptyTicket(), 'create'), /unknown ticket event/);
});

test('[G-L5-1] only created and existing are "on file"; the legacy boolean is derived from that', () => {
    for (const state of Object.values(TICKET_STATES)) {
        const onFile = state === 'created' || state === 'existing';
        assert.equal(isTicketOnFile({ state }), onFile, state);
        assert.equal(withTicket(createEmptyDecisionState(), { ...emptyTicket(), state }).ticketAlreadyCreated, onFile, state);
    }
});

test('[G-L5-1] a stored legacy "ticketAlreadyCreated: true" is not trusted as a ticket', () => {
    const legacy = normalizeDecisionState({ ...createEmptyDecisionState(), ticket: undefined, ticketAlreadyCreated: true });
    assert.equal(legacy.ticket.state, 'none');
    assert.equal(legacy.ticket.legacyClaim, true);
    assert.equal(legacy.ticketAlreadyCreated, false);
    assert.equal(normalizeTicket({ state: 'bogus' }).state, 'none');
    assert.equal(normalizeTicket({ state: 'created', ref: 1001 }).ref, 1001);
});

test('[G-L5-1] decide() never records a ticket from a decision', () => {
    const r = ranking(entry('s1', 0.95));
    const prev = { ...createEmptyDecisionState(), supplementaryEvidenceRequested: true, lastAction: ACTIONS.ASK_FOR_LOGS };
    const { decision, decisionState } = decide({ ranking: r, turn: 2, previousDecisionState: prev, newEvidenceAddedThisTurn: 1, clock });
    assert.equal(decision.action, ACTIONS.CREATE_TICKET, 'precondition: a ticket was decided');
    assert.ok(decision.ticketDraft);
    assert.equal(decisionState.ticket.state, 'none');
    assert.equal(decisionState.ticketAlreadyCreated, false);
});

test('[G-L5-1] with a ticket on file, a ticket decision carries no draft (no second ticket) and is marked alreadyTicketed', () => {
    const r = ranking(entry('s1', 0.95));
    const prev = withTicket({ ...createEmptyDecisionState(), supplementaryEvidenceRequested: true }, { ...emptyTicket(), state: 'created', ref: 1001 });
    const { decision, decisionState } = decide({ ranking: r, turn: 3, previousDecisionState: prev, newEvidenceAddedThisTurn: 1, clock });
    assert.equal(decision.alreadyTicketed, true);
    assert.equal(decision.ticketDraft, null);
    assert.equal(decisionState.ticket.state, 'created', 'the ticket stays on file');
});

test('[G-L5-1] with only a declined / withheld / proposed ticket, a new ticket decision still drafts a ticket', () => {
    for (const state of ['declined', 'withheld', 'proposed', 'unavailable']) {
        const prev = withTicket({ ...createEmptyDecisionState(), supplementaryEvidenceRequested: true }, { ...emptyTicket(), state });
        const { decision } = decide({ ranking: ranking(entry('s1', 0.95)), turn: 3, previousDecisionState: prev, newEvidenceAddedThisTurn: 1, clock });
        assert.ok(decision.ticketDraft, state);
        assert.ok(!decision.alreadyTicketed, state);
    }
});

test('[G-L5-1] recordDecision keeps the ticket and the new bookkeeping fields', () => {
    const prev = withTicket({ ...createEmptyDecisionState(), declinedScenarioIds: ['a'], resolvedScenarioIds: ['b'] }, { ...emptyTicket(), state: 'declined' });
    const next = recordDecision(prev, { action: ACTIONS.CREATE_TICKET, scenarioId: 's', turn: 2, explanation: 'x' }, 0);
    assert.equal(next.ticket.state, 'declined');
    assert.equal(next.ticketAlreadyCreated, false);
    assert.deepEqual(next.declinedScenarioIds, ['a']);
    assert.deepEqual(next.resolvedScenarioIds, ['b']);
});

// ── R6B: after an answer (G-L5-6) ───────────────────────────────────

function afterAnswer(extra = {}) {
    return { ...createEmptyDecisionState(), lastAction: ACTIONS.ANSWER, lastScenarioId: 's1', answeredScenarioIds: ['s1'], ...extra };
}
const answeredRanking = () => ranking(entry('s1', 0.95, { resolution: { hasAutoResolution: true, text: { ar: 'x', en: 'x' } } }));

test('[G-L5-6] R6B table: unresolved → ticket; resolved or nothing new → complete; anything else → a follow-up, not a failure', () => {
    const run = (prev, newEvidence, customerSignal) =>
        decide({ ranking: answeredRanking(), turn: 2, previousDecisionState: prev, newEvidenceAddedThisTurn: newEvidence, clock, customerSignal }).decision;

    assert.equal(run(afterAnswer(), 1, 'unresolved').action, ACTIONS.CREATE_TICKET);
    assert.equal(run(afterAnswer(), 1, 'resolved').action, ACTIONS.COMPLETE);
    const followUp = run(afterAnswer(), 1, null);
    assert.equal(followUp.action, ACTIONS.WAIT_FOR_USER, 'a detail or «طيب» after an answer is not failure');
    assert.equal(followUp.followUp, 'check_resolution');
    assert.equal(followUp.scenarioId, 's1');
    assert.equal(followUp.ticketDraft, null);
});

test('[G-L5-6] R6B: follow-ups are bounded — after ANSWER_FOLLOW_UPS turns without a verdict, a human takes it', () => {
    assert.equal(ANSWER_FOLLOW_UPS, 2);
    let state = afterAnswer();
    const actions = [];
    for (let turn = 2; turn <= 4; turn++) {
        const { decision, decisionState } = decide({ ranking: answeredRanking(), turn, previousDecisionState: state, newEvidenceAddedThisTurn: 1, clock });
        actions.push(decision.action);
        state = decisionState;
    }
    assert.deepEqual(actions, [ACTIONS.WAIT_FOR_USER, ACTIONS.WAIT_FOR_USER, ACTIONS.CREATE_TICKET]);
});

test('[G-L5-6] R6B: a new ANSWER resets the follow-up count', () => {
    const next = recordDecision(afterAnswer({ followUpsAfterAnswer: 2 }), { action: ACTIONS.ANSWER, scenarioId: 's2', turn: 3, explanation: 'x' }, 0);
    assert.equal(next.followUpsAfterAnswer, 0);
});

// ── R6C removed (G-L5-12) ───────────────────────────────────────────

test('[G-L5-12] R6C is removed: no rule evaluates it and the policy has no cap for it', () => {
    const r = ranking(entry('s1', 0.95, { resolution: { hasAutoResolution: true, text: { ar: 'x', en: 'x' } } }), entry('s2', 0.95), entry('s3', 0.94));
    const { decision } = decide({ ranking: r, turn: 1, previousDecisionState: null, newEvidenceAddedThisTurn: 1, clock });
    assert.ok(!decision.evaluatedRules.some((x) => x.rule.startsWith('R6C')));
    assert.equal(decision.action, ACTIONS.ANSWER, 'several confident candidates do not suppress the leader\'s answer');
    assert.ok(!('maxSimultaneousResolvable' in resolvePolicy({ maxSimultaneousResolvable: 2 })));
    assert.ok(ACTIVATION_THRESHOLD < 0.95);
});
