/**
 * candidate-scope.js
 * ------------------------------------------------------------
 * نطاق المرشحين — which scenarios this turn will actually score.
 *
 * ------------------------------------------------------------
 * WHY THIS IS NOT JUST `retrieveScenarios()`
 *
 * Retrieval is exactly equivalent to a full scan **for scoring**: a scenario
 * sharing no token with the message has confidence 0, necessarily. That
 * derivation is sound and `sie/retrieval` proves it.
 *
 * It is NOT sufficient for the pipeline, and the gap is easy to miss because
 * it has nothing to do with scoring. Three places downstream read
 * `ranking.ranked` looking for a scenario **by id**, not by score:
 *
 *   1. `R2_COMPLETE_AFTER_ANSWER` looks up `prevState.lastScenarioId` to
 *      recover its label. The customer has just said "thanks, that worked" —
 *      which produces no evidence at all — so the scenario that was answered
 *      last turn scores zero this turn and retrieval correctly omits it. The
 *      lookup then returns undefined and the reply loses its label.
 *   2. `R6_AMBIGUITY` looks up the scenario a discriminating question belongs
 *      to. That one is safe — the question came from the thresholded
 *      candidates — but it is safe by coincidence, not by construction.
 *   3. `buildTicketDraft` takes `ranked.slice(0, 5)` as the diagnostic trail.
 *
 * So the rule is: **retrieval decides what to SCORE; it does not decide what
 * the turn may REFER TO.** Anything the conversation has already committed to
 * stays in scope regardless of this turn's evidence.
 *
 * That is the entire content of this module, and it is the difference between
 * a retrieval integration that is equivalent and one that quietly degrades
 * replies on exactly the turns where the customer is happy.
 *
 * ------------------------------------------------------------
 * THE UNION
 *
 *   retrieved    scenarios sharing a token with the accumulated evidence
 *   remembered   scenarios the diagnostic state is already tracking
 *                (hysteresis needs them: a scenario that fell to zero must
 *                 still be scored to become 'rejected' rather than vanish)
 *   referenced   scenarios the decision state names — last answered, all
 *                answered, and anything a pending question belongs to
 *
 * The union is small in practice: retrieval returns a handful, and a
 * conversation commits to one or two scenarios. `scopeStats()` reports the
 * sizes so a benchmark can show it stays small as the catalog grows.
 */
import { retrieveCandidates } from '../retrieval/candidate-retrieval.js';
import { buildScenarioIndex } from '../retrieval/scenario-index.js';

/**
 * @param {Object} params
 * @param {Array} params.scenarios            the full catalog
 * @param {Map<string,number>} params.tokenPresences
 * @param {Array} [params.previousHypotheses] the diagnostic state's hypotheses
 * @param {Object} [params.previousDecisionState]
 * @returns {{scenarios: Array, stats: Object}}
 */
export function scopeCandidates({ scenarios, tokenPresences, previousHypotheses = [], previousDecisionState = null }) {
    const index = buildScenarioIndex(scenarios);

    // `minConfidence: -1` keeps candidates scoring exactly 0. They share a
    // token but every occurrence was contradicted, and a scenario at 0 that
    // WAS active still has to be scored to transition to 'rejected'.
    const retrieval = retrieveCandidates(index, tokenPresences, { minConfidence: -1 });

    const byId = new Map();
    for (const c of retrieval.candidates) byId.set(c.scenario.id, c.scenario);
    const retrievedCount = byId.size;

    // Remembered: anything the diagnostic state already tracks. A hypothesis
    // that has been active carries hysteresis state that only survives if it
    // keeps being scored.
    let rememberedAdded = 0;
    for (const h of previousHypotheses) {
        if (!h || byId.has(h.scenarioId)) continue;
        if (!h.hasEverBeenActive && h.confidence === 0) continue;
        const scenario = findById(index, h.scenarioId);
        if (scenario) { byId.set(scenario.id, scenario); rememberedAdded += 1; }
    }

    // Referenced: anything the conversation has committed to. This is the set
    // that makes the integration safe rather than merely fast.
    let referencedAdded = 0;
    for (const id of referencedIds(previousDecisionState)) {
        if (byId.has(id)) continue;
        const scenario = findById(index, id);
        if (scenario) { byId.set(scenario.id, scenario); referencedAdded += 1; }
    }

    return {
        scenarios: [...byId.values()],
        stats: {
            catalogSize: scenarios.length,
            postingsScanned: retrieval.scanned,
            retrieved: retrievedCount,
            rememberedAdded,
            referencedAdded,
            total: byId.size
        }
    };
}

/** Every scenario id the decision state names. */
function referencedIds(decisionState) {
    if (!decisionState) return [];
    const ids = new Set();
    if (decisionState.lastScenarioId) ids.add(decisionState.lastScenarioId);
    for (const id of decisionState.answeredScenarioIds || []) ids.add(id);
    // A question already asked belongs to a scenario the next turn may answer
    // about, and question ids are `${scenarioId}:${questionId}` by convention.
    for (const asked of decisionState.askedQuestionIds || []) {
        if (typeof asked === 'string' && asked.includes(':')) ids.add(asked.slice(0, asked.indexOf(':')));
    }
    return [...ids];
}

/**
 * Catalog lookup by id, memoised on the index so a conversation that keeps
 * referring to the same scenario does not rescan the catalog every turn. At
 * 100,000 scenarios a linear `find` per referenced id per turn is exactly the
 * cost this whole layer exists to remove.
 */
function findById(index, id) {
    if (!index._byId) {
        const map = new Map();
        for (const s of index.scenarios) map.set(s.id, s);
        Object.defineProperty(index, '_byId', { value: map, enumerable: false });
    }
    return index._byId.get(id) || null;
}
