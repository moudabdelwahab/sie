/**
 * ranking-engine.js
 * ------------------------------------------------------------
 * Turns the Diagnostic Engine's per-scenario hypotheses (already
 * confidence-scored — this module never re-scores anything) into a
 * cross-scenario ranking: an ordering, a measure of how close the top
 * contenders are, and which discriminating questions could help tell
 * them apart.
 *
 * This module makes no decisions (ask/resolve/escalate) and generates
 * no customer-facing text — that remains the Decision Engine's and
 * Dialogue Engine's job (later modules). It only answers: "given what
 * the Diagnostic Engine currently believes, how does that rank, and is
 * it currently ambiguous?"
 */
import { ACTIVATION_THRESHOLD } from '../diagnostics/hypothesis-tracker.js';
import { scenarioCatalogProvider } from '../scenarios/scenario-catalog.local.js';

/** How close two candidates' confidence must be to be considered "too close to call". */
export const AMBIGUITY_MARGIN = 0.1;

/**
 * «مستوى التشخيص» — قد إيه المحرك يفتح احتمالات كتير للمشكلة الواحدة.
 *
 * Diagnosis level is expressed as the bar a hypothesis must clear to be
 * treated as a real candidate at all. Raising it means fewer contenders,
 * fewer ambiguous stand-offs, and more hand-offs; lowering it means the
 * engine keeps weaker readings in play and asks more questions.
 *
 * `balanced` is exactly the module's own ACTIVATION_THRESHOLD, so the
 * default level is not a setting being applied — it is the engine
 * unchanged.
 */
export const DIAGNOSIS_LEVEL_THRESHOLDS = Object.freeze({
    strict: 0.30,
    balanced: ACTIVATION_THRESHOLD,
    broad: 0.08
});

/**
 * @param {string} [level]
 * @returns {number}
 */
export function activationThresholdForLevel(level) {
    return DIAGNOSIS_LEVEL_THRESHOLDS[level] ?? ACTIVATION_THRESHOLD;
}

/** How many top contenders to surface candidate discriminating questions for. */
export const MAX_CANDIDATE_QUESTIONS_SCENARIOS = 3;

/**
 * @typedef {Object} RankedEntry
 * @property {import('../diagnostics/evidence-types.js').Hypothesis} hypothesis
 * @property {import('../scenarios/scenario-types.js').Scenario|null} scenario
 * @property {number} rank - 1-based position in the ordering
 *
 * @typedef {Object} CandidateDiscriminatingQuestion
 * @property {string} scenarioId
 * @property {import('../scenarios/scenario-types.js').DiscriminatingQuestion} question
 *
 * @typedef {Object} RankingResult
 * @property {RankedEntry[]} ranked - all hypotheses, sorted descending by confidence
 * @property {RankedEntry|null} topHypothesis
 * @property {RankedEntry|null} runnerUp
 * @property {number|null} confidenceGap - gap between the top two CANDIDATES (confidence >= activation
 *   threshold); null if fewer than 2 candidates exist (nothing to compare)
 * @property {boolean} isAmbiguous - true when >=2 candidates are within AMBIGUITY_MARGIN of each other
 * @property {number} scopeSize - how many scenarios were scored this turn
 * @property {number} catalogSize - how many scenarios exist (see the field's own note)
 * @property {CandidateDiscriminatingQuestion[]} candidateDiscriminatingQuestions
 */

/**
 * Pure ranking function — no I/O, fully deterministic.
 *
 * @param {import('../diagnostics/evidence-types.js').Hypothesis[]} hypotheses
 * @param {import('../scenarios/scenario-types.js').Scenario[]} scenarios
 * @param {{activationThreshold?: number, catalogSize?: number}} [options] - omit for
 *   the module's own threshold, i.e. the behaviour this function has always had
 * @returns {RankingResult}
 */
export function rankHypotheses(hypotheses, scenarios, options = {}) {
    const activationThreshold =
        typeof options.activationThreshold === 'number' ? options.activationThreshold : ACTIVATION_THRESHOLD;
    const list = Array.isArray(hypotheses) ? hypotheses : [];
    const scenarioById = new Map((scenarios || []).map((s) => [s.id, s]));

    const sorted = [...list].sort(
        (a, b) => b.confidence - a.confidence || a.scenarioId.localeCompare(b.scenarioId)
    );

    const specificity = options.specificity !== false;

    // Only hypotheses that actually cleared the activation threshold count
    // as real candidates for ambiguity/comparison purposes — a leader at
    // 0.02 confidence with a "runner-up" at 0.01 isn't a meaningful
    // two-horse race, it's just noise.
    const isCandidate = (h) => h.confidence >= activationThreshold;

    const { order, subsumedIds } = specificity
        ? resolveSpecificity(sorted, isCandidate, (id) => scenarioById.get(id)?.catchAll !== true)
        : { order: sorted, subsumedIds: new Set() };

    const ranked = order.map((hypothesis, index) => ({
        hypothesis,
        scenario: scenarioById.get(hypothesis.scenarioId) || null,
        rank: index + 1
    }));

    const topHypothesis = ranked[0] || null;
    const runnerUp = ranked[1] || null;

    const candidates = ranked.filter((entry) => isCandidate(entry.hypothesis));

    // The contender the leader actually has to be separated from: the best
    // candidate it does NOT subsume. A candidate whose matched evidence is a
    // strict subset of the leader's is not a rival reading of the message —
    // it is a less complete reading of the same one. See resolveSpecificity.
    const rival = candidates.slice(1).find((entry) => !subsumedIds.has(entry.hypothesis.scenarioId)) || null;

    const confidenceGap =
        candidates.length >= 2 && rival ? candidates[0].hypothesis.confidence - rival.hypothesis.confidence : null;

    const isAmbiguous = confidenceGap !== null && confidenceGap < AMBIGUITY_MARGIN;

    const candidateDiscriminatingQuestions = buildCandidateDiscriminatingQuestions(
        candidates.slice(0, MAX_CANDIDATE_QUESTIONS_SCENARIOS)
    );

    return {
        ranked, topHypothesis, runnerUp, confidenceGap, isAmbiguous, candidateDiscriminatingQuestions,
        /** The candidate the gap was measured against (null when unopposed). */
        rival,
        /** Candidates set aside because the leader's evidence strictly contains theirs. */
        subsumedIds: [...subsumedIds],
        /**
         * How many scenarios were in SCOPE this turn — the ones actually
         * scored. Equals the catalog size under a full scan; equals the
         * retrieved candidate count under retrieval.
         */
        scopeSize: (scenarios || []).length,
        /**
         * How many scenarios EXIST. Defaults to the scope, which is correct
         * for a full scan; a caller that narrowed the scope must pass the real
         * catalog size.
         *
         * The two are the same number today and the distinction still has to
         * exist, because an empty ranking means opposite things depending on
         * which one is zero. Scope empty with a catalog behind it is a vague
         * message — ask for detail. Catalog empty is the engine being broken —
         * fall back. Collapsing them sent every message with no diagnostic
         * vocabulary to FALLBACK, which the comparator caught on real traffic.
         */
        catalogSize: typeof options.catalogSize === 'number' ? options.catalogSize : (scenarios || []).length
    };
}

/**
 * «الأدق يكسب» — the more complete explanation wins a near-tie.
 *
 * ------------------------------------------------------------
 * THE DEFECT THIS FIXES
 *
 * Confidence is a coverage ratio, so a scenario with a two-token signature
 * scores 1.0 the moment both tokens appear. A MORE specific scenario — the
 * same two tokens plus the one word that makes it a different case — also
 * scores at most 1.0. On exactly the messages that describe the specific
 * case, the two tie, `isAmbiguous` fires, and the engine asks a question
 * (or hands off) about a message it had every word it needed to answer.
 * The alphabetical tie-break then decides which one is even offered.
 *
 * That is the engine penalising detail, and it gets strictly worse as the
 * catalog grows: every specialised scenario added on top of a general one
 * turns a message the general one answered into an ambiguous one.
 *
 * ------------------------------------------------------------
 * THE RULE
 *
 * Among candidates, B is SUBSUMED by A when B's supporting evidence is a
 * strict subset of A's and A is within the ambiguity margin of B (or above
 * it). A then explains everything B explains plus something B cannot, so:
 *
 *   - A is preferred over B for the top position, and
 *   - B does not count as A's rival when measuring ambiguity.
 *
 * It is deliberately narrow:
 *   - Only CANDIDATES take part (≥ activation threshold). Noise cannot be
 *     promoted.
 *   - Only a STRICT subset counts. Two readings supported by different
 *     evidence are real rivals and stay ambiguous — that is what
 *     discriminating questions are for.
 *   - Only within the margin. A specific scenario far below a general one is
 *     missing its defining evidence, and does not jump the queue.
 *
 * Deterministic, and equivalent under retrieval: it reads only candidates,
 * which retrieval never drops.
 *
 * A scenario marked `catchAll` (the generic "unknown problem" bucket) is
 * never PROMOTED this way: matching several generic words makes it broader,
 * not more specific, and letting it climb over a named scenario on
 * "slow and not working" was the one regression this rule produced on the
 * behaviour corpus before the exemption existed. It can still be subsumed.
 *
 * @param {Array} sorted hypotheses sorted by (confidence desc, id asc)
 * @param {(h: object) => boolean} isCandidate
 * @param {(id: string) => boolean} [isPromotable]
 * @returns {{order: Array, subsumedIds: Set<string>}}
 */
function resolveSpecificity(sorted, isCandidate, isPromotable = () => true) {
    const candidates = [];
    for (const h of sorted) {
        if (!isCandidate(h)) break; // sorted by confidence: the rest are below too
        candidates.push(h);
    }
    if (candidates.length < 2) return { order: sorted, subsumedIds: new Set() };

    const supportOf = new Map(candidates.map((h) => [h.scenarioId, new Set(h.supportingEvidenceTokens || [])]));
    const strictlyContains = (outer, inner) => {
        if (outer.size <= inner.size) return false;
        for (const t of inner) if (!outer.has(t)) return false;
        return true;
    };

    // Climb from the confidence leader to the most complete reading within
    // the margin. Each step strictly grows the supporting set, so this ends.
    let top = candidates[0];
    for (;;) {
        const topSupport = supportOf.get(top.scenarioId);
        const better = candidates.find((c) =>
            c !== top &&
            isPromotable(c.scenarioId) &&
            c.confidence > top.confidence - AMBIGUITY_MARGIN &&
            strictlyContains(supportOf.get(c.scenarioId), topSupport));
        if (!better) break;
        top = better;
    }

    const topSupport = supportOf.get(top.scenarioId);
    const subsumedIds = new Set();
    for (const c of candidates) {
        if (c === top) continue;
        if (isPromotable(top.scenarioId) &&
            top.confidence > c.confidence - AMBIGUITY_MARGIN && strictlyContains(topSupport, supportOf.get(c.scenarioId))) {
            subsumedIds.add(c.scenarioId);
        }
    }
    if (top === sorted[0]) return { order: sorted, subsumedIds };
    return { order: [top, ...sorted.filter((h) => h !== top)], subsumedIds };
}

/**
 * For each of the given top-contender entries, finds which of its OWN
 * scenario-defined discriminating questions target evidence it's
 * currently missing. Surfaces options only — does not choose one.
 *
 * @param {RankedEntry[]} topEntries
 * @returns {CandidateDiscriminatingQuestion[]}
 */
function buildCandidateDiscriminatingQuestions(topEntries) {
    const result = [];
    for (const entry of topEntries) {
        if (!entry.scenario) continue;
        const missing = new Set(entry.hypothesis.missingEvidenceTokens || []);
        for (const question of entry.scenario.discriminatingQuestions || []) {
            const resolvesSomethingMissing = (question.resolvesEvidence || []).some((token) => missing.has(token));
            if (resolvesSomethingMissing) {
                result.push({ scenarioId: entry.scenario.id, question });
            }
        }
    }
    return result;
}

/**
 * Convenience async wrapper: fetches the scenario catalog via the given
 * provider (defaults to Module 2's real local-JSON provider) and ranks
 * the given DiagnosticState's hypotheses against it.
 *
 * @param {import('../diagnostics/evidence-types.js').DiagnosticState} state
 * @param {{getAllScenarios: Function}} [scenarioProvider]
 * @param {{activationThreshold?: number}} [options]
 * @returns {Promise<RankingResult>}
 */
export async function rankDiagnosticState(state, scenarioProvider = scenarioCatalogProvider, options = {}) {
    const scenarios = await scenarioProvider.getAllScenarios();
    return rankHypotheses(state?.hypotheses || [], scenarios, options);
}
