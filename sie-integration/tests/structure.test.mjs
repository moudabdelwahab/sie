/**
 * structure.test.mjs — where responsibilities live (G-BR-1, G-L6-1).
 * ------------------------------------------------------------
 * The remediation plan moves every customer-facing sentence into Dialogue
 * (L6), every classifier into Language (L1) and every routing decision into
 * Decision (L5), leaving sie-chat-bridge.js as an orchestrator. Behavioural
 * tests prove what a turn does; these prove where the code that does it
 * lives, which no behavioural test can see.
 *
 * Today they are RED by design: the measured violations are pinned, exactly
 * like a red golden run. WP4 (bridge emptied) and WP9 (dialogue
 * consolidation) flip them; adding a new violation in the meantime fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Source with comments removed, so only executable code is measured. */
function code(rel) {
    return read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const ARABIC = /[\u0600-\u06FF]/;

/** Measures the orchestrator's violations of G-BR-1 / G-L6-1. */
export function bridgeViolations() {
    // Log lines are operator text, not customer text: excluded.
    const src = code('sie-integration/sie-chat-bridge.js').split('\n').filter((l) => !/\bconsole\./.test(l)).join('\n');
    const stringLiterals = [...src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]);
    const customerText = stringLiterals.filter((s) => ARABIC.test(s)).length;
    const regexClassifiers = [...src.matchAll(/\/(?![*/])((?:\\.|[^/\n])+)\/[gimsuy]*/g)].filter((m) => ARABIC.test(m[1])).length;
    const body = src.slice(src.indexOf('export async function runSieTurn'));
    const successReturns = [...body.matchAll(/\breturn\s+(?!null\b)([^;]+);/g)].length;
    return { customerText, regexClassifiers, successReturns };
}

/** Customer replies exported from Language (L1) modules instead of living in Dialogue. */
export function languageReplyExports() {
    const found = [];
    for (const [file, name] of [
        ['sie/language/small-talk.js', 'SMALL_TALK_REPLIES'],
        ['sie/language/memory-intent.js', 'MEMORY_REPLIES'],
        ['sie/language/emotion-detector.js', 'EMOTION_ACKNOWLEDGEMENT']
    ]) {
        if (new RegExp(`export const ${name}\\b`).test(read(file))) found.push(name);
    }
    return found;
}

test('[pending:G-BR-1][pending:G-L6-1] RED: the bridge still holds customer text, classifiers and early returns (pinned until WP4/WP9)', () => {
    const v = bridgeViolations();
    // Pinned measurements at WP1. A lower number means progress: update the pin
    // in the same change. A higher number means a new violation: not allowed.
    // successReturns counts every non-null `return` from runSieTurn onward,
    // nested helpers included — a stable measurement, not a semantic one.
    const PINNED = { customerText: 14, regexClassifiers: 19, successReturns: 7 };
    assert.deepEqual(v, PINNED, `bridge violations changed: ${JSON.stringify(v)} (pinned ${JSON.stringify(PINNED)})`);
    assert.ok(v.customerText > 0 && v.regexClassifiers > 0 && v.successReturns > 1, 'still red: when the bridge reaches 0 text, 0 classifiers and 1 success return, replace this test with the green G-BR-1 assertion');
});

test('[pending:G-L6-1] RED: Language modules still export customer replies (pinned until WP9)', () => {
    assert.deepEqual(languageReplyExports(), ['SMALL_TALK_REPLIES', 'MEMORY_REPLIES', 'EMOTION_ACKNOWLEDGEMENT']);
});

test('the structural measurement is not vacuous: it detects a planted violation', () => {
    const planted = "const T = 'تحب أفتحلك تذكرة'; const R = /لأ/; function f() { return { reply: 1 }; }";
    const literals = [...planted.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]).filter((s) => ARABIC.test(s));
    const regexes = [...planted.matchAll(/\/(?![*/])((?:\\.|[^/\n])+)\/[gimsuy]*/g)].filter((m) => ARABIC.test(m[1]));
    assert.equal(literals.length, 1);
    assert.equal(regexes.length, 1);
});
