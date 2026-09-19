/**
 * equivalence.test.mjs
 * ------------------------------------------------------------
 * Checks the one claim the retrieval layer has to earn: that scoring only the
 * scenarios sharing a token with the message produces the SAME confidences and
 * the SAME ranking as scoring the whole catalog.
 *
 * The derivation is in scenario-index.js and it is short enough to be
 * convincing, which is exactly why it is worth testing. A derivation proves
 * something about the formula; these tests check the code implements that
 * formula — including the parts the derivation glosses over, like duplicate
 * tokens inside one signature, zero-weight entries, and empty signatures.
 *
 * Randomly generated catalogs are included because the shipped one has a
 * particular shape (2-4 tokens per signature, small integer weights) and an
 * equivalence that only holds for that shape is not equivalence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeScenarioConfidence } from '../../diagnostics/hypothesis-tracker.js';
import { mergeEvidence, getAllTokenPresences } from '../../diagnostics/evidence-accumulator.js';
import { buildScenarioIndex, indexStats } from '../scenario-index.js';
import { retrieveCandidates } from '../candidate-retrieval.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CATALOG = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'sie/scenarios/scenario-catalog.data/scenarios.json'), 'utf8')
).scenarios;

const EPSILON = 1e-12;

/** What the engine does today: score every scenario, keep the non-zero ones. */
function fullScan(scenarios, presences) {
    const out = [];
    for (const scenario of scenarios) {
        const { confidence } = computeScenarioConfidence(scenario, presences);
        if (confidence > 0) out.push({ id: scenario.id, confidence });
    }
    out.sort((a, b) => (b.confidence - a.confidence) || String(a.id).localeCompare(String(b.id)));
    return out;
}

function presencesFor(tokens) {
    const evidence = tokens.map((token) => ({ token, source: 'text', polarity: 'supports', weight: 1, turn: 1 }));
    return getAllTokenPresences(mergeEvidence({ entries: [] }, evidence, 1));
}

/** Deterministic PRNG — a failing seed has to be reproducible to be useful. */
function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function syntheticCatalog(count, vocabularySize, seed) {
    const rand = rng(seed);
    const scenarios = [];
    for (let i = 0; i < count; i++) {
        const size = 1 + Math.floor(rand() * 5);
        const signature = [];
        for (let k = 0; k < size; k++) {
            signature.push({
                token: `tok_${Math.floor(rand() * vocabularySize)}`,
                // Includes zero weights and fractional weights on purpose:
                // the shipped catalog has neither, and both are legal.
                weight: Math.floor(rand() * 5) * (rand() < 0.2 ? 0 : 1) + (rand() < 0.3 ? 0.5 : 0)
            });
        }
        scenarios.push({ id: `syn_${String(i).padStart(6, '0')}`, evidenceSignature: signature });
    }
    return scenarios;
}

// ------------------------------------------------------------

test('equivalence: retrieval matches a full scan on the shipped catalog, for every signature token', () => {
    const allTokens = [...new Set(CATALOG.flatMap((s) => (s.evidenceSignature || []).map((e) => e.token)))];
    assert.ok(allTokens.length > 400, 'catalog vocabulary collapsed');

    for (const token of allTokens) {
        const presences = presencesFor([token]);
        const expected = fullScan(CATALOG, presences);
        const actual = retrieveCandidates(CATALOG, presences).candidates
            .map((c) => ({ id: c.scenario.id, confidence: c.confidence }));

        assert.equal(actual.length, expected.length, `candidate count differs for "${token}"`);
        for (let i = 0; i < expected.length; i++) {
            assert.equal(actual[i].id, expected[i].id, `ranking differs at position ${i} for "${token}"`);
            assert.ok(Math.abs(actual[i].confidence - expected[i].confidence) < EPSILON,
                `confidence differs for "${token}" / ${expected[i].id}: ${actual[i].confidence} vs ${expected[i].confidence}`);
        }
    }
});

test('equivalence: retrieval matches a full scan for multi-token messages', () => {
    const allTokens = [...new Set(CATALOG.flatMap((s) => (s.evidenceSignature || []).map((e) => e.token)))];
    const rand = rng(20260919);
    for (let trial = 0; trial < 400; trial++) {
        const n = 1 + Math.floor(rand() * 8);
        const tokens = Array.from({ length: n }, () => allTokens[Math.floor(rand() * allTokens.length)]);
        const presences = presencesFor(tokens);
        const expected = fullScan(CATALOG, presences);
        const actual = retrieveCandidates(CATALOG, presences).candidates
            .map((c) => ({ id: c.scenario.id, confidence: c.confidence }));
        assert.deepEqual(
            actual.map((c) => c.id), expected.map((c) => c.id),
            `ranking differs on trial ${trial} for tokens [${tokens.join(', ')}]`
        );
        for (let i = 0; i < expected.length; i++) {
            assert.ok(Math.abs(actual[i].confidence - expected[i].confidence) < EPSILON,
                `confidence differs on trial ${trial}`);
        }
    }
});

test('equivalence: every scenario retrieval omits really does score zero', () => {
    const allTokens = [...new Set(CATALOG.flatMap((s) => (s.evidenceSignature || []).map((e) => e.token)))];
    const rand = rng(7);
    for (let trial = 0; trial < 60; trial++) {
        const tokens = Array.from({ length: 1 + Math.floor(rand() * 4) },
            () => allTokens[Math.floor(rand() * allTokens.length)]);
        const presences = presencesFor(tokens);
        const retrieved = new Set(retrieveCandidates(CATALOG, presences).candidates.map((c) => c.scenario.id));
        for (const scenario of CATALOG) {
            if (retrieved.has(scenario.id)) continue;
            const { confidence } = computeScenarioConfidence(scenario, presences);
            assert.equal(confidence, 0, `"${scenario.id}" was omitted but scores ${confidence}`);
        }
    }
});

test('equivalence: holds on random catalogs with shapes the shipped one does not have', () => {
    for (const [count, vocab, seed] of [[50, 20, 1], [500, 100, 2], [2000, 300, 3], [2000, 40, 4]]) {
        const catalog = syntheticCatalog(count, vocab, seed);
        const rand = rng(seed * 31);
        for (let trial = 0; trial < 40; trial++) {
            const tokens = Array.from({ length: 1 + Math.floor(rand() * 6) },
                () => `tok_${Math.floor(rand() * vocab)}`);
            const presences = presencesFor(tokens);
            const expected = fullScan(catalog, presences);
            const actual = retrieveCandidates(catalog, presences).candidates
                .map((c) => ({ id: c.scenario.id, confidence: c.confidence }));
            assert.deepEqual(actual.map((c) => c.id), expected.map((c) => c.id),
                `ranking differs: catalog ${count}/${vocab} seed ${seed} trial ${trial}`);
            for (let i = 0; i < expected.length; i++) {
                assert.ok(Math.abs(actual[i].confidence - expected[i].confidence) < EPSILON,
                    `confidence differs: catalog ${count}/${vocab} seed ${seed} trial ${trial}`);
            }
        }
    }
});

test('equivalence: a token repeated inside one signature is not counted twice', () => {
    const catalog = [{ id: 'dup', evidenceSignature: [{ token: 'a', weight: 2 }, { token: 'a', weight: 3 }, { token: 'b', weight: 5 }] }];
    const presences = presencesFor(['a']);
    const expected = computeScenarioConfidence(catalog[0], presences).confidence;
    const actual = retrieveCandidates(catalog, presences).candidates[0].confidence;
    assert.ok(Math.abs(actual - expected) < EPSILON, `${actual} vs ${expected}`);
});

// ------------------------------------------------------------
// Degenerate shapes. These are where an index implementation actually breaks.

test('edge cases: empty catalog, empty message, empty signatures, zero weights', () => {
    assert.deepEqual(retrieveCandidates([], presencesFor(['a'])).candidates, []);
    assert.deepEqual(retrieveCandidates(CATALOG, new Map()).candidates, []);
    assert.deepEqual(retrieveCandidates([{ id: 'x', evidenceSignature: [] }], presencesFor(['a'])).candidates, []);

    // Every weight zero: the denominator is zero, so confidence is undefined.
    // The full scan reports 0 for this, and retrieval must agree rather than
    // producing NaN or Infinity.
    const zeroed = [{ id: 'z', evidenceSignature: [{ token: 'a', weight: 0 }] }];
    assert.equal(computeScenarioConfidence(zeroed[0], presencesFor(['a'])).confidence, 0);
    assert.deepEqual(retrieveCandidates(zeroed, presencesFor(['a'])).candidates, []);

    assert.deepEqual(retrieveCandidates(CATALOG, presencesFor(['token_that_exists_nowhere'])).candidates, []);
});

test('edge cases: malformed signature entries are skipped, not thrown on', () => {
    const messy = [
        { id: 'a', evidenceSignature: [{ token: 'x', weight: 1 }, null, { weight: 2 }, { token: 5, weight: 1 }] },
        { id: 'b' },
        { id: 'c', evidenceSignature: 'not an array' }
    ];
    const out = retrieveCandidates(messy, presencesFor(['x']));
    assert.deepEqual(out.candidates.map((c) => c.scenario.id), ['a']);
});

test('limit: truncates after exact scoring, so it returns the true top K', () => {
    const presences = presencesFor(['intent_how_to']);
    const all = retrieveCandidates(CATALOG, presences).candidates;
    for (const k of [1, 3, 10]) {
        const limited = retrieveCandidates(CATALOG, presences, { limit: k }).candidates;
        assert.deepEqual(limited.map((c) => c.scenario.id), all.slice(0, k).map((c) => c.scenario.id));
    }
});

test('cost: retrieval touches a small fraction of the catalog for a realistic message', () => {
    const out = retrieveCandidates(CATALOG, presencesFor(['intent_reset', 'entity_password']));
    assert.ok(out.scanned < out.catalogSize / 50,
        `scanned ${out.scanned} of ${out.catalogSize} — expected a large reduction`);
    assert.ok(out.considered > 0);
});

test('index: is cached on the catalog array and reports honest statistics', () => {
    const a = buildScenarioIndex(CATALOG);
    assert.equal(buildScenarioIndex(CATALOG), a, 'index must be cached per array identity');
    assert.notEqual(buildScenarioIndex([...CATALOG]), a, 'a different array must get a different index');

    const stats = indexStats(a);
    assert.equal(stats.scenarios, CATALOG.length);
    assert.ok(stats.vocabulary > 0 && stats.vocabulary < CATALOG.length * 5);
    assert.ok(stats.longestPostingLength >= stats.averagePostingLength);
    assert.ok(stats.worstCaseFanout > 0 && stats.worstCaseFanout <= 1);
});
