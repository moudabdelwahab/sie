/**
 * catalog-generator.mjs
 * ------------------------------------------------------------
 * Generates synthetic scenario catalogs for scalability measurement.
 *
 * ------------------------------------------------------------
 * WHY THIS IS NOT "MAKE 100,000 OBJECTS"
 *
 * A benchmark run against 100,000 scenarios whose signatures are
 * `tok_0..tok_99999`, one unique token each, would measure nothing. Every
 * message would retrieve exactly one candidate, the inverted index would look
 * miraculous, and the number reported would be a property of the generator
 * rather than of the engine.
 *
 * What makes retrieval expensive is SHARING: tokens that appear in many
 * signatures produce long posting lists, and long posting lists are the cost.
 * So the generator's job is to reproduce the sharing structure of the real
 * catalog at larger sizes, and to say so honestly when it cannot.
 *
 * Measured from sie/scenarios/scenario-catalog.data/scenarios.json (650):
 *
 *   vocabulary / scenarios   0.79   (516 tokens over 650 scenarios)
 *   signature size           2-4, median 3
 *   most common token        50 scenarios = 7.7% of the catalog
 *   weight distribution      small integers, one token usually dominant
 *
 * Token frequency follows a power law — a few tokens (`intent_how_to`,
 * `entity_agent`, `symptom_not_working`) in dozens of scenarios, a long tail in
 * one or two. Fitted from the shipped catalog, the log-log slope is 0.93 and
 * 55.4% of the vocabulary appears in exactly one scenario.
 *
 * ------------------------------------------------------------
 * WHY THE PROFILE IS CONSTRUCTED AND NOT SAMPLED
 *
 * The first version of this generator drew tokens from a Zipf sampler with
 * replacement. The exponent was right — 1.1 against a fitted 0.93 — and the
 * result was still wrong by a factor of six: the most common token landed in
 * 47% of the generated catalog against 7.7% in the real one.
 *
 * The reason is that a real catalog is AUTHORED, not sampled. A human writing
 * scenarios uses `intent_how_to` in as many as there are how-to questions and
 * then stops; nothing draws it again by chance. Sampling with replacement has
 * no such bound, so the head runs away while the fitted exponent still looks
 * correct. An exponent matching reality is not the same as a distribution
 * matching reality, and only the second one makes a benchmark meaningful.
 *
 * So the generator CONSTRUCTS the document-frequency profile — token of rank r
 * appears in exactly df(r) ∝ r^-a scenarios — and then realises it by dealing
 * a shuffled multiset into signatures. The exponent is auto-tuned per size so
 * the most common token reaches the same 7.7% fanout it has in the real
 * catalog. Sharing structure, not just sharing intensity, is preserved.
 *
 * ------------------------------------------------------------
 * COLLISIONS ARE REPORTED, NOT HIDDEN
 *
 * Two scenarios with identical signatures are indistinguishable to this
 * engine — no message can ever separate them, and the ranking tie-break picks
 * by scenario id. That is a real property of the design and it gets worse with
 * scale, so the generator counts collisions and returns the count instead of
 * silently retrying until they disappear. A catalog reported as "100,000
 * scenarios, 3.1% colliding" is a more useful benchmark input than a
 * collision-free one that could not exist.
 */

/** Deterministic PRNG. Benchmarks that cannot be reproduced are anecdotes. */
export function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Measured from the shipped catalog; see the header. */
export const REAL_SHAPE = Object.freeze({
    vocabularyRatio: 0.79,
    signatureSizes: [2, 3, 3, 3, 4],
    /** maxDf/N in the shipped catalog: 50 of 650. */
    maxFanout: 0.0769,
    /** Fitted log-log slope of the shipped catalog's df curve. */
    fittedExponent: 0.93,
    classes: ['intent', 'entity', 'symptom', 'social', 'emotion', 'behaviour', 'trigger', 'qualifier']
});

/** Fisher-Yates, seeded, so a catalog is reproducible from (count, seed). */
function shuffle(array, rand) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = array[i]; array[i] = array[j]; array[j] = t;
    }
    return array;
}

/**
 * Builds the document-frequency profile: how many scenarios each token appears
 * in, by rank. df(r) ∝ r^-exponent, scaled so the profile sums to exactly the
 * number of token slots the signatures need, with every token used at least
 * once.
 *
 * @returns {Int32Array} df by rank
 */
function frequencyProfile(vocabulary, slots, exponent) {
    const raw = new Float64Array(vocabulary);
    let total = 0;
    for (let r = 0; r < vocabulary; r++) { raw[r] = Math.pow(r + 1, -exponent); total += raw[r]; }

    const df = new Int32Array(vocabulary);
    let assigned = 0;
    for (let r = 0; r < vocabulary; r++) {
        df[r] = Math.max(1, Math.round((raw[r] / total) * slots));
        assigned += df[r];
    }

    // The floor of 1 on the tail pushes the sum over `slots`. Correct from the
    // head downward, which preserves the shape of the tail — the tail is where
    // the singletons live, and singletons are 55% of the real vocabulary.
    let r = 0;
    while (assigned > slots && r < vocabulary) {
        if (df[r] > 1) { df[r] -= 1; assigned -= 1; } else r += 1;
    }
    while (assigned < slots) { df[0] += 1; assigned += 1; }
    return df;
}

/**
 * Finds the exponent whose profile puts the most common token in
 * `targetFanout` of the catalog. Bisection over ~40 iterations: df(1) falls
 * monotonically as the exponent falls, so this converges without drama and
 * costs a few milliseconds even at 100,000.
 */
function tuneExponent(vocabulary, slots, count, targetFanout) {
    let lo = 0.05, hi = 3.0;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        const fanout = frequencyProfile(vocabulary, slots, mid)[0] / count;
        if (fanout > targetFanout) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
}

/**
 * @param {number} count how many scenarios
 * @param {Object} [options]
 * @param {number} [options.seed=1]
 * @param {number} [options.vocabulary] defaults to REAL_SHAPE.vocabularyRatio * count
 * @param {number} [options.zipfExponent]
 * @returns {{scenarios: Array, stats: Object}}
 */
export function generateCatalog(count, options = {}) {
    const {
        seed = 1,
        vocabulary = Math.max(8, Math.round(count * REAL_SHAPE.vocabularyRatio)),
        targetFanout = REAL_SHAPE.maxFanout,
        exponent: fixedExponent = null
    } = options;

    const rand = rng(seed);
    const classes = REAL_SHAPE.classes;

    const sizes = new Int32Array(count);
    let slots = 0;
    for (let i = 0; i < count; i++) {
        sizes[i] = REAL_SHAPE.signatureSizes[Math.floor(rand() * REAL_SHAPE.signatureSizes.length)];
        slots += sizes[i];
    }

    const exponent = fixedExponent ?? tuneExponent(vocabulary, slots, count, targetFanout);

    // A requested shape is not always realisable. Holding the head at 7.69%
    // of the catalog while the vocabulary is large relative to the catalog
    // forces a steep exponent, which flattens the tail to singletons and
    // concentrates draws on the head — so collisions rise even though the
    // vocabulary grew. Observed at V=16,000 / N=10,000: exponent 1.83 and a
    // 5.05% collision rate, against 0.06% at V=8,000.
    //
    // This is a real constraint, not a generator defect: a large vocabulary,
    // a small catalog, and a heavy head are mutually exclusive. The shipped
    // catalog sits at V/N = 0.79 and is nowhere near it. Flagged rather than
    // silently corrected, because a benchmark run in that regime is measuring
    // the constraint rather than the engine.
    const shapeWarning = Math.abs(exponent - REAL_SHAPE.fittedExponent) > 0.6
        ? `exponent ${exponent.toFixed(2)} is far from the real catalog's ${REAL_SHAPE.fittedExponent}; `
          + `V/N=${(vocabulary / count).toFixed(2)} vs the real 0.79 — this shape may not be realisable`
        : null;
    const df = frequencyProfile(vocabulary, slots, exponent);

    // Token names carry a class prefix like the real ones, because the trust
    // layer's domain-spray sensor reads `entity_` prefixes and a benchmark
    // catalog without them would exercise a different code path.
    const names = new Array(vocabulary);
    for (let i = 0; i < vocabulary; i++) names[i] = `${classes[i % classes.length]}_v${i}`;

    // Deal the multiset. Each token appears exactly df times, so the profile
    // is realised precisely rather than in expectation.
    const pool = new Array(slots);
    let at = 0;
    for (let r = 0; r < vocabulary; r++) for (let k = 0; k < df[r]; k++) pool[at++] = r;
    shuffle(pool, rand);

    const scenarios = new Array(count);
    const seen = new Set();
    let collisions = 0;
    let cursor = 0;
    // Counted rather than swallowed: when the dealt pool runs out, the
    // remaining signatures are filled from the tail instead of from the
    // profile, and that is a departure from the requested distribution. A
    // benchmark input whose distribution quietly differs from the one asked
    // for is worse than no benchmark, so this number is reported.
    let filledFromTail = 0;

    for (let i = 0; i < count; i++) {
        const want = sizes[i];
        const ranks = [];
        // Draw `want` slots, skipping a token already in this signature by
        // swapping it further down the pool — which keeps the profile exact
        // instead of quietly dropping an occurrence.
        for (let taken = 0; taken < want && cursor < slots; ) {
            const r = pool[cursor];
            if (ranks.includes(r)) {
                const swap = cursor + 1 + Math.floor(rand() * Math.max(1, slots - cursor - 1));
                if (swap < slots && pool[swap] !== r) { pool[cursor] = pool[swap]; pool[swap] = r; continue; }
                cursor += 1; continue;
            }
            ranks.push(r); cursor += 1; taken += 1;
        }
        // Past the end of the pool the profile is exhausted. Fall back across
        // the whole tail half of the vocabulary rather than a fixed window —
        // a narrow window manufactures collisions that the catalog shape does
        // not actually imply, which showed up as a spurious 5% collision rate
        // at V=16,000 before this was widened.
        while (ranks.length < want) {
            const half = Math.max(1, vocabulary >> 1);
            const r = (vocabulary - 1) - Math.floor(rand() * half);
            if (!ranks.includes(r)) { ranks.push(r); filledFromTail += 1; }
        }

        // One dominant token, like the real catalog — which is precisely what
        // makes 71.5% of it single-token resolvable. Reproducing the flaw is
        // the point: a benchmark on a better-shaped catalog would overstate
        // how well the engine scales.
        const signature = ranks.map((r, k) => ({
            token: names[r],
            weight: k === 0 ? 3 + Math.floor(rand() * 2) : 1,
            source: 'text'
        }));

        const fingerprint = ranks.slice().sort((a, b) => a - b).join('|');
        if (seen.has(fingerprint)) collisions += 1; else seen.add(fingerprint);

        scenarios[i] = {
            id: `gen_${String(i).padStart(7, '0')}`,
            label: { ar: `سيناريو ${i}`, en: `Scenario ${i}` },
            category: classes[i % classes.length],
            evidenceSignature: signature,
            discriminatingQuestions: [],
            resolution: { hasAutoResolution: true, text: { ar: 'حل', en: 'fix' } },
            requiresTicketIfUnresolved: false
        };
    }

    // Posting-list statistics, computed here so a caller can see the sharing
    // structure without building an index.
    const observedDf = new Map();
    for (const s of scenarios) for (const e of s.evidenceSignature) observedDf.set(e.token, (observedDf.get(e.token) || 0) + 1);
    let maxDf = 0;
    for (const v of observedDf.values()) if (v > maxDf) maxDf = v;

    return {
        scenarios,
        stats: {
            count,
            vocabulary,
            distinctSignatures: seen.size,
            collisions,
            collisionRate: collisions / count,
            exponent,
            shapeWarning,
            filledFromTail,
            filledFromTailRate: filledFromTail / slots,
            tokensUsed: observedDf.size,
            maxDocumentFrequency: maxDf,
            maxFanout: maxDf / count
        }
    };
}
