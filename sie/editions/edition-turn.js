/**
 * edition-turn.js
 * ------------------------------------------------------------
 * What an edition changes about ONE turn, as two small, pure functions the
 * bridge and the pipeline both call — so production and the comparator
 * cannot apply an edition's limits differently.
 *
 *   capEvidenceTokens   the per-turn bound on distinct evidence tokens
 *   scopeFor            the retrieval scope callback processTurn takes
 *
 * Neither is a policy the trust layer can switch off: they are resource
 * bounds, applied BEFORE the trust boundary sees the evidence, the same way
 * normalize() applies its input cap before anything reads the text.
 */
import { scopeCandidates } from '../pipeline/candidate-scope.js';

/**
 * Keeps evidence for at most `max` distinct tokens, in arrival order.
 *
 * Every entry for a kept token is kept (repetition is handled by the
 * accumulator's own arithmetic, not here). A message cannot make scoring
 * cost more than `max` posting lists, whatever it contains.
 *
 * @param {Array} evidence
 * @param {number} max
 * @returns {{ evidence: Array, dropped: number }}
 */
export function capEvidenceTokens(evidence, max) {
    if (!Array.isArray(evidence) || !Number.isFinite(max) || max <= 0) return { evidence: evidence || [], dropped: 0 };
    const kept = new Set();
    const out = [];
    let dropped = 0;
    for (const e of evidence) {
        if (!kept.has(e.token)) {
            if (kept.size >= max) { dropped += 1; continue; }
            kept.add(e.token);
        }
        out.push(e);
    }
    return { evidence: out, dropped };
}

/**
 * The scope callback for diagnostic-engine.processTurn.
 *
 * @param {Object} params
 * @param {Object} [params.previousDecisionState]  names scenarios the turn may refer to
 * @param {number} [params.limit]                  the edition's retrieval breadth
 * @returns {Function}
 */
export function scopeFor({ previousDecisionState = null, limit = Infinity } = {}) {
    return ({ scenarios, tokenPresences, previousHypotheses }) =>
        scopeCandidates({ scenarios, tokenPresences, previousHypotheses, previousDecisionState, limit });
}
