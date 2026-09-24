/**
 * test-quality.test.mjs — testing the tests.
 *
 *   1. every test asserts something (or calls a same-file helper that does,
 *      or runs a command that fails loudly) — a test with no assertion
 *      passes forever;
 *   2. no file carrying an attack string is counted as legitimate traffic:
 *      every such file declares @no-legitimate-corpus, which is what the
 *      trust layer's false-positive measurement relies on;
 *   3. the behaviour corpus behind the comparator and the no-regression gate
 *      contains no attack string — an attack in the "legitimate" corpus
 *      would make a regression look like a detection;
 *   4. the phrasing benchmark cannot quietly become circular: every
 *      phrasing that mostly copies its scenario's own label must have an
 *      independent held-out paraphrase (pack-phrasings.test.mjs measures
 *      those separately, as a floor, never tuned against).
 *
 * The complementary check — that the key gates actually FAIL when what they
 * guard is broken — is scripts/mutation-check.mjs (slow; run before release)
 * and audit-rules.test.mjs (fast; every audit gate shown to fire).
 *
 * @no-legitimate-corpus — contains attack strings by import.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ATTACKS } from '../../trust/tests/fixtures/adversarial-corpus.mjs';
import { PACK_ATTACKS } from './fixtures/edition-attacks.mjs';
import { buildBehaviorCorpus } from '../../../bench/corpora/behavior.mjs';
import { readCore, readBaseGlossary, readPack } from './helpers/node-editions.js';
import { readPhrasings } from './helpers/phrasings.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'results']);

function walk(dir, pred, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, pred, out);
        else if (pred(p)) out.push(p);
    }
    return out;
}
const rel = (p) => path.relative(ROOT, p);

// ── 1 ─────────────────────────────────────────────────────────────────────

const ASSERTS = /\bassert\b|\bexpect\(|\.throws\(|\.rejects\(|execFileSync\(|execSync\(/;

test('every test asserts something', () => {
    const offenders = [];
    let tests = 0;
    for (const f of walk(ROOT, (p) => p.endsWith('.test.mjs'))) {
        const src = fs.readFileSync(f, 'utf8');
        // Same-file helpers whose own body asserts count as assertions.
        const helpers = [];
        for (const m of src.matchAll(/(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|(?:^|\n)const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g)) {
            const name = m[1] || m[2];
            const rest = src.slice(m.index, m.index + 3000);
            const end = rest.search(/\n(?:async\s+)?function\s|\ntest\(|\nconst\s+[A-Za-z_$][\w$]*\s*=/);
            if (ASSERTS.test(end > 0 ? rest.slice(0, end) : rest)) helpers.push(name);
        }
        const helperCall = helpers.length ? new RegExp(`\\b(?:${helpers.join('|')})\\(`) : null;
        const starts = [...src.matchAll(/(^|\n)[ \t]*(?:test|it)\(\s*[`'"]/g)].map((m) => m.index);
        starts.forEach((start, i) => {
            tests += 1;
            const body = src.slice(start, starts[i + 1] ?? src.length);
            if (!ASSERTS.test(body) && !(helperCall && helperCall.test(body))) {
                offenders.push(`${rel(f)}: ${body.trim().split('\n')[0].slice(0, 90)}`);
            }
        });
    }
    assert.ok(tests > 900, `found only ${tests} tests — the scanner is broken`);
    assert.deepEqual(offenders, []);
});

// ── 2 + 3 ─────────────────────────────────────────────────────────────────

// Controls in the attack corpus (minLevel null: "must NOT fire", e.g. «انا
// صاحب الحساب ومش عارف ادخل») are legitimate messages by design, and are
// meant to appear in ordinary tests too.
const attackTexts = [...ATTACKS.filter((a) => a.minLevel !== null), ...PACK_ATTACKS]
    .map((a) => a.text)
    .filter((t) => typeof t === 'string' && t.length >= 16)
    // Repetition pumps are the same short phrase many times; match one run.
    .map((t) => (t.length > 200 ? t.slice(0, 60) : t));

test('every file containing an attack string declares @no-legitimate-corpus', () => {
    assert.ok(attackTexts.length >= 35, `only ${attackTexts.length} attack strings — the filter is broken`);
    const offenders = [];
    for (const f of walk(ROOT, (p) => /\.(m?js|json)$/.test(p))) {
        const src = fs.readFileSync(f, 'utf8');
        if (src.includes('@no-legitimate-corpus')) continue;
        const hit = attackTexts.find((t) => src.includes(t));
        if (hit) offenders.push(`${rel(f)}: «${hit.slice(0, 50)}»`);
    }
    assert.deepEqual(offenders, []);
});

test('the behaviour corpus (comparator, no-regression gate) contains no attack', () => {
    const corpus = buildBehaviorCorpus({ catalog: readCore(), glossary: readBaseGlossary() });
    assert.ok(corpus.length > 5000);
    const leaked = corpus.filter((m) => attackTexts.some((t) => m.text.includes(t) || t.includes(m.text) && m.text.length > 24));
    assert.deepEqual(leaked.map((m) => m.text), []);
});

// ── 4 ─────────────────────────────────────────────────────────────────────

const norm = (t) => new Set(String(t).replace(/[«»"'؟?.,،:!—-]/g, ' ').replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي').replace(/[ً-ْ]/g, '').split(/\s+/).filter(Boolean));

for (const pack of ['pro', 'max']) {
    test(`${pack}: phrasings that copy their label have an independent held-out paraphrase`, () => {
        const labels = new Map(readPack(pack).scenarios.map((s) => [s.id, s.label.ar]));
        const heldOut = new Map(readPhrasings(`${pack}_heldout`));
        const missing = [];
        for (const [id, text] of readPhrasings(pack)) {
            const a = norm(text), b = norm(labels.get(id));
            const jaccard = [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size;
            if (jaccard < 0.75) continue;
            const h = heldOut.get(id);
            if (!h) { missing.push(`${id}: «${text}»`); continue; }
            // The held-out paraphrase must itself avoid the label.
            const c = norm(h);
            const j2 = [...c].filter((x) => b.has(x)).length / new Set([...c, ...b]).size;
            if (j2 >= 0.5) missing.push(`${id}: held-out «${h}» still copies the label (${j2.toFixed(2)})`);
        }
        assert.deepEqual(missing, []);
    });
}
