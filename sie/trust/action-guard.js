/**
 * action-guard.js
 * ------------------------------------------------------------
 * CHECKPOINT 3b — authorizes effects that leave the engine.
 *
 * An ANSWER is words. A CREATE_TICKET is a row in someone's queue, an email,
 * and a human's attention. The engine treats both as "a Decision", which is
 * right for the decision model and wrong for the trust model, so the split is
 * made here rather than in the decision engine: the decision engine decides
 * what the CONVERSATION needs; this guard decides what the TURN has earned.
 *
 * Keeping the two apart matters for the audit trail. The decision engine's
 * `evaluatedRules` stays a faithful record of the diagnostic reasoning, with
 * no security conditions tangled into it, and the downgrade appears as its own
 * entry — so a trace reader can always see both what the engine concluded and
 * what it was permitted to do about it.
 */
import { ACTIONS } from '../decision/decision-types.js';
import { atOrAbove, TRUST_LEVELS } from './trust-types.js';

/**
 * Actions with an effect outside the conversation. Everything absent from this
 * set is speech, and speech is never gated: an untrusted turn still gets an
 * answer, because refusing to talk to a customer is its own kind of failure.
 */
const EXTERNAL_EFFECT = new Set([
    ACTIONS.CREATE_TICKET,
    ACTIONS.ESCALATE_TO_HUMAN
]);

/**
 * @param {Object} decision a Decision from the decision engine
 * @param {import('./trust-types.js').TrustEnvelope} envelope
 * @returns {{decision: Object, downgraded: boolean}}
 */
export function guardAction(decision, envelope) {
    if (!decision || !envelope) return { decision, downgraded: false };
    if (envelope.mayTriggerAction) return { decision, downgraded: false };
    if (!EXTERNAL_EFFECT.has(decision.action)) return { decision, downgraded: false };

    // Downgraded, not dropped. The customer still gets a reply; what they do
    // not get is a ticket opened on the strength of a turn that behaved like
    // an attempt to manufacture one. `ticketDraft` is cleared because the
    // Action Layer keys off its presence.
    return {
        decision: {
            ...decision,
            action: ACTIONS.WAIT_FOR_USER,
            ticketDraft: null,
            trustDowngradedFrom: decision.action,
            explanation: `Action "${decision.action}" withheld: ${envelope.rationale}`
        },
        downgraded: true
    };
}

/**
 * True when the envelope permits acting on durable state at all. Exposed so
 * callers outside this layer can ask the question without reading the
 * envelope's fields directly and drifting from the policy table.
 */
export function mayPersist(envelope) {
    return Boolean(envelope) && !atOrAbove(envelope.level, TRUST_LEVELS.QUARANTINED);
}
