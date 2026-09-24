/**
 * candidate-retrieval.js
 * ------------------------------------------------------------
 * Turns a message's token presences into the small set of scenarios that
 * could possibly score above zero, with their exact confidences.
 *
 * ------------------------------------------------------------
 * THE CONTRACT
 *
 * For any message and any catalog, the set returned here — scored with the
 * confidences returned here — ranks identically to scoring every scenario in
 * the catalog. Not approximately: identically. The derivation is in
 * scenario-index.js; `equivalence.test.mjs` checks it against the real
 * catalog and against randomly generated ones.
 *
 * The one place that contract is deliberately relaxed is `limit`, and it is
 * relaxed in a way that cannot change an answer: candidates are scored
 * exactly first and truncated after, so a limit of K returns the true top K.
 * It changes what the caller SEES, never what the engine would have concluded
 * about anything it still sees.
 */
import { buildScenarioIndex, specificity } from './scenario-index.js';

/**
 * @typedef {Object} Candidate
 * @property {Object} scenario
 * @property {number} index       position in the catalog array
 * @property {number} confidence  exact, identical to a full-catalog scan
 *
 * @typedef {Object} RetrievalResult
 * @property {Candidate[]} candidates  descending by confidence, ties by scenario id
 * @property {number} scanned          posting entries touched — the real cost
 * @property {number} considered       scenarios that scored above zero
 * @property {number} catalogSize      what a full scan would have touched
 */

/**
 * @param {Array|import('./scenario-index.js').ScenarioIndex} catalogOrIndex
 * @param {Map<string, number>} tokenPresences  from getAllTokenPresences()
 * @param {Object} [options]
 * @param {number} [options.limit=Infinity]      keep only the top K
 * @param {number} [options.minConfidence=0]     drop candidates at or below this
 * @returns {RetrievalResult}
 */
export function retrieveCandidates(catalogOrIndex, tokenPresences, options = {}) {
    const index = Array.isArray(catalogOrIndex) ? buildScenarioIndex(catalogOrIndex) : catalogOrIndex;
    const { limit = Infinity, minConfidence = 0 } = options;

    if (!tokenPresences || tokenPresences.size === 0) {
        return { candidates: [], scanned: 0, considered: 0, catalogSize: index.size };
    }

    // Numerators accumulate in a Map rather than an array over the catalog.
    // At 100,000 scenarios a Float64Array accumulator would mean allocating
    // and zeroing 800 KB per message — work proportional to the catalog, which
    // is the exact cost this module exists to remove.
    const numerator = new Map();
    let scanned = 0;

    // Most-specific tokens first. It does not change the result — addition
    // commutes — but it front-loads the short posting lists, so a caller that
    // bounds work with `maxScanned` spends its budget on the informative
    // tokens instead of on whichever happened to be typed first.
    const tokens = [...tokenPresences.keys()]
        .filter((t) => index.postings.has(t))
        .sort((a, b) => specificity(index, b) - specificity(index, a));

    for (const token of tokens) {
        const presence = tokenPresences.get(token);
        if (!presence) continue;
        const { ids, weights } = index.postings.get(token);
        scanned += ids.length;
        for (let k = 0; k < ids.length; k++) {
            const id = ids[k];
            numerator.set(id, (numerator.get(id) || 0) + presence * weights[k]);
        }
    }

    // `numerator` is keyed by signature ROW. A scenario's confidence is the
    // best of its rows — the maximum computeScenarioConfidence takes — so the
    // rows are reduced per scenario before anything is filtered or sorted.
    const bestByScenario = new Map();
    for (const [row, sum] of numerator) {
        const total = index.totalWeight[row];
        if (!total) continue;
        const confidence = sum / total;
        const id = index.rowScenario ? index.rowScenario[row] : row;
        const prior = bestByScenario.get(id);
        if (prior === undefined || confidence > prior) bestByScenario.set(id, confidence);
    }

    const candidates = [];
    for (const [id, confidence] of bestByScenario) {
        if (confidence <= minConfidence) continue;
        candidates.push({ scenario: index.scenarios[id], index: id, confidence });
    }

    // Same ordering the ranking engine uses, including its id tie-break, so a
    // caller swapping a full scan for this sees the same list in the same
    // order rather than a stable-sort coincidence.
    candidates.sort((a, b) => (b.confidence - a.confidence) ||
        String(a.scenario?.id).localeCompare(String(b.scenario?.id)));

    const considered = candidates.length;
    return {
        candidates: Number.isFinite(limit) ? candidates.slice(0, limit) : candidates,
        scanned,
        considered,
        catalogSize: index.size
    };
}

/**
 * The candidate scenarios alone, for callers that want to hand a reduced
 * catalog to the existing hypothesis tracker rather than adopt these
 * confidences directly. Keeping ONE scoring implementation in production is
 * worth the recomputation: it means the equivalence claim is about which
 * scenarios get scored, not about two formulas staying in step.
 *
 * @returns {Array} scenario objects, in retrieval order
 */
export function retrieveScenarios(catalogOrIndex, tokenPresences, options) {
    return retrieveCandidates(catalogOrIndex, tokenPresences, options).candidates.map((c) => c.scenario);
}
