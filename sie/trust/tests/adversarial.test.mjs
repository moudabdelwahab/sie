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
 * repository's test files, minus this directory, plus the small-talk
 * baseline utterances.
 *
 * TWO EXCLUSIONS, BOTH LOAD-BEARING:
 *
 *   - any test file on the ATTACK side is skipped, because those files contain
 *     attack strings by construction. Measuring a false-positive rate against
 *     a file full of attacks measures nothing except that the sensors work.
 *
 *     A file declares itself by putting the marker `@no-legitimate-corpus` in
 *     its header. That is an EXPLICIT opt-out, and it replaced two successive
 *     attempts to infer the same thing, each of which leaked:
 *
 *       path-based   skip sie/trust/tests — missed the bridge's flag
 *                    integration test in sie-integration/tests, which has
 *                    every reason to contain an attack string. Rate went
 *                    0.00% -> 0.30%.
 *       import-based skip files importing the trust layer — missed this
 *                    directory's own corpus fixture, which declares 24
 *                    attacks and imports nothing. Rate went to 2.74%.
 *       then both    missed sie/pipeline/tests/robustness.test.mjs, which
 *                    imports the trust layer only TRANSITIVELY through the
 *                    pipeline. Rate went to 0.31%.
 *
 *     Three leaks of one kind is enough evidence that the property is not
 *     inferable from a file's path or its imports. It is a fact about the
 *     file's CONTENT that only its author knows, so the author states it.
 *     The two inferred rules are kept as a backstop, not as the mechanism.
 *
 *   - strings that are plainly source code are skipped. The extractor cannot
 *     tell a template literal holding a code sample from a message, and a
 *     multi-line code block carries far more distinct tokens than any real
 *     message, so leaving them in distorts exactly the distribution the
 *     thresholds are calibrated against.
 *
 * A NOTE FOR WHOEVER CHANGES THIS FUNCTION: an earlier version extracted the
 * corpus with `grep -E "[\u0600-\u06FF]"`. GNU grep has no \uXXXX escape, so
 * that matched the literal characters \, u, 0-6 and F, and the "Arabic
 * corpus" contained almost no Arabic. It still produced 1,077 entries and a
 * 0% false-positive rate, which is why it survived review. The extraction
 * below runs in JavaScript, where the escape means what it says.
 *
 * This is a PROXY for production traffic, not a sample of it. It
 * under-represents long messages and contains no pasted logs, so the rate
 * measured here is a lower bound.
 */
const ARABIC = /[\u0600-\u06FF]/;
const STRING_LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.)*)`/g;
const LOOKS_LIKE_CODE = /=>|\bfunction\b|\bconst \w|\}\s*\)|;\s*$|^\s*[{\[]/m;

/**
 * A file belongs to the attack side if it LIVES in the trust layer or if it
 * IMPORTS the trust layer. Both halves are needed and each caught a real
 * leak: the path rule alone missed the bridge's flag integration test, and
 * the import rule alone missed this directory's own corpus fixture, which
 * declares 24 attacks and imports nothing.
 */
const TRUST_IMPORT = /['"][^'"]*\/trust\/[^'"]*['"]/;
const inTrustLayer = (file) => file.includes(`${path.sep}trust${path.sep}`);
/** The explicit opt-out. Any file whose header carries this is attack-side. */
const OPTED_OUT = /@no-legitimate-corpus/;

function testFilesUnder(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) testFilesUnder(full, out);
        else if (/\.m?js$/.test(entry.name)) out.push(full);
    }
    return out;
}

function legitimateCorpus() {
    const files = ['sie', 'sie-integration', 'channels']
        .flatMap((d) => testFilesUnder(path.join(ROOT, d)))
        .filter((f) => f.includes(`${path.sep}tests${path.sep}`));

    const corpus = new Set();
    for (const file of files) {
        if (inTrustLayer(file)) continue;
        const source = fs.readFileSync(file, 'utf8');
        if (OPTED_OUT.test(source) || TRUST_IMPORT.test(source)) continue;
        for (const m of source.matchAll(STRING_LITERAL)) {
            const raw = m[1] ?? m[2] ?? m[3];
            if (!raw || !ARABIC.test(raw)) continue;
            if (raw.length < 2 || raw.length > 400) continue;
            if (LOOKS_LIKE_CODE.test(raw)) continue;
            corpus.add(raw.replace(/\\n/g, '\n'));
        }
    }
    const fixturePath = path.join(ROOT, 'sie/scenarios/tests/fixtures/small-talk-overlap.baseline.json');
    for (const line of JSON.parse(fs.readFileSync(fixturePath, 'utf8'))) {
        const utterance = line.split('::')[1];
        if (utterance) corpus.add(utterance);
    }
    return [...corpus];
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
    assert.ok(corpus.length > 250,
        `corpus collapsed to ${corpus.length} messages — the extraction above stopped matching Arabic`);
    assert.ok(corpus.includes('عايز اعرف عن منصه ازاي بتشتغل'),
        'canary missing: the corpus must contain the known 11-scenario message, or the extraction is silently broken again');

    const fired = [];
    for (const msg of corpus) {
        const env = await classify(msg);
        if (env.level !== 'trusted') fired.push(`"${msg.slice(0, 56)}" -> ${env.level}: ${env.signals.map((s) => s.kind).join(',')}`);
    }
    const rate = (100 * fired.length) / corpus.length;
    assert.equal(fired.length, 0,
        `${fired.length}/${corpus.length} (${rate.toFixed(2)}%) legitimate messages escalated:\n${fired.slice(0, 12).join('\n')}`);
});
