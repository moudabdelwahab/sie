/**
 * typo-tolerance.js
 * ------------------------------------------------------------
 * Levenshtein-based fuzzy token matching, tolerating small typing
 * mistakes. This is a direct reuse of the levenshtein/fuzzyWordMatch
 * logic already proven in chatbot-engine.js — the algorithm is
 * unchanged, only its position in the pipeline has moved: it now runs
 * on already-normalized tokens (post dialect/Arabizi normalization),
 * rather than on raw text, so it's comparing cleaner input than before.
 *
 * Since WP3 the normalizer uses it (transpositionDistance) to correct a
 * misspelled problem word to the glossary word it was meant to be — only
 * with the setting «language_typo_tolerance» on, only for words nothing
 * else resolved, and only towards a problem-describing canonical. The
 * guards, and the measurements that justify them, are documented next to
 * applyTypoTolerance in normalizer.js and tested in
 * tests/typo-integration.test.mjs (G-L1-9).
 */

/**
 * Simple Levenshtein (edit) distance between two strings.
 * Identical implementation to chatbot-engine.js.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = a[i - 1] === b[j - 1]
                ? prev[j - 1]
                : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
        }
        prev = cur;
    }
    return prev[b.length];
}

/**
 * Edit distance where swapping two adjacent letters costs one edit, not two
 * (optimal string alignment). «الباطقه» for «البطاقه» is one slip of the
 * finger, and Levenshtein counted it as two — enough to miss it on a
 * five-letter stem. Used by the normalizer's typo tolerance (WP3).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function transpositionDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
        }
    }
    return d[a.length][b.length];
}

/**
 * Whether `word` fuzzily matches `target`, tolerating small typos.
 * Identical thresholds/logic to chatbot-engine.js's fuzzyWordMatch.
 * @param {string} word
 * @param {string} target
 * @returns {boolean}
 */
export function fuzzyWordMatch(word, target) {
    if (word === target) return true;
    if (Math.abs(word.length - target.length) > 2) return false;
    const threshold = target.length >= 7 ? 2 : 1;
    return levenshtein(word, target) <= threshold;
}

/**
 * Finds the best fuzzy match for `word` among a list of candidate
 * canonical strings, returning the closest match if within tolerance,
 * or null if nothing is close enough.
 *
 * New helper (not present verbatim in chatbot-engine.js, but built from
 * the same primitives) — intended for later consumption by the
 * Diagnostic Engine's evidence-extractor once a concrete evidence
 * vocabulary exists to match against.
 *
 * @param {string} word
 * @param {string[]} candidates
 * @returns {string|null}
 */
export function findBestFuzzyMatch(word, candidates) {
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
        if (!fuzzyWordMatch(word, candidate)) continue;
        const distance = levenshtein(word, candidate);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
        }
    }
    return best;
}
