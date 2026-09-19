/**
 * adversarial.test.mjs
 * ------------------------------------------------------------
 * Measures the trust boundary against the attack corpus AND against
 * legitimate traffic, in the same file, on purpose.
 *
 * A detection rate reported without its false-positive rate is not a
 * measurement, it is an advertisement. Any change that improves one of these
 * numbers by ruining the other should fail here, loudly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize } from '../../language/normalizer.js';
import { extractTextEvidence } from '../../diagnostics/evidence-extractor.js';
import { createRealGlossaryProvider, createRealArabiziProvider } from '../../language/tests/helpers/node-providers.js';
import { admitTurn } from '../admission-control.js';
import { atOrAbove } from '../trust-types.js';
import { ATTACKS } from './fixtures/adversarial-corpus.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const providers = { glossaryProvider: createRealGlossaryProvider(), arabiziProvider: createRealArabiziProvider() };

async function classify(text) {
    const n = await normalize(text, providers);
    return admitTurn({ rawText: text, evidence: extractTextEvidence(n.normalizedTokens, 1) });
}

/**
 * The legitimate corpus: every distinct Arabic string literal in the
 * repository's own tests, plus the small-talk baseline utterances.
 *
 * This is a PROXY for production traffic, not a sample of it, and the gap
 * matters: it under-represents long messages and contains no pasted logs.
 * A false-positive rate measured here is a lower bound. Replacing it with
 * real traces is recorded as open work in SIE-ARCHITECTURE.md.
 */
function legitimateCorpus() {
    const cmd = `grep -rhoE "'[^']*[\\u0600-\\u06FF][^']*'" ` +
        `"${ROOT}/sie"/*/tests/*.mjs "${ROOT}/sie-integration/tests"/*.mjs "${ROOT}/channels/tests"/*.mjs 2>/dev/null | sort -u`;
    let raw = [];
    try {
        raw = execSync(cmd, { encoding: 'utf8', maxBuffer: 1 << 26, shell: '/bin/bash' })
            .split('\n').filter(Boolean).map((s) => s.slice(1, -1));
    } catch { /* grep exits non-zero on no match; an empty corpus fails the assertion below */ }
    const fixturePath = path.join(ROOT, 'sie/scenarios/tests/fixtures/small-talk-overlap.baseline.json');
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')).map((s) => s.split('::')[1]).filter(Boolean);
    return [...new Set([...raw, ...fixture])].filter((s) => s.length > 1 && s.length < 400);
}

test('adversarial: every attack the corpus expects to be caught, is caught at or above its required level', async () => {
    const misses = [];
    for (const a of ATTACKS) {
        if (!a.minLevel) continue;
        const env = await classify(a.text);
        if (!atOrAbove(env.level, a.minLevel)) {
            misses.push(`[${a.class}] "${a.text.slice(0, 48)}" -> ${env.level}, needed >= ${a.minLevel}`);
        }
    }
    assert.deepEqual(misses, [], `uncaught attacks:\n${misses.join('\n')}`);
});

test('adversarial: attack-shaped but legitimate messages are not escalated', async () => {
    const wrong = [];
    for (const a of ATTACKS) {
        if (a.minLevel) continue;
        const env = await classify(a.text);
        if (env.level !== 'trusted') {
            wrong.push(`[${a.class}] "${a.text.slice(0, 48)}" -> ${env.level} (${env.signals.map((s) => s.kind).join(',')})`);
        }
    }
    assert.deepEqual(wrong, [], `false positives on legitimate lookalikes:\n${wrong.join('\n')}`);
});

test('adversarial: false-positive rate on the legitimate corpus stays at 0%', async () => {
    const corpus = legitimateCorpus();
    assert.ok(corpus.length > 500, `corpus collapsed to ${corpus.length} messages — the grep above stopped matching`);

    const fired = [];
    for (const msg of corpus) {
        const env = await classify(msg);
        if (env.level !== 'trusted') fired.push(`"${msg.slice(0, 56)}" -> ${env.level}: ${env.signals.map((s) => s.kind).join(',')}`);
    }
    const rate = (100 * fired.length) / corpus.length;
    assert.equal(fired.length, 0,
        `${fired.length}/${corpus.length} (${rate.toFixed(2)}%) legitimate messages escalated:\n${fired.slice(0, 12).join('\n')}`);
});
