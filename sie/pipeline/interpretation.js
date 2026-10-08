/**
 * interpretation.js
 * ------------------------------------------------------------
 * مرحلة التفسير — what KIND of message is this?
 *
 * ------------------------------------------------------------
 * WHY THIS STAGE EXISTS, AND WHY IT IS NEW
 *
 * The nine-stage decomposition has no stage for the question every turn
 * actually asks first: *is this a problem to diagnose at all?*
 *
 * Because there is no stage for it, the answer is assembled in
 * `sie-chat-bridge.js` out of six conditionals with early returns, spread
 * across ~120 lines and interleaved with the I/O each one performs. The file
 * has 39 return points. That is not a criticism of how it was written — each
 * check was correct when it was added — but the shape has three costs that
 * compound:
 *
 *   1. The ORDER is invisible. Whether small talk is checked before or after
 *      the memory intent is a real behavioural decision, and it is currently
 *      expressed only as the order of statements in a long function.
 *   2. It cannot be tested without a Supabase double, because classification
 *      and effect are the same statement.
 *   3. It cannot be traced. A turn that exits at check 2 and a turn that
 *      reaches diagnosis are indistinguishable in the trace.
 *
 * This module answers the question and nothing else: it takes text and
 * context, and returns a KIND plus the annotations the caller needs. It reads
 * no database, writes no state, and performs no effect. The bridge keeps
 * every effect it already had; what it loses is the decision about which one
 * to perform.
 *
 * ------------------------------------------------------------
 * THE ORDER — owned by Layer 5 since WP4
 *
 * The routing rules (pending ticket question, escalation, memory, "that
 * worked" after an answer, small talk, diagnosis — in that order) live in
 * sie/decision/conversation-rules.js (planTurn), the one owner. This module
 * maps that plan onto TURN_KINDS for the comparator; it holds no rule of its
 * own, so the live engine and the shadow cannot route differently.
 *
 * Emotion is an ANNOTATION, not a kind: an angry customer describing a
 * specific problem is diagnosed (G-L5-11, G-L5-13).
 */
import { analyzeSignals } from '../language/signals.js';
import { planTurn, conversationPolicy, ROUTES } from '../decision/conversation-rules.js';
import { SIE_DEFAULT_SETTINGS } from '../config/settings-schema.js';

/** The kinds a turn can be. Exhaustive and mutually exclusive. */
export const TURN_KINDS = Object.freeze({
    PENDING_CONFIRMATION: 'pending_confirmation',
    ESCALATION: 'escalation',
    MEMORY: 'memory',
    RESOLUTION: 'resolution',
    SMALL_TALK: 'small_talk',
    DIAGNOSTIC: 'diagnostic'
});

const KIND_BY_ROUTE = Object.freeze({
    [ROUTES.PENDING]: TURN_KINDS.PENDING_CONFIRMATION,
    [ROUTES.ESCALATION]: TURN_KINDS.ESCALATION,
    [ROUTES.MEMORY]: TURN_KINDS.MEMORY,
    [ROUTES.RESOLUTION]: TURN_KINDS.RESOLUTION,
    [ROUTES.SMALL_TALK]: TURN_KINDS.SMALL_TALK,
    [ROUTES.DIAGNOSTIC]: TURN_KINDS.DIAGNOSTIC
});

/**
 * @typedef {Object} Interpretation
 * @property {string} kind              one of TURN_KINDS
 * @property {string|null} reason       why this kind, for the trace
 * @property {Object|null} emotion      annotation, independent of kind
 * @property {Object|null} smallTalk    the small-talk reading, when there was one
 * @property {Object|null} memoryIntent the memory reading, when kind is MEMORY
 * @property {string|null} resolutionSignal
 * @property {boolean} escalatesToHuman
 * @property {Object} plan              Layer 5's plan (conversation-rules.js)
 */

/**
 * The kind of turn — decided by Layer 5's planTurn(), the SAME rules the
 * live orchestrator runs (WP4). Before WP4 this function was a second copy of
 * the bridge's routing; now it is a projection of the one owner.
 *
 * @param {Object} params
 * @param {Object} [params.signals]   Layer 1's signals (what the pipeline passes)
 * @param {string} [params.text]      only when no signals are given (direct callers)
 * @param {Object} [params.previous]  previous SIE state
 * @param {Object} [params.settings]  engine settings
 * @param {string[]} [params.enabledEmotions]
 * @param {number} [params.nowMs]     the turn's clock (prompt expiry)
 * @returns {Interpretation}
 */
export function interpretTurn({ signals = null, text, previous = null, settings = {}, enabledEmotions = undefined, nowMs = Date.now() } = {}) {
    const read = signals || analyzeSignals({
        text: typeof text === 'string' ? text : '',
        previousText: previous?.lastCustomerText || '',
        emotionDetection: settings.emotion_detection !== false,
        enabledEmotions
    });
    // The pipeline is called with partial settings; the engine's defaults
    // apply where a setting is absent, as they do live.
    const policy = conversationPolicy({ ...SIE_DEFAULT_SETTINGS, ...settings });
    const plan = planTurn({ signals: read, prev: previous, policy, nowMs });
    const reason = plan.escalation?.reason
        ?? (plan.memory ? `memory:${plan.memory.kind}` : null)
        ?? (plan.smallTalk ? `small_talk:${plan.smallTalk}` : null)
        ?? (plan.prompt ? `ticket question: ${plan.prompt.answer}` : null)
        ?? (plan.close ? `resolution signal after an answer (${plan.close.mode})` : null);
    return {
        kind: KIND_BY_ROUTE[plan.route],
        reason,
        emotion: read.emotion,
        smallTalk: read.smallTalk,
        memoryIntent: plan.memory,
        resolutionSignal: read.resolution,
        escalatesToHuman: plan.route === ROUTES.ESCALATION,
        plan
    };
}

/** The compact projection for a TraceEvent. */
export function interpretationTrace(interpretation) {
    if (!interpretation) return null;
    return {
        kind: interpretation.kind,
        reason: interpretation.reason,
        emotion: interpretation.emotion?.type ?? null
    };
}
