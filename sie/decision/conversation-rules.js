/**
 * conversation-rules.js — Layer 5: what the engine DOES with this turn.
 * ------------------------------------------------------------
 * Until WP4 these decisions were made in sie-chat-bridge.js, outside the
 * Decision layer, as early returns that ran before diagnosis: the pending
 * ticket answer, the escalation, the memory instruction, the "that worked"
 * close, the small talk — and, after `decide()` had spoken, the article
 * rescue, the trust downgrade, the duplicate ticket, tickets switched off,
 * and the ticket question. Each one could discard the customer's problem or
 * record a ticket that never existed (audit RC1–RC10).
 *
 * They live here now, as pure functions the orchestrator calls in order:
 *
 *   planTurn       which route, and whether this turn is diagnosed
 *   focusFor       which scenarios the customer has moved on from
 *   decideTurn     the engine decision for the route (decide() + Free floor)
 *   finalizeTurn   the final decision, its effects and the next state
 *
 * No I/O. What the turn needs from outside (stored facts, the account's open
 * tickets, a knowledge article, the customer's name) is read by the
 * orchestrator through Layer 7 and passed in as data; what it changes is
 * returned as effects for the Action layer (Layer 8) to execute. Texts are
 * Dialogue's (Layer 6): this module names a reply, it never words one.
 *
 * Every route records a rule in `evaluatedRules` (G-L5-10).
 */
import { ACTIONS, createEmptyDecisionState } from './decision-types.js';
import { decide, normalizeDecisionState, recordDecision, buildTicketDraft } from './decision-engine.js';
import { TICKET_STATES, emptyTicket, isTicketOnFile, transitionTicket, withTicket } from './ticket-lifecycle.js';
import { scenarioTokens } from '../scenarios/scenario-types.js';
import { freeFloor } from '../editions/edition-turn.js';
import { admitAction, admitFacts } from '../trust/trust-boundary.js';

export const ROUTES = Object.freeze({
    PENDING: 'pending_confirmation',
    ESCALATION: 'escalation',
    MEMORY: 'memory',
    RESOLUTION: 'resolution_close',
    SMALL_TALK: 'small_talk',
    DIAGNOSTIC: 'diagnostic'
});

/** Default lifetime of a pending ticket question, minutes (owner decision D2). */
export const DEFAULT_TICKET_PROMPT_MINUTES = 30;

/** An unclear answer to the ticket question is re-asked at most this often (G-L5-3). */
export const MAX_PROMPT_REASKS = 1;

const TICKET_ACTIONS = new Set([ACTIONS.CREATE_TICKET, ACTIONS.ESCALATE_TO_HUMAN]);
const NEGATIVE_EMOTIONS = new Set(['anger', 'sarcasm', 'frustration']);
const ESCALATING_EMOTIONS = new Set(['anger', 'sarcasm']);

/**
 * The settings this module reads, in one place. Everything else in a turn
 * reads the policy object, never the settings row.
 * @param {Object} settings
 */
export function conversationPolicy(settings = {}) {
    const minutes = settings.ticket_prompt_minutes;
    return {
        promptMinutes: typeof minutes === 'number' && minutes > 0 ? minutes : DEFAULT_TICKET_PROMPT_MINUTES,
        // Kill switch (owner decision D3): false restores the pre-WP4 rule —
        // anger, sarcasm and bot-frustration escalate on the phrase alone.
        emotionNeedsContext: settings.emotion_escalation_requires_context !== false,
        escalateOnAnger: Boolean(settings.ticket_on_anger),
        replyToGreetings: Boolean(settings.reply_to_greetings),
        askBeforeTicket: Boolean(settings.ask_before_ticket),
        ticketsEnabled: Boolean(settings.auto_ticket_enabled),
        emotionReply: Boolean(settings.emotion_reply) && Boolean(settings.knowledge_empathy_replies),
        empathy: Boolean(settings.knowledge_empathy_replies),
        keepContext: settings.memory_keep_context !== false,
        contextMinutes: typeof settings.memory_context_minutes === 'number' ? settings.memory_context_minutes : null,
        rememberLastIssue: settings.memory_remember_last_issue !== false,
        rememberName: Boolean(settings.memory_remember_name),
        lastIssueInGreeting: Boolean(settings.memory_remember_last_issue)
    };
}

// ===================================================================
// Previous state
// ===================================================================

/**
 * «يفتكر سياق المحادثة» و«مدة الاحتفاظ بالسياق». Moved from the bridge.
 *
 * Returning null makes the turn the first of a fresh session. An expired
 * context keeps only the last issue's label, to ask about it in a greeting.
 *
 * @param {Object|null} stored - bot_state.sie as read
 * @param {Object} policy - conversationPolicy()
 * @param {number} nowMs
 */
export function loadPreviousState(stored, policy, nowMs) {
    if (!stored || typeof stored !== 'object') return null;
    if (!policy.keepContext) return null;
    if (policy.contextMinutes && stored.lastTurnAt) {
        const ageMinutes = (nowMs - new Date(stored.lastTurnAt).getTime()) / 60000;
        if (Number.isFinite(ageMinutes) && ageMinutes > policy.contextMinutes) {
            return policy.rememberLastIssue ? { lastScenarioLabel: stored.lastScenarioLabel || null, contextExpired: true } : null;
        }
    }
    return { ...stored, decisionState: stored.decisionState ? normalizeDecisionState(stored.decisionState) : stored.decisionState };
}

/** «يستفيد من المحادثات القديمة»: a recalled session's evidence, merged in. */
export function withRecalledSession(prev, recalled) {
    if (!recalled) return prev;
    return { ...(prev || {}), diagnosticState: recalled.diagnosticState, lastScenarioLabel: recalled.lastScenarioLabel };
}

// ===================================================================
// The pending ticket question (G-L5-2, G-L5-3)
// ===================================================================

/**
 * What the customer's message does to a pending ticket question.
 *
 *   yes / no   — a clear answer is honoured, however late: the question's
 *                lifetime bounds the QUESTION, not the answer (owner D2).
 *   supersede  — the message carries a problem, a request for a person, a
 *                threat or a memory instruction: the question is dropped and
 *                the message is processed on its own.
 *   reask      — unclear, the question is live, and it has not been re-asked.
 *   drop       — unclear and the question expired, or was already re-asked:
 *                the question is dropped and the message processed on its
 *                own. An expired question never captures a new message.
 *
 * A question stored before WP4 carries no expiry; it is treated as live
 * (its unclear answers are still bounded to one re-ask).
 */
export function classifyPromptAnswer({ pending, signals, nowMs }) {
    const expiresAt = pending?.expiresAt ? Date.parse(pending.expiresAt) : NaN;
    const expired = Number.isFinite(expiresAt) && nowMs > expiresAt;
    if (signals.replyPolarity === 'yes') return { answer: 'yes', expired };
    if (signals.replyPolarity === 'no') return { answer: 'no', expired };
    const memory = signals.memory && (signals.memory.explicit || signals.memory.standalone);
    if (signals.diagnosticContent || signals.humanRequest || signals.threat || memory) return { answer: 'supersede', expired };
    if (expired) return { answer: 'drop', expired };
    return { answer: (pending?.reasks || 0) < MAX_PROMPT_REASKS ? 'reask' : 'drop', expired };
}

/** A new pending ticket question for `decision`. */
export function openPrompt({ decision, language, nowMs, policy }) {
    return {
        decision,
        language,
        kind: decision.action === ACTIONS.ESCALATE_TO_HUMAN ? 'escalation' : 'ticket',
        askedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + policy.promptMinutes * 60000).toISOString(),
        reasks: 0
    };
}

// ===================================================================
// Escalation (G-L5-11, owner decision D3)
// ===================================================================

/** The negative tone this turn carries, recorded so the next turn has context. */
export function negativeTone(signals) {
    if (signals.emotion?.negative && NEGATIVE_EMOTIONS.has(signals.emotion.emotion)) return signals.emotion.emotion;
    if (signals.smallTalk?.type === 'frustration') return 'frustration';
    return null;
}

/**
 * Whether this turn escalates to a person, and why.
 *
 *   an explicit request for a person   always
 *   a threat (legal action, refund …)  when anger escalation is on
 *   anger / sarcasm / bot-frustration  only WITH CONTEXT: the previous turn
 *                                      was already negative, or the customer
 *                                      says an answer did not solve it —
 *                                      unless the kill switch is off, which
 *                                      restores escalation on the phrase alone
 *
 * Without context, anger and sarcasm do not discard the customer's problem:
 * the turn is diagnosed (and anger acknowledged).
 *
 * @returns {{reason: 'human_request'|'threat'|'frustration', withContext: boolean}|null}
 */
export function escalationFor({ signals, prev, policy }) {
    if (signals.humanRequest) return { reason: 'human_request', withContext: false };
    if (!policy.escalateOnAnger) return null;
    if (signals.threat) return { reason: 'threat', withContext: false };
    const emotional = ESCALATING_EMOTIONS.has(signals.emotion?.emotion) || signals.smallTalk?.type === 'frustration';
    if (!emotional) return null;
    if (!policy.emotionNeedsContext) return { reason: 'frustration', withContext: false };
    const answered = (prev?.decisionState?.answeredScenarioIds || []).length > 0;
    const context = NEGATIVE_EMOTIONS.has(prev?.lastEmotion) || (answered && signals.resolution === 'unresolved');
    return context ? { reason: 'frustration', withContext: true } : null;
}

/** The acknowledgement Dialogue puts in front of a diagnosed reply, if any. */
function acknowledgementFor(signals, policy) {
    const emotion = signals.emotion?.emotion;
    // Sarcasm-shaped praise with no complaint behind it is acknowledged as
    // nothing: «ما شاء الله على السرعة» may be sincere.
    if (emotion === 'sarcasm' && policy.emotionNeedsContext) return null;
    if (emotion && policy.emotionReply) return emotion;
    if (signals.smallTalk?.type === 'frustration' && policy.empathy) return 'frustration';
    return null;
}

// ===================================================================
// planTurn — the route
// ===================================================================

/**
 * @param {Object} params
 * @param {Object} params.signals - Layer 1
 * @param {Object|null} params.prev - loadPreviousState()
 * @param {Object} params.policy - conversationPolicy()
 * @param {number} params.nowMs
 * @returns {Object} the plan
 */
export function planTurn({ signals, prev, policy, nowMs }) {
    const rules = [];
    const rule = (name, matched, detail) => rules.push({ rule: name, matched, detail });
    const answeredIds = prev?.decisionState?.answeredScenarioIds || [];
    const base = {
        rules, prompt: null, escalation: null, memory: null, smallTalk: null, close: null,
        acknowledge: null, freshEpisode: false, diagnose: false, diagnoseTokens: 'turn',
        turn: (prev?.turnCount || 0) + 1,
        // What the turn needs Layer 7 to read before it can be finalized.
        reads: {}
    };

    // C1 — a pending ticket question.
    if (prev?.pendingTicketConfirmation) {
        const pending = prev.pendingTicketConfirmation;
        const { answer, expired } = classifyPromptAnswer({ pending, signals, nowMs });
        rule('C1_PENDING_TICKET_QUESTION', ['yes', 'no', 'reask'].includes(answer),
            `answer=${answer}${expired ? ' (question expired)' : ''}, reasks=${pending.reasks || 0}`);
        if (answer === 'yes' || answer === 'no' || answer === 'reask') {
            return { ...base, route: ROUTES.PENDING, prompt: { answer, expired, pending }, turn: prev.turnCount || 0 };
        }
        base.prompt = { answer, expired, pending };
    } else {
        rule('C1_PENDING_TICKET_QUESTION', false, 'no ticket question is pending');
    }

    // C2 — escalation.
    const escalation = escalationFor({ signals, prev, policy });
    rule('C2_ESCALATION', Boolean(escalation), escalation
        ? `${escalation.reason}${escalation.withContext ? ' (with context)' : ''}`
        : `humanRequest=${Boolean(signals.humanRequest)}, threat=${Boolean(signals.threat)}, emotion=${signals.emotion?.emotion ?? 'none'}, previousTone=${prev?.lastEmotion ?? 'none'}, requiresContext=${policy.emotionNeedsContext}`);
    if (escalation) {
        // The message's problem is diagnosed on the same turn (G-L5-13).
        return { ...base, route: ROUTES.ESCALATION, escalation, diagnose: Boolean(signals.diagnosticContent) };
    }

    // C3 — an instruction about memory.
    const memory = signals.memory && (signals.memory.explicit || signals.memory.standalone) ? signals.memory : null;
    rule('C3_MEMORY', Boolean(memory), memory ? `memory:${memory.kind}` : 'no memory instruction');
    if (memory) return { ...base, route: ROUTES.MEMORY, memory, turn: prev?.turnCount || 0, reads: { facts: true } };

    // C4 — "that worked", after an answer (G-L5-4, G-L5-14).
    const resolved = signals.resolution === 'resolved' && answeredIds.length > 0;
    rule('C4_RESOLVED_AFTER_ANSWER', resolved, `resolution=${signals.resolution ?? 'none'}, answered=${answeredIds.length}, diagnosticContent=${signals.diagnosticContent}`);
    if (resolved) {
        if (signals.diagnosticContent) {
            // «اتحلت، بس عندي مشكلة تانية»: the answered problem is closed and
            // the new one is diagnosed from a fresh episode.
            return { ...base, route: ROUTES.RESOLUTION, close: { mode: 'fresh', resolvedIds: answeredIds }, diagnose: true, freshEpisode: true, turn: 1 };
        }
        // Close — unless another active problem remains (decided after ranking).
        return { ...base, route: ROUTES.RESOLUTION, close: { mode: 'check', resolvedIds: answeredIds }, diagnose: true, diagnoseTokens: 'none' };
    }

    // C5 — a pleasantry that IS the whole message.
    const st = signals.smallTalk;
    const pleasantry = Boolean(st && st.coversWholeMessage && st.type !== 'frustration' && st.type !== 'human_request' && policy.replyToGreetings);
    rule('C5_SMALL_TALK', pleasantry, st ? `small_talk:${st.type}, wholeMessage=${st.coversWholeMessage}` : 'no small talk');
    if (pleasantry) {
        return { ...base, route: ROUTES.SMALL_TALK, smallTalk: st.type, turn: prev?.turnCount || 0, reads: { customerName: st.type === 'greeting' && policy.rememberName } };
    }

    // C6 — a problem to diagnose (the default).
    rule('C6_DIAGNOSTIC', true, 'diagnose the message');
    return { ...base, route: ROUTES.DIAGNOSTIC, diagnose: true, acknowledge: acknowledgementFor(signals, policy) };
}

// ===================================================================
// focusFor — what the customer has moved on from
// ===================================================================

const isGeneric = (token) => /generic/.test(token);

/**
 * Scenarios to rank WITHOUT this turn (Layer 4's `excludeIds`).
 *
 * A scenario the customer declined, was answered on, said was solved, or
 * whose ticket question the message superseded is not pursued when this
 * message is about something else — its tokens are nowhere in it. Restating
 * the same problem keeps it (audit D3, D4, E2, I3, C5; G-L5-3, G-L5-6,
 * G-L5-14). On a "that worked" turn every answered scenario is closed.
 *
 * @param {Object} params
 * @param {Object} params.plan
 * @param {Object|null} params.prev
 * @param {Object} params.ranking - Layer 4's unfocused ranking
 * @param {string[]} params.turnTokens - this turn's canonical tokens
 * @param {Object} params.signals
 * @returns {{excludeIds: string[], closedCategories: string[]}}
 */
export function focusFor({ plan, prev, ranking, turnTokens, signals }) {
    if (plan.freshEpisode) return { excludeIds: [], closedCategories: [] };
    const ds = prev?.decisionState || {};
    const byId = new Map((ranking?.ranked || []).map((e) => [e.hypothesis.scenarioId, e.scenario]));
    if (plan.close?.mode === 'check') {
        // The solved problems, and their variants: a candidate in the same
        // category as a solved one is the same problem, not another one.
        // A problem already with the team (its ticket is on file) or whose
        // ticket the customer declined is not an open problem for the bot.
        const handedOver = [
            ...(ds.declinedScenarioIds || []),
            ...(isTicketOnFile(ds.ticket) && ds.ticket.scenarioId ? [ds.ticket.scenarioId] : [])
        ];
        const ids = [...new Set([...(plan.close.resolvedIds || []), ...(ds.resolvedScenarioIds || []), ...handedOver])];
        const closedCategories = [...new Set(ids.map((id) => byId.get(id)?.category).filter(Boolean))];
        const variants = [...byId].filter(([, sc]) => sc?.category && closedCategories.includes(sc.category)).map(([id]) => id);
        // And rivals that only the closed problems' own words support: a
        // remaining problem needs evidence of its own (G-L5-14).
        const explained = new Set(ids.flatMap((id) => (byId.get(id) ? [...scenarioTokens(byId.get(id))] : [])));
        const echoes = (ranking?.ranked || [])
            .filter((e) => !(e.hypothesis.supportingEvidenceTokens || []).some((t) => !isGeneric(t) && !explained.has(t)))
            .map((e) => e.hypothesis.scenarioId);
        return { excludeIds: [...new Set([...ids, ...variants, ...echoes])], closedCategories };
    }
    if (!signals.diagnosticContent) return { excludeIds: [], closedCategories: [] };
    const candidates = new Set([
        ...(ds.answeredScenarioIds || []), ...(ds.declinedScenarioIds || []), ...(ds.resolvedScenarioIds || []),
        ...(plan.prompt?.pending?.decision?.scenarioId ? [plan.prompt.pending.decision.scenarioId] : [])
    ]);
    const said = new Set((turnTokens || []).filter((t) => !isGeneric(t)));
    const excludeIds = [...candidates].filter((id) => {
        const scenario = byId.get(id);
        if (!scenario) return false;
        return ![...scenarioTokens(scenario)].some((t) => said.has(t));
    });
    return { excludeIds, closedCategories: [] };
}

/**
 * Another active problem remains after the answered ones are closed: a
 * candidate above activation, in a category other than the closed ones.
 */
export function remainingProblem(ranking, closedCategories, activationThreshold) {
    const top = ranking?.topHypothesis;
    if (!top || top.hypothesis.confidence < activationThreshold) return null;
    if (top.scenario?.category && closedCategories.includes(top.scenario.category)) return null;
    return top;
}

// ===================================================================
// decideTurn — the engine decision for the route
// ===================================================================

/**
 * What a ticket decision needs to know from Layer 7 before it is finalized:
 * whether a knowledge article answers it instead («يدوّر في المقالات قبل ما
 * يفتح تذكرة»), and whether the account already has an open ticket on the
 * subject («يدوّر في تذاكر العميل القديمة»).
 *
 * @returns {{article: boolean, lookupOpenTicket: boolean, openTicketCategory: (string|null)}}
 */
export function knowledgeNeeds({ plan, decided, decision, settings }) {
    const ticket = decision?.action === ACTIONS.CREATE_TICKET && plan.route !== ROUTES.ESCALATION;
    if (!ticket) return { article: false, lookupOpenTicket: false, openTicketCategory: null };
    return {
        article: Boolean(settings.articles_before_ticket) && settings.knowledge_use_articles !== false,
        lookupOpenTicket: Boolean(settings.search_past_tickets) && !isTicketOnFile(decided?.decisionState?.ticket),
        openTicketCategory: decision.ticketDraft?.category || null
    };
}

/** The decision state this turn decides from. */
function decidingState(plan, prev) {
    if (plan.freshEpisode) return createEmptyDecisionState();
    let ds = normalizeDecisionState(prev?.decisionState);
    // A superseded or dropped ticket question lapses: nothing was decided.
    if (plan.prompt && ds.ticket.state === TICKET_STATES.PROPOSED) ds = withTicket(ds, transitionTicket(ds.ticket, 'lapse'));
    return ds;
}

/**
 * @param {Object} params
 * @param {Object} params.plan
 * @param {Object|null} params.prev
 * @param {Object|null} params.ranking - focused ranking (null when not diagnosed)
 * @param {Array} [params.hypotheses]
 * @param {number} params.newEvidenceAddedThisTurn
 * @param {Object} params.decisionPolicy - decide()'s policy
 * @param {Object} params.signals
 * @param {() => string} params.clock
 * @param {Object} [params.floor] - {scenarios, packIds, genericTokens, rankOptions}
 * @param {string[]} [params.closedCategories]
 * @param {string[]} [params.movedOnFrom] - focusFor()'s excludeIds
 * @returns {{decision: Object|null, decisionState: Object, progress: Object, floored: Object|null, closing: (null|'close'|'continue')}}
 */
export function decideTurn({ plan, prev, ranking, hypotheses = [], newEvidenceAddedThisTurn = 0, decisionPolicy = {}, signals, clock, floor = {}, closedCategories = [], movedOnFrom = [] }) {
    const turn = plan.turn;
    const ds = decidingState(plan, prev);
    const keepProgress = { consecutiveNoNewEvidenceTurns: ds.consecutiveNoNewEvidenceTurns };

    if (plan.route === ROUTES.ESCALATION) {
        const decision = escalationDecision({ plan, ranking, turn, decisionPolicy, clock });
        return { decision, decisionState: recordDecision(ds, decision, ds.consecutiveNoNewEvidenceTurns), priorState: ds, progress: keepProgress, floored: null, closing: null };
    }
    if (plan.route !== ROUTES.DIAGNOSTIC && plan.route !== ROUTES.RESOLUTION) {
        return { decision: null, decisionState: ds, priorState: ds, progress: keepProgress, floored: null, closing: null };
    }

    let from = ds;
    let closing = null;
    if (plan.close?.mode === 'check') {
        const remains = remainingProblem(ranking, closedCategories, decisionPolicy.activationThreshold ?? 0);
        const resolvedScenarioIds = [...new Set([...(ds.resolvedScenarioIds || []), ...(plan.close.resolvedIds || [])])];
        if (!remains) {
            const decision = {
                action: ACTIONS.COMPLETE, scenarioId: ds.lastScenarioId ?? null, scenarioLabel: null, confidence: null,
                explanation: 'The customer said the answered problem is solved and no other active problem remains; closing the conversation.',
                evaluatedRules: [{ rule: 'C4_CLOSE', matched: true, detail: `resolved=[${plan.close.resolvedIds.join(',')}], no other candidate above activation` }],
                timestamp: clock(), targetQuestion: null, resolution: null, ticketDraft: null, turn: 0, attemptNumber: null, hedged: false
            };
            return { decision, decisionState: ds, priorState: ds, progress: keepProgress, floored: null, closing: 'close' };
        }
        // Continue with the other problem: the answered one is closed, and the
        // turn decides afresh about what remains (G-L5-14).
        from = { ...ds, lastAction: null, lastScenarioId: null, resolvedScenarioIds, followUpsAfterAnswer: 0 };
        closing = 'continue';
    }

    // The customer moved on from the problem the bookkeeping is about: the
    // evidence request, account-details request and verification that were
    // spent on it are not spent on the new one (audit D4, E2).
    if (from.lastScenarioId && movedOnFrom.includes(from.lastScenarioId)) {
        from = { ...from, supplementaryEvidenceRequested: false, accountDetailsRequested: false, verificationDone: false };
    }

    const customerSignal = plan.freshEpisode || closing ? null : signals.resolution;
    const decideWith = (r) => decide({ ranking: r, turn, previousDecisionState: from, newEvidenceAddedThisTurn, policy: decisionPolicy, customerSignal, clock });
    const first = decideWith(ranking);
    const { decision, decisionState, floored } = freeFloor({
        ...first, ranking, hypotheses, scenarios: floor.scenarios, packIds: floor.packIds,
        genericTokens: floor.genericTokens, rankOptions: floor.rankOptions, decideWith
    });
    return { decision, decisionState, priorState: from, progress: first.progress, floored, closing };
}

/** The ESCALATE_TO_HUMAN decision of an escalation turn, carrying the diagnosed problem. */
function escalationDecision({ plan, ranking, turn, decisionPolicy, clock }) {
    const top = ranking?.topHypothesis && ranking.topHypothesis.hypothesis.confidence > 0 ? ranking.topHypothesis : null;
    const explanation = {
        human_request: 'Customer explicitly asked to speak with a human agent; escalating immediately.',
        threat: 'Customer threatened legal action, a complaint, cancellation or a refund; escalating immediately.',
        frustration: 'Customer is angry or frustrated with context (a repeated negative turn, or an answer that did not work); escalating instead of continuing the diagnostic loop.'
    }[plan.escalation.reason];
    return {
        action: ACTIONS.ESCALATE_TO_HUMAN,
        scenarioId: top?.hypothesis.scenarioId ?? null,
        scenarioLabel: top?.scenario?.label ?? null,
        confidence: top?.hypothesis.confidence ?? null,
        explanation,
        evaluatedRules: [{ rule: 'C2_ESCALATE', matched: true, detail: plan.escalation.reason }],
        timestamp: clock(),
        targetQuestion: null,
        resolution: null,
        // G-L5-13: the ticket carries what was diagnosed, not an empty draft.
        ticketDraft: top ? buildTicketDraft(ranking, decisionPolicy) : { scenarioId: null, category: 'other', diagnosticTrail: [] },
        turn,
        attemptNumber: null,
        hedged: false,
        reason: plan.escalation.reason
    };
}

// ===================================================================
// finalizeTurn — the decision taken, its effects, the next state
// ===================================================================

/**
 * @param {Object} params
 * @param {Object} params.plan
 * @param {Object|null} params.prev
 * @param {Object} params.signals
 * @param {Object} params.policy - conversationPolicy()
 * @param {Object|null} params.decided - decideTurn()
 * @param {Object|null} params.decision - the decision after Knowledge composed it (L7)
 * @param {Object} [params.data] - L7 reads: {article, openTicket, storedFacts, recalledFacts, customerName}
 * @param {Object} params.envelope - the trust envelope (CP1)
 * @param {Object|null} params.diagnosticState - this turn's diagnostic state to persist (null = keep the previous)
 * @param {string} params.language
 * @param {number} params.nowMs
 * @param {string} params.customerText - what Layer 1 read (stored as lastCustomerText)
 * @returns {Object} the turn decision
 */
export function finalizeTurn({ plan, prev, signals, policy, decided, decision: composed, data = {}, envelope, diagnosticState, language, nowMs, customerText }) {
    const lang = language === 'en' ? 'en' : 'ar';
    const prevDs = normalizeDecisionState(prev?.decisionState);
    const rules = [...plan.rules];
    const stateBase = {
        ...(prev || {}),
        language: lang,
        lastCustomerText: String(customerText || '').slice(0, 500),
        lastEmotion: negativeTone(signals)
    };
    // Read-time flags and other layers' fields are not carried forward: the
    // Action layer stamps lastTurnAt, the shadow threads its own state.
    delete stateBase.contextExpired;
    delete stateBase.pendingTicketConfirmation;
    delete stateBase.lastTurnAt;
    delete stateBase.shadowState;
    const out = (fields) => ({
        route: plan.route,
        effects: { pre: [], commit: { type: 'persist_reply' }, post: [] },
        acknowledge: null,
        ...fields,
        evaluatedRules: rules
    });

    // ── C1: the answer to a pending ticket question ──────────────────
    if (plan.route === ROUTES.PENDING) {
        const { answer, pending } = plan.prompt;
        const pendingDecision = pending.decision || {};
        const kind = pending.kind || (pendingDecision.action === ACTIONS.ESCALATE_TO_HUMAN ? 'escalation' : 'ticket');
        const intentBase = { route: ROUTES.PENDING, answer, scenarioId: pendingDecision.scenarioId ?? null, turn: pendingDecision.turn ?? prev?.turnCount ?? 0 };

        if (answer === 'reask') {
            return out({
                intent: { action: ACTIONS.WAIT_FOR_USER, ...intentBase, pendingAction: pendingDecision.action ?? null, evaluatedRules: rules },
                reply: { template: 'ticket_question' },
                commitDecision: { action: ACTIONS.WAIT_FOR_USER, turn: intentBase.turn },
                nextSie: { ...stateBase, pendingTicketConfirmation: { ...pending, reasks: (pending.reasks || 0) + 1 } }
            });
        }
        if (answer === 'no') {
            const ticket = transitionTicket(prevDs.ticket, 'decline', { scenarioId: pendingDecision.scenarioId ?? null });
            const declinedScenarioIds = pendingDecision.scenarioId
                ? [...new Set([...prevDs.declinedScenarioIds, pendingDecision.scenarioId])]
                : prevDs.declinedScenarioIds;
            return out({
                intent: { action: ACTIONS.WAIT_FOR_USER, ...intentBase, pendingAction: pendingDecision.action ?? null, evaluatedRules: rules },
                reply: { template: 'ticket_declined' },
                effects: {
                    // «رفض التذكرة مش رفض المساعدة»: the conversation still reaches a person.
                    pre: [{ type: 'queue_review', turn: intentBase.turn, scenarioId: pendingDecision.scenarioId ?? null, note: pendingDecision.explanation ?? '' }],
                    commit: { type: 'persist_reply' },
                    post: kind === 'escalation' ? [{ type: 'request_handoff', reason: 'escalation_ticket_declined' }] : []
                },
                commitDecision: { action: ACTIONS.WAIT_FOR_USER, turn: intentBase.turn },
                nextSie: { ...stateBase, decisionState: withTicket({ ...prevDs, declinedScenarioIds }, ticket) }
            });
        }
        // yes
        const intent = { ...pendingDecision, ...intentBase, evaluatedRules: [...rules, ...(pendingDecision.evaluatedRules || [])] };
        const finalized = finalizeTicket({
            decision: { ...pendingDecision, turn: intentBase.turn }, ds: prevDs, envelope, policy, data,
            confirmed: true, kind, lang, nowMs, rules
        });
        return out({ ...finalized, intent: finalized.intent ? { ...intent, ...finalized.intent } : intent, nextSie: { ...stateBase, ...finalized.sieFields } });
    }

    // ── C3: memory ───────────────────────────────────────────────────
    if (plan.route === ROUTES.MEMORY) {
        const memory = plan.memory;
        const intent = { action: ACTIONS.WAIT_FOR_USER, route: ROUTES.MEMORY, memory: memory.kind, scenarioId: null, turn: plan.turn, evaluatedRules: rules };
        const sie = { ...stateBase };
        if (memory.kind === 'forget') {
            return out({ intent, reply: { template: 'memory_forgotten' }, effects: { pre: [{ type: 'forget_facts' }], commit: { type: 'persist_reply' }, post: [] }, commitDecision: { action: ACTIONS.WAIT_FOR_USER, turn: plan.turn }, nextSie: sie });
        }
        if (memory.kind === 'recall') {
            return out({ intent, reply: { template: 'memory_recalled', facts: data.recalledFacts || [] }, commitDecision: { action: ACTIONS.WAIT_FOR_USER, turn: plan.turn }, nextSie: sie });
        }
        // CP3 — a fact outlives the session, so it has its own authorization.
        const { facts: admitted, rejected } = admitFacts(memory.facts || [], envelope, {
            storedFacts: Object.fromEntries((data.storedFacts || []).map((f) => [f.key, f.value]))
        });
        rules.push({ rule: 'C3_FACT_ADMISSION', matched: true, detail: `admitted=${admitted.length}, refused=${rejected.length}${rejected.length ? ` (${rejected.map((r) => r.reason).join(', ')})` : ''}` });
        return out({
            intent: { ...intent, factsRefused: rejected.length },
            reply: { template: 'memory_saved', facts: admitted },
            effects: { pre: admitted.length ? [{ type: 'write_facts', facts: admitted }] : [], commit: { type: 'persist_reply' }, post: [] },
            commitDecision: { action: ACTIONS.WAIT_FOR_USER, turn: plan.turn },
            nextSie: sie
        });
    }

    // ── C5: small talk ───────────────────────────────────────────────
    if (plan.route === ROUTES.SMALL_TALK) {
        const greeting = plan.smallTalk === 'greeting';
        const lastIssue = greeting && policy.lastIssueInGreeting && prev?.contextExpired ? (prev.lastScenarioLabel || null) : null;
        return out({
            intent: { action: ACTIONS.WAIT_FOR_USER, route: ROUTES.SMALL_TALK, smallTalk: plan.smallTalk, scenarioId: null, turn: plan.turn, evaluatedRules: rules },
            reply: { template: 'small_talk', type: plan.smallTalk, name: greeting && policy.rememberName ? (data.customerName || null) : null, lastIssue },
            commitDecision: { action: ACTIONS.WAIT_FOR_USER, turn: plan.turn },
            nextSie: stateBase
        });
    }

    // ── C2, C4, C6: diagnosed routes ─────────────────────────────────
    const mayMutate = envelope?.mayMutateState !== false;
    const decision = composed || decided?.decision;
    const persistedDiagnostic = mayMutate ? (diagnosticState ?? prev?.diagnosticState ?? null) : (prev?.diagnosticState ?? null);
    const turn = plan.turn;
    // A quarantined turn does not move the conversation's decision state
    // beyond the turn counter (G-L5-8); its ticket outcome is still recorded.
    const baseDs = mayMutate ? decided.decisionState : decidingState(plan, prev);
    const sieFor = (ds, extra = {}) => ({
        ...stateBase,
        diagnosticState: persistedDiagnostic,
        decisionState: ds,
        turnCount: turn,
        lastScenarioLabel: decision?.scenarioLabel || prev?.lastScenarioLabel || null,
        ...extra
    });

    if (decided?.closing === 'close') {
        // «تم الحل» and nothing else is open: a clean slate.
        return out({
            intent: { ...decision, route: ROUTES.RESOLUTION, customerSignal: signals.resolution, evaluatedRules: [...rules, ...decision.evaluatedRules] },
            reply: { template: 'conversation_closed' },
            commitDecision: { action: ACTIONS.WAIT_FOR_USER, turn: 0 },
            nextSie: { turnCount: 0, language: lang, lastEmotion: null }
        });
    }

    const acknowledge = plan.acknowledge;
    const resolvedAck = plan.route === ROUTES.RESOLUTION;
    const intentRules = [...rules, ...(decision.evaluatedRules || [])];

    if (!TICKET_ACTIONS.has(decision.action)) {
        return out({
            intent: { ...decision, route: plan.route, evaluatedRules: intentRules },
            reply: { template: 'decision', decision, acknowledge, resolvedAck },
            commitDecision: decision,
            nextSie: sieFor(mayMutate ? recordDecision(prevForRecord(plan, prev, decided), decision, decided.progress.consecutiveNoNewEvidenceTurns) : baseDs),
            decision
        });
    }

    // A ticket decision: the article rescue, the trust boundary, then the
    // ticket lifecycle — in that order, so nothing authorizes an action that
    // is later changed (CP3b after the rescue).
    let finalDecision = decision;
    if (decision.action === ACTIONS.CREATE_TICKET && data.article) {
        finalDecision = articleAnswer(decision, data.article);
        rules.push({ rule: 'C7_ARTICLE_BEFORE_TICKET', matched: true, detail: `knowledge entry "${data.article.key}" answers it` });
        return out({
            intent: { ...finalDecision, route: plan.route, evaluatedRules: [...intentRules, rules.at(-1)] },
            reply: { template: 'decision', decision: finalDecision, acknowledge, resolvedAck },
            commitDecision: finalDecision,
            nextSie: sieFor(mayMutate ? recordDecision(prevForRecord(plan, prev, decided), finalDecision, decided.progress.consecutiveNoNewEvidenceTurns) : baseDs),
            decision: finalDecision
        });
    }

    const kind = plan.route === ROUTES.ESCALATION ? 'escalation' : 'ticket';
    const finalized = finalizeTicket({
        decision, ds: baseDs, envelope, policy, data, confirmed: false, kind, lang, nowMs, rules,
        escalationPrefix: plan.route === ROUTES.ESCALATION ? plan.escalation.reason : null,
        engineEscalation: plan.route !== ROUTES.ESCALATION && decision.action === ACTIONS.ESCALATE_TO_HUMAN
    });
    return out({
        ...finalized,
        intent: { ...decision, ...(finalized.intent || {}), route: plan.route, evaluatedRules: [...intentRules, ...finalized.extraRules] },
        reply: { ...finalized.reply, acknowledge: plan.route === ROUTES.ESCALATION ? null : acknowledge, resolvedAck },
        nextSie: sieFor(finalized.sieFields.decisionState, finalized.sieFields.pendingTicketConfirmation ? { pendingTicketConfirmation: finalized.sieFields.pendingTicketConfirmation } : {})
    });
}

/** The decision state a diagnosed turn decided FROM, to record the final decision into. */
function prevForRecord(plan, prev, decided) {
    return decided.priorState || decidingState(plan, prev);
}

/** «يدوّر في المقالات قبل ما يفتح تذكرة»: the article answers instead. */
function articleAnswer(decision, article) {
    return {
        ...decision,
        action: ACTIONS.ANSWER,
        ticketDraft: null,
        resolution: { ...(article.resolution || {}), hasAutoResolution: true },
        knowledgeData: { source: article.key, data: { text: article.text } },
        explanation: `${decision.explanation} Knowledge base has an entry for "${article.key}", so answering from it instead of creating a ticket.`
    };
}

/**
 * The ticket lifecycle for a ticket decision (G-L5-1, G-L5-3, G-L5-8).
 *
 *   a ticket on file          → "still open", nothing new (escalation: hand off)
 *   trust forbids the effect  → withheld, said honestly
 *   the account has one open  → existing (its number)
 *   tickets switched off      → unavailable
 *   not yet confirmed and the
 *   customer must be asked    → proposed + the question
 *   otherwise                 → create_ticket, with `created` committed in
 *                               the same transaction as the ticket
 */
function finalizeTicket({ decision, ds, envelope, policy, data, confirmed, kind, lang, nowMs, rules, escalationPrefix = null, engineEscalation = false }) {
    const extraRules = [];
    const rule = (name, detail) => { const r = { rule: name, matched: true, detail }; extraRules.push(r); rules.push(r); };
    const draft = decision.ticketDraft || null;
    const details = { scenarioId: draft?.scenarioId ?? decision.scenarioId ?? null, category: draft?.category ?? null };
    const handoff = (reason) => [{ type: 'request_handoff', reason }];
    const sie = (ticketDs, extra = {}) => ({ decisionState: ticketDs, ...extra });

    if (isTicketOnFile(ds.ticket) || decision.alreadyTicketed) {
        rule('T1_TICKET_ON_FILE', `ticket ${ds.ticket.state}${ds.ticket.ref ? ` #${ds.ticket.ref}` : ''}: no second ticket, no second question`);
        const reminder = { ...decision, ticketDraft: null, alreadyTicketed: true };
        // The account's own ticket is named by its number; only a ticket this
        // conversation created is "the ticket we opened" (G-L6-2).
        const reply = ds.ticket.state === TICKET_STATES.EXISTING && ds.ticket.ref != null
            ? { template: 'ticket_existing', ticketNumber: ds.ticket.ref, escalation: escalationPrefix }
            : { template: 'decision', decision: reminder, escalation: escalationPrefix };
        return {
            reply,
            commitDecision: { ...reminder, action: ACTIONS.WAIT_FOR_USER },
            effects: { pre: [], commit: { type: 'persist_reply' }, post: kind === 'escalation' || engineEscalation ? handoff(confirmed ? 'escalation_ticket_opened' : 'escalated_by_engine') : [] },
            sieFields: sie(ds), extraRules, decision: reminder
        };
    }

    // CP3b. Asking an escalation's ticket question is speech, not an effect:
    // the effect is gated on the turn that confirms it.
    const gate = confirmed || kind !== 'escalation';
    const { decision: authorized, downgraded } = gate ? admitAction(decision, envelope) : { decision, downgraded: false };
    if (downgraded) {
        rule('T2_TRUST_WITHHELD', authorized.explanation);
        const ticket = transitionTicket(ds.ticket, 'withhold', details);
        return {
            intent: { trustDowngradedFrom: authorized.trustDowngradedFrom },
            reply: { template: 'ticket_withheld' },
            commitDecision: { ...authorized, action: ACTIONS.WAIT_FOR_USER, ticketDraft: null },
            effects: { pre: [], commit: { type: 'persist_reply' }, post: [] },
            sieFields: sie(withTicket(ds, ticket)), extraRules, decision: authorized
        };
    }

    if (data.openTicket) {
        rule('T3_OPEN_TICKET_ON_ACCOUNT', `ticket #${data.openTicket.ticketNumber} is open on the account in this category`);
        const ticket = transitionTicket(ds.ticket, 'existing', { ...details, ref: data.openTicket.ticketNumber });
        return {
            reply: { template: 'ticket_existing', ticketNumber: data.openTicket.ticketNumber },
            commitDecision: { action: ACTIONS.WAIT_FOR_USER, turn: decision.turn },
            effects: { pre: [], commit: { type: 'persist_reply' }, post: [] },
            sieFields: sie(withTicket(ds, ticket)), extraRules, decision
        };
    }

    if (!policy.ticketsEnabled && !confirmed && kind !== 'escalation') {
        rule('T4_TICKETS_DISABLED', 'auto_ticket_enabled is off');
        const ticket = transitionTicket(ds.ticket, 'unavailable', details);
        return {
            reply: { template: 'tickets_disabled' },
            commitDecision: { action: ACTIONS.WAIT_FOR_USER, turn: decision.turn },
            effects: { pre: [], commit: { type: 'persist_reply' }, post: engineEscalation ? handoff('escalated_by_engine') : [] },
            sieFields: sie(withTicket(ds, ticket)), extraRules, decision
        };
    }

    // An escalation always asks first (a person is not a case file); an engine
    // ticket asks when the setting says so.
    if (!confirmed && (kind === 'escalation' || policy.askBeforeTicket)) {
        rule('T5_ASK_BEFORE_TICKET', kind === 'escalation' ? 'escalation: the customer chooses whether a ticket is opened' : 'ask_before_ticket is on');
        const ticket = transitionTicket(ds.ticket, 'propose', details);
        return {
            reply: { template: 'ticket_question', decision, escalation: escalationPrefix },
            commitDecision: { action: ACTIONS.WAIT_FOR_USER, turn: decision.turn },
            // The proposal renders what the decision would have said, kept as the trace's intended text.
            intendedDecision: decision,
            effects: { pre: [], commit: { type: 'persist_reply' }, post: engineEscalation ? handoff('escalated_by_engine') : [] },
            sieFields: sie(withTicket(ds, ticket), { pendingTicketConfirmation: openPrompt({ decision, language: lang, nowMs, policy }) }),
            extraRules, decision
        };
    }

    rule('T6_CREATE_TICKET', confirmed ? 'the customer confirmed' : 'ask_before_ticket is off');
    // `created` is written ONLY into the state committed together with the
    // ticket row (create_ticket_with_message_and_session_update).
    const committed = transitionTicket(ds.ticket, 'commit', { ...details, at: new Date(nowMs).toISOString() });
    return {
        reply: { template: 'decision', decision },
        commitDecision: decision,
        effects: {
            pre: [],
            commit: { type: 'create_ticket' },
            post: kind === 'escalation' ? handoff('escalation_ticket_opened') : (engineEscalation ? handoff('escalated_by_engine') : [])
        },
        sieFields: sie(withTicket(ds, committed)), extraRules, decision
    };
}

/** The legacy empty ticket, for callers that build a state from scratch. */
export { emptyTicket };
