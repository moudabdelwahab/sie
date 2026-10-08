/**
 * conversation-rules.test.mjs — Layer 5's conversation rules, as pure functions (WP4).
 *
 * The rules that used to be early returns in sie-chat-bridge.js, tested
 * without a database: the ticket question's lifecycle (owner decision D2),
 * the escalation rule and its kill switch (D3), closing and multi-problem
 * continuity, the ticket lifecycle on finalisation, and the route record.
 * End-to-end behaviour is in the goldens (sie-integration/tests/golden/).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ROUTES, conversationPolicy, classifyPromptAnswer, openPrompt, escalationFor, planTurn, focusFor,
    remainingProblem, finalizeTurn, decideTurn, loadPreviousState, DEFAULT_TICKET_PROMPT_MINUTES, MAX_PROMPT_REASKS
} from '../conversation-rules.js';
import { ACTIONS, createEmptyDecisionState } from '../decision-types.js';
import { emptyTicket, withTicket } from '../ticket-lifecycle.js';
import { SIE_DEFAULT_SETTINGS } from '../../config/settings-schema.js';

const T0 = Date.parse('2026-01-01T09:00:00Z');
const MIN = 60000;
const policy = (over = {}) => conversationPolicy({ ...SIE_DEFAULT_SETTINGS, ...over });
const signals = (over = {}) => ({
    diagnosticContent: false, smallTalk: null, humanRequest: null, emotion: null, threat: null,
    resolution: null, memory: null, replyPolarity: null, truncated: false, receivedChars: 1, ...over
});
const TRUSTED = { level: 'trusted', mayTriggerAction: true, mayMutateState: true, mayWriteFacts: true, evidenceBudget: Infinity, rationale: 'no risk signal fired', signals: [] };
const QUARANTINED = { level: 'quarantined', mayTriggerAction: false, mayMutateState: false, mayWriteFacts: false, evidenceBudget: 0, rationale: 'test', signals: ['x'] };

const ticketDecision = (over = {}) => ({
    action: ACTIONS.CREATE_TICKET, scenarioId: 'login_cannot_access', scenarioLabel: { ar: 'x', en: 'x' }, confidence: 0.9,
    explanation: 'test', evaluatedRules: [{ rule: 'R7_CONFIDENT_LEADER', matched: true, detail: '' }], timestamp: 't',
    ticketDraft: { scenarioId: 'login_cannot_access', category: 'login', diagnosticTrail: [] }, turn: 2, ...over
});
const pendingAt = (askedAt, over = {}) => openPrompt({ decision: ticketDecision(), language: 'ar', nowMs: askedAt, policy: policy() }) && { ...openPrompt({ decision: ticketDecision(), language: 'ar', nowMs: askedAt, policy: policy() }), ...over };

// ── the ticket question (G-L5-2, G-L5-3, owner decision D2) ──────────

test('[G-L5-2] a ticket question has askedAt and expiresAt = askedAt + ticket_prompt_minutes (default 30)', () => {
    assert.equal(DEFAULT_TICKET_PROMPT_MINUTES, 30);
    const p = openPrompt({ decision: ticketDecision(), language: 'ar', nowMs: T0, policy: policy() });
    assert.equal(p.askedAt, new Date(T0).toISOString());
    assert.equal(Date.parse(p.expiresAt) - T0, 30 * MIN);
    assert.equal(p.reasks, 0);
    assert.equal(p.kind, 'ticket');
    const custom = openPrompt({ decision: ticketDecision({ action: ACTIONS.ESCALATE_TO_HUMAN }), language: 'ar', nowMs: T0, policy: policy({ ticket_prompt_minutes: 90 }) });
    assert.equal(Date.parse(custom.expiresAt) - T0, 90 * MIN);
    assert.equal(custom.kind, 'escalation');
});

test('[G-L5-3] the prompt state machine, live and expired (the question bounds the QUESTION, not the answer)', () => {
    const live = pendingAt(T0);
    const at = (minutes) => T0 + minutes * MIN;
    const table = [
        // [message signals, minutes after asking, expected answer]
        [{ replyPolarity: 'yes' }, 5, 'yes'],
        [{ replyPolarity: 'no' }, 5, 'no'],
        [{ diagnosticContent: true }, 5, 'supersede'],
        [{ humanRequest: { explicit: true } }, 5, 'supersede'],
        [{ threat: { matched: 'x' } }, 5, 'supersede'],
        [{ memory: { kind: 'save', explicit: true } }, 5, 'supersede'],
        [{}, 5, 'reask'],
        // After expiry: a clear yes is still a request, a clear no still a decline,
        [{ replyPolarity: 'yes' }, 60, 'yes'],
        [{ replyPolarity: 'no' }, 60, 'no'],
        // a new problem is diagnosed, and anything else never revives the question.
        [{ diagnosticContent: true }, 60, 'supersede'],
        [{}, 60, 'drop'],
        [{ smallTalk: { type: 'greeting', coversWholeMessage: true } }, 60, 'drop']
    ];
    const wrong = table.filter(([sig, m, want]) => classifyPromptAnswer({ pending: live, signals: signals(sig), nowMs: at(m) }).answer !== want)
        .map(([sig, m, want]) => `${JSON.stringify(sig)} @${m}min → ${classifyPromptAnswer({ pending: live, signals: signals(sig), nowMs: at(m) }).answer} (want ${want})`);
    assert.deepEqual(wrong, []);
    assert.equal(classifyPromptAnswer({ pending: live, signals: signals(), nowMs: at(31) }).expired, true);
    assert.equal(classifyPromptAnswer({ pending: live, signals: signals(), nowMs: at(29) }).expired, false);
});

test('[G-L5-3] an unclear answer is re-asked at most once, then the question is dropped', () => {
    assert.equal(MAX_PROMPT_REASKS, 1);
    assert.equal(classifyPromptAnswer({ pending: pendingAt(T0, { reasks: 1 }), signals: signals(), nowMs: T0 + MIN }).answer, 'drop');
});

test('[G-L5-2] a question stored before WP4 (no expiry) is live, and its unclear answers are still bounded', () => {
    const legacy = { decision: ticketDecision(), language: 'ar' };
    assert.equal(classifyPromptAnswer({ pending: legacy, signals: signals(), nowMs: T0 + 9999 * MIN }).answer, 'reask');
    assert.equal(classifyPromptAnswer({ pending: { ...legacy, reasks: 1 }, signals: signals(), nowMs: T0 }).answer, 'drop');
});

test('[G-L5-2] an expired question never hijacks a new message: the plan routes the message itself', () => {
    const prev = { turnCount: 2, pendingTicketConfirmation: pendingAt(T0), decisionState: withTicket(createEmptyDecisionState(), { ...emptyTicket(), state: 'proposed' }) };
    const later = T0 + 60 * MIN;
    assert.equal(planTurn({ signals: signals({ diagnosticContent: true }), prev, policy: policy(), nowMs: later }).route, ROUTES.DIAGNOSTIC);
    assert.equal(planTurn({ signals: signals({ smallTalk: { type: 'greeting', coversWholeMessage: true } }), prev, policy: policy(), nowMs: later }).route, ROUTES.SMALL_TALK);
    assert.equal(planTurn({ signals: signals({ replyPolarity: 'yes' }), prev, policy: policy(), nowMs: later }).route, ROUTES.PENDING);
    assert.equal(planTurn({ signals: signals({ replyPolarity: 'no' }), prev, policy: policy(), nowMs: later }).route, ROUTES.PENDING);
});

// ── escalation (G-L5-11, owner decision D3) ──────────────────────────

test('[G-L5-11] escalation table: request and threat always; anger, sarcasm and bot-frustration only with context', () => {
    const anger = { emotion: { emotion: 'anger', negative: true } };
    const sarcasm = { emotion: { emotion: 'sarcasm', negative: true } };
    const botFrustration = { smallTalk: { type: 'frustration', coversWholeMessage: true } };
    const answered = { decisionState: { ...createEmptyDecisionState(), answeredScenarioIds: ['s1'] } };
    const reason = (sig, prev = null, over = {}) => escalationFor({ signals: signals(sig), prev, policy: policy(over) })?.reason ?? null;

    assert.equal(reason({ humanRequest: { explicit: true } }), 'human_request');
    assert.equal(reason({ humanRequest: { explicit: true } }, null, { ticket_on_anger: false }), 'human_request', 'a request for a person is honoured whatever the settings');
    assert.equal(reason({ threat: { matched: 'x' }, ...anger }), 'threat');
    assert.equal(reason({ threat: { matched: 'x' } }, null, { ticket_on_anger: false }), null, 'ticket_on_anger gates the emotional escalations');

    // No context: not escalated.
    for (const sig of [anger, sarcasm, botFrustration]) assert.equal(reason(sig), null, JSON.stringify(sig));
    // Context: the previous turn was negative, or an answer did not work.
    for (const sig of [anger, sarcasm, botFrustration]) {
        assert.equal(reason(sig, { lastEmotion: 'anger' }), 'frustration');
        assert.equal(reason(sig, { lastEmotion: 'frustration' }), 'frustration');
        assert.equal(reason({ ...sig, resolution: 'unresolved' }, answered), 'frustration');
    }
    assert.equal(reason(anger, { lastEmotion: 'thanks' }), null, 'a positive previous turn is not context');
    assert.equal(reason({ resolution: 'unresolved' }, answered), null, 'unresolved alone is not an escalation');
});

test('[G-L5-11] the kill switch (emotion_escalation_requires_context=false) restores escalation on the phrase alone', () => {
    const off = policy({ emotion_escalation_requires_context: false });
    for (const sig of [{ emotion: { emotion: 'anger', negative: true } }, { emotion: { emotion: 'sarcasm', negative: true } }, { smallTalk: { type: 'frustration' } }]) {
        assert.equal(escalationFor({ signals: signals(sig), prev: null, policy: off })?.reason, 'frustration', JSON.stringify(sig));
    }
    assert.equal(escalationFor({ signals: signals({ emotion: { emotion: 'urgency', negative: true } }), prev: null, policy: off }), null, 'urgency never escalated');
    assert.equal(policy().emotionNeedsContext, true, 'the safer rule is the default');
});

test('[G-L5-13] an escalation turn with a problem in it is diagnosed; anger without context is diagnosed and acknowledged', () => {
    const esc = planTurn({ signals: signals({ humanRequest: { explicit: true }, diagnosticContent: true }), prev: null, policy: policy(), nowMs: T0 });
    assert.equal(esc.route, ROUTES.ESCALATION);
    assert.equal(esc.diagnose, true);
    const angry = planTurn({ signals: signals({ emotion: { emotion: 'anger', negative: true }, diagnosticContent: true }), prev: null, policy: policy(), nowMs: T0 });
    assert.equal(angry.route, ROUTES.DIAGNOSTIC);
    assert.equal(angry.acknowledge, 'anger');
    const sarcastic = planTurn({ signals: signals({ emotion: { emotion: 'sarcasm', negative: true } }), prev: null, policy: policy(), nowMs: T0 });
    assert.equal(sarcastic.acknowledge, null, 'sarcasm-shaped praise without context is not acknowledged as sarcasm');
});

test('[G-L5-13] the escalation decision carries the diagnosed problem into its ticket draft', () => {
    const plan = planTurn({ signals: signals({ humanRequest: { explicit: true }, diagnosticContent: true }), prev: null, policy: policy(), nowMs: T0 });
    const entry = { hypothesis: { scenarioId: 'billing_double_charge', confidence: 0.8, status: 'active' }, scenario: { id: 'billing_double_charge', category: 'billing', label: { ar: 'x', en: 'x' } } };
    const ranking = { ranked: [entry], topHypothesis: entry, runnerUp: null };
    const { decision } = decideTurn({ plan, prev: null, ranking, signals: signals(), clock: () => 't' });
    assert.equal(decision.action, ACTIONS.ESCALATE_TO_HUMAN);
    assert.equal(decision.ticketDraft.scenarioId, 'billing_double_charge');
    assert.equal(decision.ticketDraft.category, 'billing');
});

// ── closing and multi-problem continuity (G-L5-4, G-L5-14) ───────────

test('[G-L5-4] "that worked" closes only after an answer; with a new problem in it, the old episode closes and the new one is diagnosed', () => {
    const answered = { turnCount: 3, decisionState: { ...createEmptyDecisionState(), answeredScenarioIds: ['s1'] } };
    assert.equal(planTurn({ signals: signals({ resolution: 'resolved' }), prev: null, policy: policy(), nowMs: T0 }).route, ROUTES.DIAGNOSTIC, 'no answer yet: nothing to close');
    const check = planTurn({ signals: signals({ resolution: 'resolved' }), prev: answered, policy: policy(), nowMs: T0 });
    assert.equal(check.route, ROUTES.RESOLUTION);
    assert.equal(check.close.mode, 'check');
    assert.equal(check.diagnoseTokens, 'none');
    const fresh = planTurn({ signals: signals({ resolution: 'resolved', diagnosticContent: true }), prev: answered, policy: policy(), nowMs: T0 });
    assert.equal(fresh.close.mode, 'fresh');
    assert.equal(fresh.freshEpisode, true);
    assert.equal(fresh.turn, 1);
});

test('[G-L5-14] another active problem remains only with evidence of its own, in another category, above activation', () => {
    const e = (id, category, confidence, supporting) => ({ hypothesis: { scenarioId: id, confidence, supportingEvidenceTokens: supporting }, scenario: { id, category, evidenceSignature: supporting.map((t) => ({ token: t, weight: 1 })) } });
    const ranked = [
        e('howto_use_api', 'inquiry', 1, ['intent_how_to', 'entity_api']),
        e('platform_info_inquiry', 'inquiry', 0.75, ['intent_how_to']),
        e('whatsapp_messages_not_sending', 'whatsapp', 0.73, ['entity_whatsapp', 'symptom_not_sending']),
        e('agent_cannot_access', 'other', 0.5, ['entity_api'])
    ];
    const plan = { close: { mode: 'check', resolvedIds: ['howto_use_api'] } };
    const { excludeIds, closedCategories } = focusFor({ plan, prev: { decisionState: createEmptyDecisionState() }, ranking: { ranked }, turnTokens: [], signals: signals() });
    assert.deepEqual(new Set(excludeIds), new Set(['howto_use_api', 'platform_info_inquiry', 'agent_cannot_access']),
        'the solved problem, its same-category variant, and a rival only the solved problem\'s words support');
    const rest = ranked.filter((x) => !excludeIds.includes(x.hypothesis.scenarioId));
    assert.equal(remainingProblem({ topHypothesis: rest[0] }, closedCategories, 0.3)?.hypothesis.scenarioId, 'whatsapp_messages_not_sending');
    assert.equal(remainingProblem({ topHypothesis: rest[0] }, closedCategories, 0.9), null, 'below activation is not an active problem');
});

test('[G-L5-3][G-L5-6] the customer moving on: declined, answered or superseded problems the message does not mention are set aside; restating keeps them', () => {
    const e = (id, tokens) => ({ hypothesis: { scenarioId: id, confidence: 0.8, supportingEvidenceTokens: tokens }, scenario: { id, category: id, evidenceSignature: tokens.map((t) => ({ token: t, weight: 1 })) } });
    const ranked = [e('login_cannot_access', ['symptom_login_failed', 'entity_account']), e('billing_double_charge', ['entity_invoice', 'symptom_duplicated'])];
    const prev = { decisionState: { ...createEmptyDecisionState(), declinedScenarioIds: ['login_cannot_access'] } };
    const plan = { close: null, prompt: null };
    const billing = focusFor({ plan, prev, ranking: { ranked }, turnTokens: ['entity_invoice', 'symptom_duplicated'], signals: signals({ diagnosticContent: true }) });
    assert.deepEqual(billing.excludeIds, ['login_cannot_access']);
    const restated = focusFor({ plan, prev, ranking: { ranked }, turnTokens: ['symptom_login_failed', 'entity_account'], signals: signals({ diagnosticContent: true }) });
    assert.deepEqual(restated.excludeIds, []);
    const filler = focusFor({ plan, prev, ranking: { ranked }, turnTokens: [], signals: signals() });
    assert.deepEqual(filler.excludeIds, [], 'a message with no problem in it moves on from nothing');
});

// ── finalisation: the ticket lifecycle and effects (G-L5-1, G-L5-8, G-L8-5) ──

function finalizeTicketTurn({ settings = {}, envelope = TRUSTED, data = {}, ds = createEmptyDecisionState(), route = ROUTES.DIAGNOSTIC } = {}) {
    const plan = { route, rules: [], turn: 2, acknowledge: null, escalation: route === ROUTES.ESCALATION ? { reason: 'human_request' } : null };
    const decided = { decision: ticketDecision(), decisionState: ds, priorState: ds, progress: { consecutiveNoNewEvidenceTurns: 0 }, closing: null };
    return finalizeTurn({ plan, prev: { turnCount: 1, decisionState: ds }, signals: signals(), policy: policy(settings), decided, decision: decided.decision, data, envelope, diagnosticState: null, language: 'ar', nowMs: T0, customerText: 'x' });
}

test('[G-L5-1] finalisation never records `created` without a create_ticket commit', () => {
    const cases = {
        proposed: finalizeTicketTurn({ settings: { ask_before_ticket: true } }),
        created: finalizeTicketTurn({ settings: { ask_before_ticket: false } }),
        withheld: finalizeTicketTurn({ envelope: QUARANTINED }),
        unavailable: finalizeTicketTurn({ settings: { auto_ticket_enabled: false } }),
        existing: finalizeTicketTurn({ data: { openTicket: { ticketNumber: 77 } } })
    };
    for (const [state, td] of Object.entries(cases)) {
        assert.equal(td.nextSie.decisionState.ticket.state, state, state);
        assert.equal(td.effects.commit.type === 'create_ticket', state === 'created', `${state}: commit ${td.effects.commit.type}`);
        assert.equal(td.nextSie.decisionState.ticketAlreadyCreated, state === 'created' || state === 'existing', state);
    }
    assert.ok(cases.proposed.nextSie.pendingTicketConfirmation?.expiresAt, 'a proposal opens a question with an expiry');
    assert.equal(cases.existing.reply.ticketNumber, 77);
    assert.equal(cases.withheld.reply.template, 'ticket_withheld');
    assert.equal(cases.unavailable.reply.template, 'tickets_disabled');
});

test('[G-L5-1][G-L6-2] with a ticket on file, a ticket decision is a reminder: no ticket, no second question', () => {
    const onFile = withTicket(createEmptyDecisionState(), { ...emptyTicket(), state: 'created', ref: 1001 });
    const td = finalizeTicketTurn({ ds: onFile, settings: { ask_before_ticket: true } });
    assert.equal(td.effects.commit.type, 'persist_reply');
    assert.equal(td.nextSie.pendingTicketConfirmation, undefined);
    assert.equal(td.reply.decision.alreadyTicketed, true);
});

test('[G-L5-8] a quarantined turn does not move the decision state beyond the turn counter; the withheld ticket is recorded', () => {
    const ds = { ...createEmptyDecisionState(), questionsAskedCount: 1 };
    const td = finalizeTicketTurn({ envelope: QUARANTINED, ds: { ...ds } });
    assert.equal(td.nextSie.decisionState.ticket.state, 'withheld');
    assert.equal(td.nextSie.decisionState.questionsAskedCount, 1);
    assert.equal(td.nextSie.turnCount, 2);
    assert.equal(td.intent.trustDowngradedFrom, ACTIONS.CREATE_TICKET);
});

test('[G-L5-3] the answer turn: yes commits exactly one ticket, no declines and queues a review, an escalation hands off after the write', () => {
    const answer = (polarity, kind = 'ticket') => {
        const prev = { turnCount: 2, decisionState: withTicket(createEmptyDecisionState(), { ...emptyTicket(), state: 'proposed' }), pendingTicketConfirmation: { ...pendingAt(T0), kind, decision: ticketDecision({ action: kind === 'escalation' ? ACTIONS.ESCALATE_TO_HUMAN : ACTIONS.CREATE_TICKET }) } };
        const plan = planTurn({ signals: signals({ replyPolarity: polarity }), prev, policy: policy(), nowMs: T0 + MIN });
        return finalizeTurn({ plan, prev, signals: signals({ replyPolarity: polarity }), policy: policy(), decided: null, decision: null, envelope: TRUSTED, diagnosticState: null, language: 'ar', nowMs: T0 + MIN, customerText: 'x' });
    };
    const yes = answer('yes');
    assert.equal(yes.effects.commit.type, 'create_ticket');
    assert.equal(yes.nextSie.decisionState.ticket.state, 'created');
    assert.deepEqual(yes.effects.post, []);
    assert.equal(yes.nextSie.pendingTicketConfirmation, undefined);
    const no = answer('no');
    assert.deepEqual(no.effects.pre.map((e) => e.type), ['queue_review']);
    assert.equal(no.effects.commit.type, 'persist_reply');
    assert.equal(no.nextSie.decisionState.ticket.state, 'declined');
    assert.deepEqual(no.nextSie.decisionState.declinedScenarioIds, ['login_cannot_access']);
    assert.deepEqual(answer('yes', 'escalation').effects.post.map((e) => e.reason), ['escalation_ticket_opened']);
    assert.deepEqual(answer('no', 'escalation').effects.post.map((e) => e.reason), ['escalation_ticket_declined']);
    const reask = answer(null);
    assert.equal(reask.reply.template, 'ticket_question');
    assert.equal(reask.nextSie.pendingTicketConfirmation.reasks, 1);
});

// ── every route is a recorded rule (G-L5-10) ─────────────────────────

test('[G-L5-10] every route is an evaluated rule: the plan records each rule it checked, ending at the one that matched', () => {
    const answered = { turnCount: 3, decisionState: { ...createEmptyDecisionState(), answeredScenarioIds: ['s1'] } };
    const cases = [
        [signals({ replyPolarity: 'yes' }), { turnCount: 2, pendingTicketConfirmation: pendingAt(T0) }, ROUTES.PENDING, 'C1_PENDING_TICKET_QUESTION'],
        [signals({ humanRequest: { explicit: true } }), null, ROUTES.ESCALATION, 'C2_ESCALATION'],
        [signals({ memory: { kind: 'save', explicit: true, facts: [] } }), null, ROUTES.MEMORY, 'C3_MEMORY'],
        [signals({ resolution: 'resolved' }), answered, ROUTES.RESOLUTION, 'C4_RESOLVED_AFTER_ANSWER'],
        [signals({ smallTalk: { type: 'greeting', coversWholeMessage: true } }), null, ROUTES.SMALL_TALK, 'C5_SMALL_TALK'],
        [signals({ diagnosticContent: true }), null, ROUTES.DIAGNOSTIC, 'C6_DIAGNOSTIC']
    ];
    for (const [sig, prev, route, rule] of cases) {
        const plan = planTurn({ signals: sig, prev, policy: policy(), nowMs: T0 + MIN });
        assert.equal(plan.route, route);
        const matched = plan.rules.filter((r) => r.matched);
        assert.equal(matched.at(-1)?.rule, rule, `${route}: last matched rule`);
        assert.ok(plan.rules.every((r) => typeof r.detail === 'string' && r.detail.length > 0), `${route}: every rule says why`);
    }
});

// ── previous state ───────────────────────────────────────────────────

test('context expiry (memory_context_minutes) still applies to every route, and keeps only the last issue', () => {
    const stored = { lastTurnAt: new Date(T0).toISOString(), lastScenarioLabel: { ar: 'x', en: 'x' }, pendingTicketConfirmation: pendingAt(T0) };
    const p = policy({ memory_context_minutes: 120 });
    assert.equal(loadPreviousState(stored, p, T0 + 60 * MIN).pendingTicketConfirmation.kind, 'ticket');
    assert.deepEqual(loadPreviousState(stored, p, T0 + 121 * MIN), { lastScenarioLabel: { ar: 'x', en: 'x' }, contextExpired: true });
    assert.equal(loadPreviousState(stored, policy({ memory_keep_context: false }), T0), null);
});
