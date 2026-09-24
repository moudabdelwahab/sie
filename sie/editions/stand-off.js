/**
 * stand-off.js
 * ------------------------------------------------------------
 * متى تخلق كلمة واحدة تعادلًا — when one word alone lets a pack scenario
 * create a stand-off the smaller edition did not have, at ANY strength the
 * word can arrive with.
 *
 * WHY "ANY STRENGTH"
 * On one word alone, a scenario's confidence is `presence × share`, where
 * share is the word's weight share in the scenario's best signature and
 * presence is how strongly the word was observed: 1.0 for a glossary phrase,
 * 0.8 for a dialect word, 0.75 for Arabizi, and anything lower once a later
 * turn negates or decays it (evidence-accumulator). Every confidence on that
 * word scales by the same factor — and so does every GAP. A pack scenario
 * 0.11 under the best core reading at presence 1.0 is 0.088 under it at 0.8:
 * inside AMBIGUITY_MARGIN. That is exactly how «انا صاحب الحساب ومش عارف
 * ادخل» (a dialect «ادخل», presence 0.8) became a Pro stand-off and a ticket
 * where Free asked its clarifying question, while the full-presence audit
 * reported zero findings.
 *
 * THE RULE
 * For one word with best core confidence `a` and second core confidence `c2`
 * (0 when there is none; both at presence 1), a pack confidence `p` is safe
 * iff at no presence d ∈ [OBSERVED_PRESENCE_MIN, 1] where Free answers the
 * word DECISIVELY
 *     d·a ≥ ACT  and  (d·c2 < ACT  or  d·(a − c2) ≥ M)
 * is the pack scenario a live rival:
 *     d·p ≥ ACT  and  d·|a − p| < M.
 * (ACT = ACTIVATION_THRESHOLD, M = AMBIGUITY_MARGIN.) Where Free itself is
 * already in a stand-off the rule has nothing to protect; the separate
 * displacement rule (edition-audit) covers the top-three question pool.
 * With c2 = 0 the same rule gives a pack-only word one leader: `a` is the
 * leader, `p` any other reading.
 *
 * WORD SETS, NOT ONLY WORDS
 * The same holds for any set of core words a pack signature contains: two
 * core words together have core readings too, and a pack scenario that
 * carries most of its weight on them ties those readings. Found by the
 * comparator: «تيليجرام: بيرفض السر الغلط» — {telegram, rejected} scored
 * 0.67 for the Pro "link code rejected" case and 0.67 for the core
 * "channel token invalid" case. coreReadings/wordSets serve that check.
 *
 * WHICH PRESENCES
 * Exactly the ones the engine can produce. Every piece of evidence the
 * production code creates SUPPORTS its token — text at 1.0 / 0.8 / 0.75, a
 * question answer at 0.9 — and noisy-OR only ever raises a presence. So a
 * token that is present at all is present at ≥ 0.75 (OBSERVED_PRESENCE_MIN,
 * the weakest source). Nothing in production emits 'contradicts' evidence;
 * stand-off.test.mjs pins both facts, so the day that changes this range is
 * re-derived rather than silently wrong.

 * Both conditions are piecewise-linear in d with breakpoints where a term
 * crosses ACT or M, so checking d at those breakpoints (and just past them)
 * plus a fine grid is exact for practical purposes; the grid only guards
 * against a breakpoint this reasoning missed.
 */

import { ACTIVATION_THRESHOLD as ACT, computeScenarioConfidence } from '../diagnostics/hypothesis-tracker.js';
import { AMBIGUITY_MARGIN as M } from '../ranking/ranking-engine.js';
import { BASE_WEIGHT_BY_SOURCE } from '../diagnostics/evidence-extractor.js';

/** The weakest presence a token can have once observed (Arabizi text, 0.75). */
export const OBSERVED_PRESENCE_MIN = Math.min(...Object.values(BASE_WEIGHT_BY_SOURCE));

const EPS = 1e-9;

function presences(a, c2, p, dMin) {
    const ds = new Set([1]);
    for (const x of [a, c2, p]) if (x > 0) ds.add(ACT / x);
    for (const x of [a - c2, a - p]) if (x > 0) ds.add(M / x);
    const out = [];
    for (const d of ds) for (const k of [d - 1e-7, d, d + 1e-7]) if (k > 0 && k <= 1) out.push(k);
    for (let i = 1; i <= 200; i++) out.push(i / 200);
    out.push(dMin);
    return out.filter((d) => d >= dMin);
}

/** True when Free answers the word decisively at presence d. */
function freeDecisive(d, a, c2) {
    if (d * a < ACT - EPS) return false;
    return d * c2 < ACT - EPS || d * (a - c2) >= M - EPS;
}

/**
 * @param {number} p   pack confidence on the word alone, presence 1
 * @param {number} a   best core confidence, presence 1
 * @param {number} c2  second core confidence, presence 1 (0 if none)
 * @param {number} [dMin]  lowest presence to consider
 * @returns {number|null}  the presence at which p creates a new stand-off, or null (safe)
 */
export function standOffPresence(p, a, c2 = 0, dMin = OBSERVED_PRESENCE_MIN) {
    for (const d of presences(a, c2, p, dMin)) {
        if (!freeDecisive(d, a, c2)) continue;
        // Within the margin on EITHER side is a stand-off. (Above it by the
        // margin is a different, decisive reading: forbidden for one word
        // alone by the caller, allowed for a word set — that is the more
        // specific case a pack adds.)
        if (d * p >= ACT - EPS && d * Math.abs(a - p) < M - EPS) return d;
    }
    return null;
}

/**
 * The largest safe p below `a` (monotone there: raising p toward `a` only
 * widens the rival region).
 * @returns {number} 0 when no active p is safe
 */
export function maxSafePackConfidence(a, c2 = 0, dMin = OBSERVED_PRESENCE_MIN) {
    if (standOffPresence(0, a, c2, dMin) !== null) return 0;
    // Searched below `a` only: above it the rule is not monotone (far
    // enough above is safe again), and callers want the ceiling under it.
    let lo = 0, hi = a;
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (standOffPresence(mid, a, c2, dMin) === null) lo = mid; else hi = mid;
    }
    return lo;
}

/**
 * The best and second-best CORE readings of a set of words together, at
 * presence 1 — candidates only (≥ ACTIVATION_THRESHOLD).
 * @param {Array} coreScenarios
 * @param {string[]} tokens
 * @returns {{best: number, second: number}}
 */
export function coreReadings(coreScenarios, tokens) {
    const presence = new Map(tokens.map((t) => [t, 1]));
    let best = 0, second = 0;
    for (const sc of coreScenarios) {
        const c = computeScenarioConfidence(sc, presence).confidence;
        if (c < ACT) continue;
        if (c > best) { second = best; best = c; } else if (c > second) second = c;
    }
    return { best, second };
}

/**
 * Every subset of at least two of `tokens` — the word SETS a message can
 * carry into a pack signature. Signatures are ≤ 6 tokens (pack-guard), so at
 * most 57 subsets.
 */
export function wordSets(tokens) {
    const out = [];
    const n = tokens.length;
    for (let mask = 1; mask < (1 << n); mask++) {
        const set = tokens.filter((_, i) => mask & (1 << i));
        if (set.length >= 2) out.push(set);
    }
    return out;
}
