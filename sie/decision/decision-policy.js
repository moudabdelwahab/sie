/**
 * decision-policy.js
 * ------------------------------------------------------------
 * All tunable thresholds for the Decision Engine, kept separate from
 * decision-engine.js's control flow so policy can be adjusted without
 * touching the logic that applies it — same separation-of-concerns
 * reasoning as hypothesis-tracker's ACTIVATION_THRESHOLD/
 * REJECTION_THRESHOLD and ranking-engine's AMBIGUITY_MARGIN.
 */

import { ACTIVATION_THRESHOLD } from '../diagnostics/hypothesis-tracker.js';

/** Confidence a leading hypothesis needs to be treated as "confirmed enough" to answer/ticket. */
export const RESOLUTION_CONFIDENCE_THRESHOLD = 0.6;

/**
 * How many scenarios may simultaneously clear the resolution threshold and
 * still allow an automatic answer. `Infinity` — OFF by default.
 *
 * WHY THE KNOB EXISTS. Confidence here is a coverage ratio over a scenario's
 * signature: the fraction of its expected tokens that have been seen. It says
 * nothing about how MUCH evidence produced that fraction, so one token can
 * satisfy a thin signature completely. Measured against the shipped catalog,
 * 465 of 650 scenarios (71.5%) reach 0.6 from a single token, and the token
 * `intent_how_to` alone lifts 11 of them over the bar at once. When that
 * happens the leader is chosen by which signature weights that token highest
 * — by how the catalog was written, not by what the customer said — and
 * `isAmbiguous` reports false, because it measures the top-two gap rather
 * than the distribution.
 *
 * WHY IT IS OFF. Counting simultaneous resolvables looked like a cheap proxy
 * for "does this evidence discriminate". It is not, and the measurement says
 * so plainly: over the 345-message reference corpus the legitimate maximum is
 * 11, reached by "عايز اعرف عن منصه ازاي بتشتغل" ("how does the platform
 * work?") — the same 11 an attacker reaches with one chosen token. The
 * populations overlap exactly. Any cap that blocks the probe also stops the
 * engine answering a reasonable question, and a cap set above the probe
 * blocks nothing.
 *
 * Setting this to 6 preserves 98.1% of the corpus's automatic resolutions and
 * costs the platform-info flow. That is a product trade-off for an operator
 * to make deliberately, not a default to ship.
 *
 * The real fix is not a threshold. It is signatures with enough facets to
 * discriminate, so that confidence reflects evidence rather than catalog
 * authorship — see SIE-ARCHITECTURE.md.
 */
export const MAX_SIMULTANEOUS_RESOLVABLE = Infinity;

/** Hard cap on clarifying questions per session before forcing escalation. */
export const MAX_CLARIFYING_QUESTIONS = 3;

/** Hard cap on turns in a session before forcing escalation, regardless of confidence. */
export const MAX_TURNS_BEFORE_ESCALATION = 6;

/** Consecutive turns with zero new evidence (and no prior ANSWER) before giving up with FALLBACK. */
export const MAX_NO_PROGRESS_TURNS = 2;

/**
 * Which "please give us more to work with" action fits a scenario's
 * category best, used once per session before creating a ticket for a
 * confidently-diagnosed-but-not-auto-resolvable scenario. Deliberately
 * driven by category (a small, stable set) rather than per-scenario, so
 * new scenarios automatically get sensible behavior without needing to
 * declare this themselves.
 */
export const EVIDENCE_REQUEST_ACTION_BY_CATEGORY = Object.freeze({
    api: 'ASK_FOR_LOGS',
    subscription: 'ASK_FOR_ATTACHMENT',
    whatsapp: 'ASK_FOR_SCREENSHOT',
    login: 'ASK_FOR_SCREENSHOT',
    other: 'ASK_FOR_SCREENSHOT'
});

/** Fallback evidence-request action for any category not listed above. */
export const DEFAULT_EVIDENCE_REQUEST_ACTION = 'ASK_FOR_ATTACHMENT';

/**
 * How far below the resolution threshold a leading hypothesis may sit and
 * still be offered as a hedged "most likely" answer, when smart guessing is
 * switched on. Narrow on purpose: guessing is a last resort before a
 * hand-off, not a second answering mode.
 */
export const SMART_GUESS_MARGIN = 0.15;

/**
 * The constants above are what the engine does when nobody has configured
 * anything. This turns an operator's settings into the same shape, so
 * decideAction() reads one object and never asks where a number came from.
 *
 * Every field defaults to its module constant, which is what makes
 * `decide()` with no policy behave exactly as it did before policy existed
 * — the property every caller and every existing test depends on.
 *
 * @param {Object} [policy]
 * @returns {{
 *   activationThreshold: number,
 *   resolutionConfidenceThreshold: number,
 *   maxClarifyingQuestions: number,
 *   maxTurnsBeforeEscalation: number,
 *   maxNoProgressTurns: number,
 *   allowAutoResolution: boolean,
 *   allowScenarioAnswers: boolean,
 *   allowEvidenceRequests: boolean,
 *   ticketOnAmbiguity: boolean,
 *   smartGuessMargin: number,
 *   includeTicketSummary: boolean,
 *   requireCompleteEvidence: boolean,
 *   maxSimultaneousResolvable: number
 * }}
 */
export function resolvePolicy(policy = {}) {
    const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
    // maxSimultaneousResolvable defaults to Infinity, which `num` would reject
    // as non-finite, so it reads the raw value and only falls back on absence.
    const cap = (value, fallback) => (typeof value === 'number' ? value : fallback);
    const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

    return {
        // Must match what the Ranking Engine used to pick candidates this
        // turn, or R5 and the ambiguity check disagree about which
        // hypotheses are even in the running.
        activationThreshold: num(policy.activationThreshold, ACTIVATION_THRESHOLD),
        resolutionConfidenceThreshold: num(policy.resolutionConfidenceThreshold, RESOLUTION_CONFIDENCE_THRESHOLD),
        maxClarifyingQuestions: num(policy.maxClarifyingQuestions, MAX_CLARIFYING_QUESTIONS),
        maxTurnsBeforeEscalation: num(policy.maxTurnsBeforeEscalation, MAX_TURNS_BEFORE_ESCALATION),
        maxNoProgressTurns: num(policy.maxNoProgressTurns, MAX_NO_PROGRESS_TURNS),
        allowAutoResolution: bool(policy.allowAutoResolution, true),
        allowScenarioAnswers: bool(policy.allowScenarioAnswers, true),
        allowEvidenceRequests: bool(policy.allowEvidenceRequests, true),
        ticketOnAmbiguity: bool(policy.ticketOnAmbiguity, true),
        // 0 disables guessing entirely, which is the default.
        smartGuessMargin: policy.allowSmartGuess ? num(policy.smartGuessMargin, SMART_GUESS_MARGIN) : 0,
        includeTicketSummary: bool(policy.includeTicketSummary, true),
        // «يعتمد على إيه في إجاباته». On, a scenario may be answered only
        // when every token in its signature has actually been seen — no
        // reaching a conclusion the customer never fully described.
        requireCompleteEvidence: bool(policy.requireCompleteEvidence, false),
        maxSimultaneousResolvable: cap(policy.maxSimultaneousResolvable, MAX_SIMULTANEOUS_RESOLVABLE)
    };
}
