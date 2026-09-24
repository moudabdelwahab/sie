/**
 * stand-off.test.mjs — the single-word stand-off rule, and the two engine
 * facts it rests on (sie/editions/stand-off.js).
 *
 * The rule checks presences 0.75–1 only. That is exact, not a shortcut, as
 * long as (a) nothing in production emits 'contradicts' evidence and (b)
 * every evidence weight is ≥ OBSERVED_PRESENCE_MIN — noisy-OR then keeps any
 * observed token at ≥ 0.75. Both are pinned here, statically and on the real
 * pipeline, so the day either changes this file fails instead of the rule
 * silently under-checking.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { standOffPresence, maxSafePackConfidence, OBSERVED_PRESENCE_MIN } from '../stand-off.js';
import { BASE_WEIGHT_BY_SOURCE, extractDiscriminatingAnswerEvidence } from '../../diagnostics/evidence-extractor.js';
import { getAllTokenPresences } from '../../diagnostics/evidence-accumulator.js';
import { ACTIVATION_THRESHOLD as ACT } from '../../diagnostics/hypothesis-tracker.js';
import { AMBIGUITY_MARGIN as M } from '../../ranking/ranking-engine.js';
import { runTurn } from '../../pipeline/pipeline.js';
import { SIE_DEFAULT_SETTINGS } from '../../config/settings-schema.js';
import { nodeEdition, readCore, readBaseGlossary } from './helpers/node-editions.js';
import { buildBehaviorCorpus } from '../../../bench/corpora/behavior.mjs';

const SIE = path.resolve(import.meta.dirname, '../..');

function sourceFiles(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'tests' && e.name !== 'node_modules') out.push(...sourceFiles(p)); }
        else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
}

test('fact (a): no production code creates contradicting evidence', () => {
    const offenders = [];
    for (const f of sourceFiles(SIE)) {
        const src = fs.readFileSync(f, 'utf8');
        // Creating it: a literal polarity value, or overriding the answer
        // extractor's polarity/weight at a call site.
        if (/polarity\s*:\s*['"]contradicts['"]/.test(src)) offenders.push(`${path.relative(SIE, f)}: literal contradicts`);
        for (const m of src.matchAll(/(?<!function )extractDiscriminatingAnswerEvidence\(\{([^}]*)\}/g)) {
            if (/\b(polarity|weight)\b/.test(m[1])) offenders.push(`${path.relative(SIE, f)}: overrides ${m[1].trim()}`);
        }
    }
    assert.deepEqual(offenders, []);
    const answer = extractDiscriminatingAnswerEvidence({ impliedTokens: ['entity_ticket'], turn: 1 });
    assert.equal(answer[0].polarity, 'supports');
    assert.ok(answer[0].weight >= OBSERVED_PRESENCE_MIN);
});

test('fact (b): every text source weighs at least OBSERVED_PRESENCE_MIN, and that is 0.75', () => {
    assert.equal(OBSERVED_PRESENCE_MIN, 0.75);
    for (const w of Object.values(BASE_WEIGHT_BY_SOURCE)) assert.ok(w >= OBSERVED_PRESENCE_MIN && w <= 1);
});

test('fact (a+b) on the real pipeline: every observed presence is ≥ 0.75', async () => {
    const pro = await nodeEdition('pro', SIE_DEFAULT_SETTINGS);
    const corpus = buildBehaviorCorpus({ catalog: readCore(), glossary: readBaseGlossary() }).slice(0, 1500);
    const variant = { retrieval: true, sparseState: false, trust: 'enforce' };
    let seen = 0;
    const low = [];
    // Three-turn conversations, so accumulation across turns is covered too.
    for (let i = 0; i + 2 < corpus.length; i += 3) {
        let previous = null;
        for (const m of corpus.slice(i, i + 3)) {
            const r = await runTurn({ text: m.text, catalog: pro.scenarios, previous, settings: SIE_DEFAULT_SETTINGS, variant,
                providers: { glossaryProvider: pro.providers.glossaryProvider, arabiziProvider: pro.providers.arabiziProvider },
                edition: { profile: pro.profile, glossaryLayers: pro.glossaryLayers } });
            for (const [t, p] of getAllTokenPresences(r.diagnosticState?.accumulator)) {
                seen += 1;
                if (p < OBSERVED_PRESENCE_MIN - 1e-9) low.push(`${t}=${p} «${m.text}»`);
            }
            previous = { diagnosticState: r.diagnosticState, decisionState: r.decisionState, turnCount: r.turn, language: r.responseLanguage, lastCustomerText: m.text };
        }
    }
    assert.ok(seen > 1000, `the check must actually see presences (saw ${seen})`);
    assert.deepEqual(low.slice(0, 5), []);
});

// ── the rule itself, against a direct simulation of the ranking ──────────

/** Free decisive and the pack scenario a live rival, straight from the ranking definitions. */
function simulated(p, a, c2, d) {
    const cands = [d * a, d * c2].filter((x) => x >= ACT);
    const freeDecisive = cands.length > 0 && (cands.length === 1 || cands[0] - cands[1] >= M);
    const rival = d * p >= ACT && d * a - d * p < M;
    return freeDecisive && rival;
}

test('the rule matches a direct simulation on a dense grid', () => {
    let checked = 0;
    for (let a = 0.2; a <= 1.0001; a += 0.05) {
        for (let c2 = 0; c2 <= a; c2 += 0.05) {
            for (let p = 0.05; p <= 1.0001; p += 0.01) {
                let expect = false;
                for (let d = OBSERVED_PRESENCE_MIN; d <= 1.0000001; d += 0.0005) if (simulated(p, a, c2, d)) { expect = true; break; }
                const got = standOffPresence(p, a, c2) !== null;
                // A disagreement that flips when any input moves by 1e-3 sits on a
                // boundary (0.3 − 0.2 is 0.0999… in floats; the rule is
                // deliberately conservative there). Anything else is a bug.
                if (got !== expect) {
                    const h = 0.001;
                    const near = [[p - h, a, c2], [p + h, a, c2], [p, a - h, c2], [p, a + h, c2], [p, a, c2 - h], [p, a, c2 + h]]
                        .some(([q, x, y]) => (standOffPresence(q, x, y) !== null) !== got);
                    assert.ok(near, `a=${a.toFixed(2)} c2=${c2.toFixed(2)} p=${p.toFixed(2)}: rule ${got}, simulation ${expect}`);
                }
                checked += 1;
            }
        }
    }
    assert.ok(checked > 5000);
});

test('the case that found it: 0.39 under a 0.50 core reading is a stand-off at the dialect presence 0.8', () => {
    assert.ok(simulated(0.39, 0.5, 0.333, 0.8), 'the simulation itself sees it');
    assert.notEqual(standOffPresence(0.39, 0.5, 0.333), null);
    assert.equal(standOffPresence(0.39, 0.5, 0.333, 1), null, 'invisible at presence 1.0 — which is why the old audit passed it');
    const safe = maxSafePackConfidence(0.5, 0.333);
    assert.ok(safe < 0.39 && standOffPresence(safe - 1e-6, 0.5, 0.333) === null && standOffPresence(safe + 1e-3, 0.5, 0.333) !== null);
});
