/**
 * trust-boundary.js
 * ------------------------------------------------------------
 * الطبقة العاشرة — the trust boundary, as one importable thing.
 *
 * The layer is four checkpoints in four files because they defend four
 * different crossings and each deserves to be read on its own. This module is
 * the seam: it gives the rest of the engine ONE import and one vocabulary, so
 * that wiring the boundary in does not mean scattering knowledge of its
 * internals across the pipeline.
 *
 * ------------------------------------------------------------
 * THE SHAPE, AND WHY IT IS NOT A STAGE
 *
 * The obvious implementation is a tenth pipeline stage. That would have been
 * wrong, and specifically wrong in a way worth naming: a stage runs at one
 * point in time, and the crossings this layer defends do not happen at one
 * point in time. Evidence enters early; facts are written late; actions are
 * authorized later still; text is quoted on the way out. A single stage could
 * only guess about three of the four.
 *
 * So the layer is a boundary rather than a step — one classification, applied
 * at four moments:
 *
 *      normalize ─► extract ─► [CP1 admit] ─► accumulate ─► rank ─► decide
 *                                  │              ▲                   │
 *                             TrustEnvelope       │                   ▼
 *                                  ├──────────────┘            [CP3b action]
 *                                  ├──► [CP2 evidence budget]          │
 *                                  ├──► [CP3 fact writes]              ▼
 *                                  └──► [CP4 quoted text] ────► reply
 *
 * The envelope travels with the turn. Downstream code may narrow it and may
 * never widen it — see `escalate` in trust-types.js for why that invariant
 * holds by construction.
 *
 * ------------------------------------------------------------
 * DISABLED BY DEFAULT
 *
 * `enabled: false` is the default on purpose. This layer can refuse to act on
 * a customer's turn, which is a behaviour change with a cost when it is wrong,
 * and a security layer that ships silently switched on is one nobody has
 * measured. `observeOnly` is the intended first production posture: every
 * checkpoint runs and every verdict reaches the trace, but nothing is enforced
 * — which yields the false-positive rate on REAL traffic that the reference
 * corpus can only approximate.
 */
import { admitTurn } from './admission-control.js';
import { guardEvidence } from './evidence-guard.js';
import { guardFacts } from './fact-guard.js';
import { guardAction } from './action-guard.js';
import { neutralizeUserText, guardQuotedFacts } from './egress-guard.js';
import { trustedEnvelope, traceProjection, TRUST_LEVELS, atOrAbove } from './trust-types.js';

export { TRUST_LEVELS, atOrAbove, traceProjection, neutralizeUserText, guardQuotedFacts };

/**
 * @typedef {Object} TrustConfig
 * @property {boolean} [enabled=false]     run the boundary at all
 * @property {boolean} [observeOnly=false] classify and trace, enforce nothing
 */

/** @param {TrustConfig} [config] */
function resolveConfig(config) {
    return {
        enabled: Boolean(config?.enabled),
        observeOnly: Boolean(config?.observeOnly)
    };
}

/**
 * CP1. Classify the turn and open the envelope it carries.
 *
 * @param {Object} turn
 * @param {string} turn.rawText
 * @param {Array} [turn.evidence] this turn's extracted evidence, pre-accumulator
 * @param {TrustConfig} [config]
 * @returns {import('./trust-types.js').TrustEnvelope & {observed?: Object}}
 */
export function openTurn({ rawText, evidence = [] } = {}, config) {
    const { enabled, observeOnly } = resolveConfig(config);
    if (!enabled) return trustedEnvelope();

    const verdict = admitTurn({ rawText, evidence });
    if (!observeOnly) return verdict;

    // Observe-only: the customer gets the unconstrained path, and the verdict
    // rides along as `observed` so the trace records what WOULD have happened.
    // Keeping it on the envelope rather than in a side channel is what makes
    // shadow comparison a diff of two fields instead of a join across tables.
    return { ...trustedEnvelope(), observed: traceProjection(verdict) };
}

/** CP2. @see guardEvidence */
export function admitEvidence(evidence, envelope, context) {
    return guardEvidence(evidence, envelope, context);
}

/** CP3. @see guardFacts */
export function admitFacts(facts, envelope, context) {
    return guardFacts(facts, envelope, context);
}

/** CP3b. @see guardAction */
export function admitAction(decision, envelope) {
    return guardAction(decision, envelope);
}

/** CP4. @see neutralizeUserText */
export function admitQuotedText(text, options) {
    return neutralizeUserText(text, options);
}

/**
 * What belongs in the TraceEvent for this turn. Returns null for an
 * untripped turn so the trace does not grow a field that says "nothing
 * happened" on every row.
 */
export function trustTrace(envelope) {
    if (!envelope) return null;
    if (envelope.observed) return { enforced: null, observed: envelope.observed };
    if (envelope.level === TRUST_LEVELS.TRUSTED && envelope.signals.length === 0) return null;
    return { enforced: traceProjection(envelope), observed: null };
}
