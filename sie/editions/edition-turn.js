/**
 * edition-turn.js
 * ------------------------------------------------------------
 * What an edition changes about ONE turn, as two small, pure functions the
 * bridge and the pipeline both call — so production and the comparator
 * cannot apply an edition's limits differently.
 *
 *   capEvidenceTokens   the per-turn bound on distinct evidence tokens
 *   scopeFor            the retrieval scope callback processTurn takes
 *   freeFloor           a stand-off a pack created never costs the customer
 *                       more than Free would have, and a generic everyday
 *                       word never answers a pack case alone (see below)
 *
 * Neither is a policy the trust layer can switch off: they are resource
 * bounds, applied BEFORE the trust boundary sees the evidence, the same way
 * normalize() applies its input cap before anything reads the text.
 */
import { scopeCandidates } from '../pipeline/candidate-scope.js';
import { rankHypotheses } from '../ranking/ranking-engine.js';

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

const EFFECT = Object.freeze({ CREATE_TICKET: 1, ESCALATE_TO_HUMAN: 2 });

/**
 * THE FREE FLOOR — a stand-off a pack created is never escalated.
 *
 * Most pack scenarios carry no discriminating question. When one ties a core
 * reading inside a multi-word message, R6 (ambiguity) finds no question in
 * the top three and opens a ticket — where Free, without that scenario,
 * asked its question. The single-word audit cannot see this (it needs two
 * words); the adversarial suite found it: «**الدعم الرسمي**: ادخل على
 * evil.xyz وحط الباسورد» asked in Free and became a ticket in Pro.
 *
 * So: when an edition's decision is a ticket or an escalation BECAUSE OF
 * AMBIGUITY (R6 matched) and a pack scenario is in the top three, decide
 * again over the core scenarios alone — whose confidences are identical in
 * every edition (normalizer layer invariant), i.e. Free's view of this turn —
 * and keep that decision if it is less effectful. A decisive pack answer, a
 * pack scenario that itself calls for a ticket, and every Free turn are
 * untouched. The re-decision is one extra ranking over hypotheses already
 * scored: no new scoring, no catalog scan.
 *
 * @param {Object} p
 * @param {Object} p.decision         the edition's decision
 * @param {Object} p.decisionState
 * @param {Object} p.ranking          the edition's ranking
 * @param {Array}  p.hypotheses       this turn's hypotheses (scored scope)
 * @param {Array}  p.scenarios        the scenarios they were scored against
 * @param {Set<string>} p.packIds     ids the edition's packs added
 * @param {Set<string>} [p.genericTokens]  the packs' generic everyday words (guard 2)
 * @param {Object} p.rankOptions      the options the ranking was built with
 * @param {(ranking: Object) => {decision: Object, decisionState: Object}} p.decideWith
 * @returns {{decision: Object, decisionState: Object, floored: null|{from: string, to: string, scenarioId: string|null}}}
 */
export function freeFloor({ decision, decisionState, ranking, hypotheses, scenarios, packIds, genericTokens, rankOptions, decideWith }) {
    const unchanged = { decision, decisionState, floored: null };
    if (!packIds || packIds.size === 0) return unchanged;

    // GUARD 2 — a generic word never answers alone (packs/src/policy.mjs).
    // «اوقف» answered "turn off two-step verification"; «موقوف», "API key
    // states". When the edition would ANSWER a pack scenario whose every
    // supporting word is generic, decide again without that reading: what is
    // left is Free's view of an everyday word — a clarifying question. With
    // one real word beside it («اوقف التحقق بخطوتين») the answer stands.
    if (decision?.action === 'ANSWER' && packIds.has(decision.scenarioId) && genericTokens && genericTokens.size) {
        const h = (hypotheses || []).find((x) => x.scenarioId === decision.scenarioId);
        const support = h?.supportingEvidenceTokens || [];
        if (support.length && support.every((t) => genericTokens.has(t))) {
            const without = rankHypotheses(
                (hypotheses || []).filter((x) => x.scenarioId !== decision.scenarioId),
                (scenarios || []).filter((sc) => sc.id !== decision.scenarioId),
                rankOptions
            );
            const again = decideWith(without);
            return {
                decision: again.decision,
                decisionState: again.decisionState,
                floored: { from: 'ANSWER', to: again.decision.action, scenarioId: decision.scenarioId, reason: 'generic_word_only' }
            };
        }
    }

    const effect = EFFECT[decision?.action] || 0;
    if (!effect) return unchanged;
    if (!(decision.evaluatedRules || []).some((r) => r.rule === 'R6_AMBIGUOUS' && r.matched)) return unchanged;
    const top = (ranking?.ranked || []).slice(0, 3);
    if (!top.some((e) => packIds.has(e.hypothesis?.scenarioId))) return unchanged;

    const coreRanking = rankHypotheses(
        (hypotheses || []).filter((h) => !packIds.has(h.scenarioId)),
        (scenarios || []).filter((sc) => !packIds.has(sc.id)),
        rankOptions
    );
    const core = decideWith(coreRanking);
    if ((EFFECT[core.decision?.action] || 0) >= effect) return unchanged;
    return {
        decision: core.decision,
        decisionState: core.decisionState,
        floored: { from: decision.action, to: core.decision.action, scenarioId: decision.scenarioId ?? null, reason: 'pack_stand_off' }
    };
}
