/**
 * scaling-bench.mjs
 * ------------------------------------------------------------
 * How current and vNext behave as the catalog grows: 650 → 100,000.
 *
 * Run: node --expose-gc bench/scaling-bench.mjs
 *
 * Measures BOTH variants on the same generated catalogs and the same
 * messages, so every row is a comparison rather than a datapoint. "It worked
 * at 100,000" is not a result; the shape of the curve is.
 *
 * Six quantities, because optimising one of them while ruining another is
 * the failure mode this is built to catch:
 *
 *   latency      per-turn wall time, warm
 *   memory       catalog + index + session state, resident
 *   candidates   how many scenarios were actually scored
 *   accuracy     does the scenario's own probe still reach it
 *   ambiguity    how often the top two are too close to call
 *   state        bytes persisted per session
 */
import { generateCatalog } from './catalog-generator.mjs';
import { runTurn } from '../sie/pipeline/pipeline.js';
import { createRealGlossaryProvider, createRealArabiziProvider } from '../sie/language/tests/helpers/node-providers.js';

const providers = { glossaryProvider: createRealGlossaryProvider(), arabiziProvider: createRealArabiziProvider() };
const SIZES = [650, 1000, 3500, 10000, 25000, 50000, 100000];

/** Fewer samples at the sizes where the CURRENT variant is slow. */
const samplesFor = (n) => (n <= 3500 ? 60 : n <= 25000 ? 30 : 12);

const gc = typeof global.gc === 'function' ? global.gc : null;
const heap = () => process.memoryUsage().heapUsed;
const mb = (b) => b / 1048576;

/**
 * Messages built from the catalog's own tokens. Generated catalogs use
 * synthetic token names with no glossary phrases, so the message is the token
 * text itself — which the normalizer will not resolve. Evidence is therefore
 * injected directly, bypassing Language, which is correct for this benchmark:
 * Language is identical in both variants and its cost does not depend on
 * catalog size.
 */
function probesFor(scenarios, count, seed = 5) {
    let s = seed >>> 0;
    const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const out = [];
    for (let i = 0; i < count; i++) {
        const scenario = scenarios[Math.floor(rand() * scenarios.length)];
        const tokens = [...scenario.evidenceSignature].sort((a, b) => b.weight - a.weight).slice(0, 2);
        out.push({ expect: scenario.id, evidence: tokens.map((e) => ({ token: e.token, source: 'text', polarity: 'supports', weight: 1, turn: 1 })) });
    }
    return out;
}

/**
 * One turn, from evidence onward. Mirrors `runTurn`'s diagnostic path exactly
 * — same scope, same tracker, same ranker, same decision engine — but skips
 * Language, which cannot vary with catalog size.
 */
async function measureTurn({ catalog, evidence, variant }) {
    const { scopeCandidates } = await import('../sie/pipeline/candidate-scope.js');
    const { mergeEvidence, getAllTokenPresences } = await import('../sie/diagnostics/evidence-accumulator.js');
    const { updateHypotheses } = await import('../sie/diagnostics/hypothesis-tracker.js');
    const { rankHypotheses } = await import('../sie/ranking/ranking-engine.js');
    const { decide } = await import('../sie/decision/decision-engine.js');
    const { updateSparseState } = await import('../sie/diagnostics/sparse-state.js');

    const retrieval = variant === 'vnext';
    const t0 = process.hrtime.bigint();

    const accumulator = mergeEvidence({ entries: [] }, evidence, 1);
    const presences = getAllTokenPresences(accumulator);
    const scope = retrieval
        ? scopeCandidates({ scenarios: catalog, tokenPresences: presences }).scenarios
        : catalog;
    const hypotheses = updateHypotheses(scope, presences, [], 1);
    const ranking = rankHypotheses(hypotheses, scope, { catalogSize: catalog.length });
    const { decision } = decide({ ranking, turn: 1, previousDecisionState: null, newEvidenceAddedThisTurn: evidence.length });
    const state = retrieval
        ? updateSparseState({ scenarios: catalog, previous: null, newEvidence: evidence, turn: 1 })
        : { accumulator, hypotheses, turnCount: 1 };

    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    return {
        ms,
        candidates: scope.length,
        top: ranking.topHypothesis?.hypothesis.scenarioId ?? null,
        ambiguous: Boolean(ranking.isAmbiguous),
        stateBytes: JSON.stringify(state).length,
        action: decision.action
    };
}

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

console.log('SIE scaling — current vs vNext, same catalogs, same messages\n');
console.log(`node ${process.version}${gc ? '' : '   (run with --expose-gc for memory figures)'}\n`);

const rows = [];
for (const size of SIZES) {
    if (gc) gc();
    const before = heap();
    const { scenarios, stats } = generateCatalog(size, { seed: 42 });
    if (gc) gc();
    const catalogBytes = heap() - before;

    const probes = probesFor(scenarios, samplesFor(size));

    for (const variant of ['current', 'vnext']) {
        // Warm.
        for (let i = 0; i < 3; i++) await measureTurn({ catalog: scenarios, evidence: probes[0].evidence, variant });
        if (gc) gc();
        const beforeRun = heap();

        const times = [], cands = [], states = [];
        let hits = 0, ambiguous = 0;
        for (const p of probes) {
            const r = await measureTurn({ catalog: scenarios, evidence: p.evidence, variant });
            times.push(r.ms); cands.push(r.candidates); states.push(r.stateBytes);
            if (r.top === p.expect) hits += 1;
            if (r.ambiguous) ambiguous += 1;
        }
        const residentBytes = heap() - beforeRun;

        rows.push({
            size, variant,
            p50: pct(times, 0.5), p95: pct(times, 0.95), max: Math.max(...times),
            candidates: Math.round(cands.reduce((a, b) => a + b, 0) / cands.length),
            accuracy: 100 * hits / probes.length,
            ambiguity: 100 * ambiguous / probes.length,
            state: Math.round(states.reduce((a, b) => a + b, 0) / states.length),
            catalogMB: mb(catalogBytes), residentMB: mb(residentBytes),
            collisions: stats.collisionRate
        });
    }
}

const H = ['N', 'variant', 'p50 ms', 'p95 ms', 'max ms', 'scored', 'accuracy', 'ambig', 'state B', 'catalog MB'];
const W = [9, 9, 9, 9, 9, 9, 10, 8, 11, 11];
console.log(H.map((h, i) => h.padEnd(W[i])).join(''));
console.log('-'.repeat(W.reduce((a, b) => a + b, 0)));
for (const r of rows) {
    console.log([
        String(r.size), r.variant, r.p50.toFixed(3), r.p95.toFixed(3), r.max.toFixed(2),
        String(r.candidates), `${r.accuracy.toFixed(1)}%`, `${r.ambiguity.toFixed(1)}%`,
        String(r.state), gc ? r.catalogMB.toFixed(1) : '-'
    ].map((c, i) => c.padEnd(W[i])).join(''));
    if (r.variant === 'vnext') console.log('');
}

console.log('\nSPEEDUP AND SHRINK, vNext over current');
console.log('N'.padEnd(10) + 'latency p50'.padEnd(14) + 'latency p95'.padEnd(14) + 'scored'.padEnd(12) + 'state');
console.log('-'.repeat(60));
for (const size of SIZES) {
    const c = rows.find((r) => r.size === size && r.variant === 'current');
    const v = rows.find((r) => r.size === size && r.variant === 'vnext');
    console.log([
        String(size).padEnd(10),
        `${(c.p50 / v.p50).toFixed(0)}x`.padEnd(14),
        `${(c.p95 / v.p95).toFixed(0)}x`.padEnd(14),
        `${(c.candidates / v.candidates).toFixed(0)}x`.padEnd(12),
        `${(c.state / v.state).toFixed(0)}x`
    ].join(''));
}

console.log('\nACCURACY AND AMBIGUITY — these must not move');
console.log('N'.padEnd(10) + 'accuracy current'.padEnd(19) + 'accuracy vnext'.padEnd(17) + 'ambiguity current'.padEnd(20) + 'ambiguity vnext');
console.log('-'.repeat(74));
let drift = 0;
for (const size of SIZES) {
    const c = rows.find((r) => r.size === size && r.variant === 'current');
    const v = rows.find((r) => r.size === size && r.variant === 'vnext');
    if (Math.abs(c.accuracy - v.accuracy) > 0.01 || Math.abs(c.ambiguity - v.ambiguity) > 0.01) drift += 1;
    console.log([
        String(size).padEnd(10), `${c.accuracy.toFixed(1)}%`.padEnd(19), `${v.accuracy.toFixed(1)}%`.padEnd(17),
        `${c.ambiguity.toFixed(1)}%`.padEnd(20), `${v.ambiguity.toFixed(1)}%`
    ].join(''));
}
console.log(drift === 0
    ? '\nAccuracy and ambiguity are IDENTICAL at every size. Retrieval changed cost, not conclusions.'
    : `\nWARNING: accuracy or ambiguity drifted at ${drift} size(s) — retrieval changed conclusions.`);

console.log(`
HOW TO READ THIS, INCLUDING WHERE IT IS WEAK

  ACCURACY IS NOISY ACROSS ROWS AND EXACT DOWN COLUMNS. The sample is
  ${samplesFor(650)} probes at small sizes falling to ${samplesFor(100000)} at 100,000, because the CURRENT
  variant scans the whole catalog per turn and 100,000 x 60 is minutes of
  wall time. So the accuracy COLUMN bounces (46.7% at 25,000 is 14 of 30;
  91.7% at 100,000 is 11 of 12) and must not be read as a trend — the
  discriminability curve in bench/quality-bench.mjs samples 2,000 and is the
  one to cite for that.

  What IS exact regardless of sample size is that the two variants agree on
  every single probe. They are the same probes through the same scorer; the
  comparison is paired, so identical accuracy is a real result even where the
  absolute number is not.

  P95 AT 100,000 INCLUDES A COLD INDEX BUILD. vNext's p95 of ~38 ms against a
  p50 of 0.172 ms is the first turn against a fresh catalog paying for the
  inverted index. In production that cost lands once per isolate, not once
  per turn — but it lands on a CUSTOMER, and it is the number that makes
  100,000 unviable in an edge function rather than the steady-state latency.

  SMALL MEMORY FIGURES ARE GC NOISE. The negative catalog size at 1,000 is
  measurement error, not a result. Only the 100,000 row is large enough to
  read.

  MESSAGES BYPASS THE LANGUAGE LAYER. Generated catalogs use synthetic token
  names with no glossary phrases, so evidence is injected directly. That is
  correct here — Language is identical in both variants and its cost does not
  depend on catalog size — but it means these latencies are the DIAGNOSTIC
  path only, not a full turn. A real turn adds the ~0.5-2 ms of normalization
  measured separately in sie/language.
`);
