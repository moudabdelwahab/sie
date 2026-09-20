/**
 * scenario-index.js
 * ------------------------------------------------------------
 * فهرس معكوس للسيناريوهات — the inverted index that decouples the cost of
 * answering one customer from the size of the catalog.
 *
 * ------------------------------------------------------------
 * THE PROBLEM, STATED AS A COST
 *
 * `updateHypotheses(scenarios, presences, ...)` walks EVERY scenario on EVERY
 * turn and computes a confidence for each. At 650 scenarios that is 650
 * signature evaluations per message and roughly 206 KB of hypothesis records
 * carried in session state. At 100,000 it is 100,000 evaluations and a state
 * object no session store will accept.
 *
 * The work is almost entirely wasted. A customer message resolves to a handful
 * of tokens — p90 is 6 over the reference corpus — and a scenario whose
 * signature shares NO token with the message scores exactly zero.
 *
 * ------------------------------------------------------------
 * WHY THIS IS EXACT, NOT AN APPROXIMATION
 *
 * This matters more than the speed, so it is worth deriving rather than
 * asserting. Confidence is
 *
 *     confidence(s) = Σ_{t ∈ signature(s)} presence(t) · w(s,t)
 *                     ─────────────────────────────────────────
 *                          Σ_{t ∈ signature(s)} w(s,t)
 *
 * A token the message never produced has presence 0 and contributes nothing
 * to the numerator. So if a scenario's signature shares no token with the
 * message, its numerator is 0 and its confidence is 0 — necessarily, for every
 * message, with no tuning involved.
 *
 * Therefore: retrieving only the scenarios that share at least one token with
 * the message, and scoring those exactly, produces IDENTICAL confidences and
 * an IDENTICAL ranking to scanning the whole catalog. This is not a heuristic
 * trading accuracy for speed. It is the same computation with the provable
 * zeroes skipped, and `equivalence.test.mjs` checks that claim against the
 * real catalog rather than trusting the derivation.
 *
 * ------------------------------------------------------------
 * WHAT IT DOES NOT FIX, STATED UP FRONT
 *
 * Retrieval cost is Σ over the message's tokens of that token's posting-list
 * length. Posting lists for COMMON tokens grow with the catalog: `intent_how_to`
 * appears in 50 of 650 scenarios (7.7%), and if that proportion holds it
 * appears in 7,700 of 100,000. So a message made only of common tokens still
 * costs time linear in catalog size — a smaller constant, not a better
 * asymptote.
 *
 * That is why the index also carries IDF. A message's SPECIFIC tokens are both
 * the informative ones and the cheap ones, and `candidate-retrieval.js` uses
 * the ordering to bound work without discarding the exact result. The measured
 * behaviour at 650 / 1,000 / 3,500 / 10,000 / 100,000 is in bench/.
 *
 * ------------------------------------------------------------
 * CACHED ON THE ARRAY ITSELF
 *
 * Keyed in a WeakMap on the `scenarios` array, deliberately — the same pattern
 * the glossary derivation cache uses in normalizer.js, and for the same
 * reason. The index depends on nothing but the catalog, the resolver hands out
 * a new array whenever the catalog changes, and a WeakMap lets the old index
 * be collected with the old array. No invalidation logic, no staleness, no key
 * to get wrong.
 */

const INDEX_CACHE = new WeakMap();

/**
 * @typedef {Object} ScenarioIndex
 * @property {Array} scenarios            the catalog this index was built from
 * @property {Map<string, {ids: Int32Array, weights: Float64Array}>} postings
 *            token -> the scenarios using it, with that token's weight in each.
 *            Weights live in the posting list rather than being looked up in
 *            the catalog so that scoring a candidate touches one contiguous
 *            array instead of chasing an object graph per scenario.
 * @property {Map<string, number>} idf     token -> ln(N / df), specificity
 * @property {Float64Array} totalWeight    per scenario, Σ of its signature weights
 * @property {Map<string, Float64Array>} [_] not stored; weights are read from the catalog
 * @property {number} size                 number of scenarios
 * @property {number} vocabulary           number of distinct signature tokens
 * @property {number} postingsTotal        Σ posting-list lengths — the index's real size
 */

/**
 * Builds the inverted index for a catalog. Cached per array identity.
 *
 * @param {Array} scenarios
 * @returns {ScenarioIndex}
 */
export function buildScenarioIndex(scenarios) {
    if (!Array.isArray(scenarios)) throw new TypeError('buildScenarioIndex: scenarios must be an array');
    const cached = INDEX_CACHE.get(scenarios);
    if (cached) return cached;

    const postings = new Map();
    const totalWeight = new Float64Array(scenarios.length);
    let postingsTotal = 0;

    for (let i = 0; i < scenarios.length; i++) {
        const signature = scenarios[i]?.evidenceSignature;
        if (!Array.isArray(signature)) continue;
        let sum = 0;
        for (const entry of signature) {
            if (!entry || typeof entry.token !== 'string') continue;
            const weight = typeof entry.weight === 'number' ? entry.weight : 0;
            sum += weight;
            let list = postings.get(entry.token);
            if (!list) { list = { ids: [], weights: [] }; postings.set(entry.token, list); }
            // A token repeated inside one signature must not appear twice in
            // its posting list, or that scenario is scored twice. The
            // signature's own duplicate weight still counts toward the
            // denominator above, which is what the full-scan scorer does too.
            if (list.ids[list.ids.length - 1] !== i) {
                list.ids.push(i);
                list.weights.push(weight);
                postingsTotal += 1;
            } else {
                list.weights[list.weights.length - 1] += weight;
            }
        }
        totalWeight[i] = sum;
    }

    const n = scenarios.length || 1;
    const idf = new Map();
    for (const [token, list] of postings) {
        // ln(N / df). A token in every scenario scores 0 and is worthless for
        // discrimination; a token in one scores ln(N) and identifies it.
        idf.set(token, Math.log(n / list.ids.length));
        // Frozen into typed arrays once building is done: the lists never
        // change after this, and typed arrays halve the memory and keep the
        // scoring loop monomorphic.
        postings.set(token, { ids: Int32Array.from(list.ids), weights: Float64Array.from(list.weights) });
    }

    const index = {
        scenarios,
        postings,
        idf,
        totalWeight,
        size: scenarios.length,
        vocabulary: postings.size,
        postingsTotal
    };
    INDEX_CACHE.set(scenarios, index);
    return index;
}

/**
 * How specific a token is in this catalog — ln(N/df). Unknown tokens return
 * the maximum, because a token no scenario uses excludes everything, which is
 * the most specific outcome there is.
 *
 * @param {ScenarioIndex} index
 * @param {string} token
 * @returns {number}
 */
export function specificity(index, token) {
    const value = index.idf.get(token);
    return value === undefined ? Math.log(index.size || 1) : value;
}

/**
 * Index statistics, for benchmarks and for the architecture document. Exposed
 * because "how big is the index" is the question that decides whether this
 * approach survives at 100,000 scenarios, and it should be answerable without
 * reading the internals.
 *
 * @param {ScenarioIndex} index
 */
export function indexStats(index) {
    let longest = 0;
    let longestToken = null;
    for (const [token, list] of index.postings) {
        if (list.ids.length > longest) { longest = list.ids.length; longestToken = token; }
    }
    return {
        scenarios: index.size,
        vocabulary: index.vocabulary,
        postingsTotal: index.postingsTotal,
        averagePostingLength: index.vocabulary ? index.postingsTotal / index.vocabulary : 0,
        longestPostingLength: longest,
        longestPostingToken: longestToken,
        // The fraction of the catalog the most common token alone reaches.
        // This is the number that decides whether retrieval is sublinear in
        // practice or merely has a better constant.
        worstCaseFanout: index.size ? longest / index.size : 0
    };
}
