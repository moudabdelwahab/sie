/**
 * layers-invariant.test.mjs — the invariant normalizer.js promises, on the
 * whole behaviour corpus (the same messages the edition comparator runs).
 *
 *   Pro:  the base canonicals it produces == the base canonicals Free produces
 *   Max:  Free's base canonicals, in order, are all still there; the only
 *         extra base canonicals are targets of Max's SYNONYM entries, and
 *         each sits where Free left the word unresolved.
 *
 * A layer that captured a word the base understands, or a synonym that
 * leaked outside open words, breaks one of these on some real message.
 *
 * @no-legitimate-corpus
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../../language/normalizer.js';
import { buildBehaviorCorpus } from '../../../bench/corpora/behavior.mjs';
import { nodeEdition, readCore, readBaseGlossary, readPack } from './helpers/node-editions.js';
import { SIE_DEFAULT_SETTINGS } from '../../config/settings-schema.js';

const baseGlossary = readBaseGlossary();
const baseCanonicals = new Set(baseGlossary.map((e) => e.canonical));
const messages = buildBehaviorCorpus({ catalog: readCore(), glossary: baseGlossary });
const synonymTargets = new Set(readPack('max').glossary.filter((e) => e.synonym === true).map((e) => e.canonical));

async function baseTokens(edition, text) {
    const { providers } = edition;
    const { normalizedTokens } = await normalize(text, providers);
    return normalizedTokens.map((t) => t.canonical).filter((c) => baseCanonicals.has(c));
}

// Returns the tokens of `longer` left over after matching `shorter` as an
// in-order subsequence, or null if `shorter` is not a subsequence.
function leftoverAfterSubsequence(shorter, longer) {
    const rest = [];
    let i = 0;
    for (const t of longer) {
        if (i < shorter.length && t === shorter[i]) i++;
        else rest.push(t);
    }
    return i === shorter.length ? rest : null;
}

test('the shipped Max pack does carry synonym entries (the test below is not vacuous)', () => {
    assert.ok(synonymTargets.size > 0);
    for (const t of synonymTargets) assert.ok(baseCanonicals.has(t), `${t} is not a base canonical`);
    assert.ok(readPack('pro').glossary.every((e) => e.synonym !== true), 'Pro has no synonyms: its invariant is equality');
});

test('layers invariant on the behaviour corpus: Pro == Free; Max adds only synonym targets', async () => {
    const [free, pro, max] = await Promise.all(['free', 'pro', 'max'].map((e) => nodeEdition(e, SIE_DEFAULT_SETTINGS)));
    const proDiffers = [];
    const maxBreaks = [];
    let maxAdded = 0;
    for (const m of messages) {
        const f = await baseTokens(free, m.text);
        const p = await baseTokens(pro, m.text);
        if (p.join(' ') !== f.join(' ')) proDiffers.push(`«${m.text.slice(0, 60)}» ${f.join(' ')} → ${p.join(' ')}`);
        const x = await baseTokens(max, m.text);
        const extra = leftoverAfterSubsequence(f, x);
        if (extra === null) maxBreaks.push(`lost/reordered «${m.text.slice(0, 60)}» ${f.join(' ')} → ${x.join(' ')}`);
        else {
            const bad = extra.filter((t) => !synonymTargets.has(t));
            if (bad.length) maxBreaks.push(`non-synonym base token added «${m.text.slice(0, 60)}» ${bad.join(' ')}`);
            maxAdded += extra.length;
        }
    }
    assert.deepEqual(proDiffers.slice(0, 10), []);
    assert.deepEqual(maxBreaks.slice(0, 10), []);
    assert.ok(messages.length > 1000, `corpus too small: ${messages.length}`);
    // Informational floor: the synonyms do reach real corpus messages.
    assert.ok(maxAdded > 0, 'no synonym fired on the corpus — the invariant was not exercised');
});
