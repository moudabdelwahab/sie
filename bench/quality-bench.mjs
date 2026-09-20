/**
 * quality-bench.mjs
 * ------------------------------------------------------------
 * Measures DISCRIMINABILITY as the catalog grows: can a scenario still be
 * singled out by the words it was written around?
 *
 * Run: node bench/quality-bench.mjs
 *
 * This is a different question from distinctness, and conflating the two is
 * what made an earlier version of this analysis wrong. Two signatures can be
 * different and still be impossible to tell apart from a realistic message —
 * `{a,b,c}` and `{a,b,d}` are distinct, but a customer who only says "a b"
 * reaches both. Distinctness is combinatorial and generous; discriminability
 * is what the product actually needs.
 *
 * The probe for each scenario is its own two highest-weighted tokens — the
 * friendliest input it can receive, and the same probe
 * sie/scenarios/tests/catalog-reachability.test.mjs uses against the real
 * catalog. A scenario that cannot win on those words cannot be reached by any
 * customer phrasing.
 *
 * Three outcomes per scenario:
 *   WIN         it ranks first on its own words
 *   TIE         it is tied for first with at least one other scenario, so the
 *               winner is decided by the id tie-break rather than by evidence
 *   LOST        something else ranks strictly above it
 */
import { generateCatalog } from './catalog-generator.mjs';
import { buildScenarioIndex } from '../sie/retrieval/scenario-index.js';
import { retrieveCandidates } from '../sie/retrieval/candidate-retrieval.js';
import { mergeEvidence, getAllTokenPresences } from '../sie/diagnostics/evidence-accumulator.js';

const SIZES = [650, 1000, 3500, 10000, 100000];
const SAMPLE = 2000;   // scenarios probed per catalog, for runtime at 100k

function presencesFor(tokens) {
    const evidence = tokens.map((token) => ({ token, source: 'text', polarity: 'supports', weight: 1, turn: 1 }));
    return getAllTokenPresences(mergeEvidence({ entries: [] }, evidence, 1));
}

function probeFor(scenario) {
    return [...scenario.evidenceSignature]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 2)
        .map((e) => e.token);
}

function measure(scenarios, sampleSize, rand) {
    const index = buildScenarioIndex(scenarios);
    let win = 0, tie = 0, lost = 0;
    const step = Math.max(1, Math.floor(scenarios.length / sampleSize));

    for (let i = 0; i < scenarios.length; i += step) {
        const scenario = scenarios[i];
        const { candidates } = retrieveCandidates(index, presencesFor(probeFor(scenario)));
        if (candidates.length === 0) { lost += 1; continue; }

        const best = candidates[0].confidence;
        const mine = candidates.find((c) => c.scenario.id === scenario.id);
        if (!mine) { lost += 1; continue; }

        if (mine.confidence < best) lost += 1;
        else if (candidates.filter((c) => c.confidence === best).length > 1) tie += 1;
        else win += 1;
    }
    const total = win + tie + lost;
    return { total, win, tie, lost, winPct: 100 * win / total, tiePct: 100 * tie / total, lostPct: 100 * lost / total };
}

let seed = 99;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

console.log('SIE discriminability vs catalog size — flat signatures, real sharing structure\n');
console.log('N          probed    WIN%     TIE%     LOST%    collisions   maxDf');
console.log('-'.repeat(72));

for (const size of SIZES) {
    const { scenarios, stats } = generateCatalog(size, { seed: 42 });
    const r = measure(scenarios, SAMPLE, rand);
    console.log([
        String(size).padEnd(11), String(r.total).padEnd(10),
        r.winPct.toFixed(1).padEnd(9), r.tiePct.toFixed(1).padEnd(9), r.lostPct.toFixed(1).padEnd(9),
        `${(100 * stats.collisionRate).toFixed(2)}%`.padEnd(13), String(stats.maxDocumentFrequency)
    ].join(''));
}

console.log('\nSame, with the vocabulary held at the shipped glossary (516 canonical tokens):');
console.log('N          probed    WIN%     TIE%     LOST%    collisions');
console.log('-'.repeat(60));
for (const size of SIZES) {
    const { scenarios, stats } = generateCatalog(size, { seed: 42, vocabulary: 516 });
    const r = measure(scenarios, SAMPLE, rand);
    console.log([
        String(size).padEnd(11), String(r.total).padEnd(10),
        r.winPct.toFixed(1).padEnd(9), r.tiePct.toFixed(1).padEnd(9), r.lostPct.toFixed(1).padEnd(9),
        `${(100 * stats.collisionRate).toFixed(2)}%`
    ].join(''));
}
