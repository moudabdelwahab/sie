/**
 * typo-integration.test.mjs — G-L1-9: typo tolerance is wired into the
 * glossary lookup, behind a setting, and is shown to be useful and safe.
 *
 * Owner decision (2026-10-06): keep typo-tolerance.js and integrate it,
 * with tests proving it is useful and safe. Before WP3 it was imported by
 * nothing.
 *
 *   useful  a misspelled glossary word that resolves to nothing without the
 *           setting resolves to its intended canonical with it;
 *   safe    the setting is off by default; with it on, nothing that already
 *           resolved changes, no conversational or function word is ever
 *           "corrected", only a problem-describing canonical can be produced,
 *           and the evidence it yields weighs less than an exact match.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize } from '../normalizer.js';
import { normalizeArabicToken } from '../dialect-normalizer.js';
import { providers } from './helpers/read-signals.js';
import { isDiagnosticToken, tokenizeForMatch } from '../lexicon-match.js';
import { BASE_WEIGHT_BY_SOURCE, extractTextEvidence } from '../../diagnostics/evidence-extractor.js';
import { SMALL_TALK_CATEGORIES } from '../small-talk.js';
import { EMOTION_CATEGORIES, RESOLVED_PHRASES, UNRESOLVED_PHRASES } from '../emotion-detector.js';
import { SETTINGS } from '../../config/settings-schema.js';
import { OBSERVED_PRESENCE_MIN } from '../../editions/stand-off.js';

const glossary = JSON.parse(fs.readFileSync(new URL('../data/technical-glossary.json', import.meta.url), 'utf8')).entries;
const corpus = JSON.parse(fs.readFileSync(new URL('./fixtures/precision-corpus.json', import.meta.url), 'utf8'));

const run = (text, typoTolerance) => normalize(text, { ...providers, ...(typoTolerance === undefined ? {} : { typoTolerance }) });
const canon = (r) => r.normalizedTokens.map((t) => `${t.canonical}/${t.source}`);

/**
 * Generated misspellings: for every single-word Arabic glossary pattern of a
 * problem-describing canonical, long enough to misspell (≥ 6 letters), drop
 * one interior letter or swap two adjacent interior letters. A variant that
 * is itself a known word is not a typo and is skipped.
 */
function misspellings() {
    const known = new Set();
    for (const e of glossary) for (const p of e.patterns) for (const w of p.split(/\s+/)) { const n = normalizeArabicToken(w); if (n) known.add(n); }
    const out = [];
    for (const e of glossary) {
        if (!isDiagnosticToken({ canonical: e.canonical })) continue;
        for (const p of e.patterns) {
            if (/\s/.test(p) || !/[؀-ۿ]/.test(p)) continue;
            const word = normalizeArabicToken(p);
            if (!word || word.length < 6) continue;
            for (let i = 1; i < word.length - 1; i++) {
                const dropped = word.slice(0, i) + word.slice(i + 1);
                const swapped = word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
                for (const v of [dropped, swapped]) if (v !== word && !known.has(v)) out.push({ typo: v, intended: e.canonical });
            }
        }
    }
    return out;
}

test('[G-L1-9] the setting exists, is off by default, and normalize() is unchanged when it is off', async () => {
    const setting = SETTINGS.find((s) => s.key === 'language_typo_tolerance');
    assert.ok(setting, 'language_typo_tolerance is a registered setting');
    assert.equal(setting.default, false);
    for (const text of corpus.cores) {
        assert.deepEqual(canon(await run(text)), canon(await run(text, false)), text);
    }
});

test('[G-L1-9] useful: misspelled problem words that resolve to nothing without the setting resolve to the intended canonical with it', async () => {
    const cases = misspellings();
    let unresolved = 0;
    let right = 0;
    let wrong = 0;
    for (const { typo, intended } of cases) {
        const off = (await run(typo, false)).normalizedTokens;
        // A misspelling the existing normalization already resolves is not
        // this feature's to fix (and must stay exactly as it was — see below).
        if (off.length === 1 && off[0].canonical !== normalizeArabicToken(off[0].raw)) continue;
        unresolved += 1;
        const [tok] = (await run(typo, true)).normalizedTokens;
        if (tok?.canonical === intended) right += 1;
        else if (tok?.source === 'typo') wrong += 1;
    }
    assert.ok(unresolved >= 1000, `${unresolved} generated misspellings that nothing else resolves`);
    // Measured 2026-10-06: 1,360 of 2,005 recovered (67.8%), 7 mis-corrected (0.35%).
    assert.ok(right / unresolved >= 0.6, `recovered ${right}/${unresolved}`);
    assert.ok(wrong / unresolved <= 0.01, `mis-corrected ${wrong}/${unresolved}`);
});

test('[G-L1-9] useful: a real misspelling reaches diagnosis', async () => {
    const text = 'الواتسب مش بيبعت رسايل';
    assert.ok(!(await run(text, false)).normalizedTokens.some((t) => t.canonical === 'entity_whatsapp'), 'without the setting the entity is lost');
    const r = await run(text, true);
    assert.ok(r.normalizedTokens.some((t) => t.canonical === 'entity_whatsapp' && t.source === 'typo'), JSON.stringify(canon(r)));
});

test('[G-L1-9] safe: with the setting on, every token that already resolved is unchanged, and only unresolved words can change', async () => {
    const messages = corpus.cores.flatMap((c) => corpus.frames.map((f) => f.replace('{core}', c)));
    for (const text of messages) {
        const off = (await run(text, false)).normalizedTokens;
        const on = (await run(text, true)).normalizedTokens;
        assert.equal(on.length, off.length, text);
        on.forEach((t, i) => {
            if (t.source === 'typo') {
                assert.equal(off[i].source, 'arabic', `${text}: only an unresolved Arabic word may be corrected`);
                assert.equal(off[i].canonical, normalizeArabicToken(off[i].raw), `${text}: "${off[i].raw}" had resolved`);
                assert.ok(isDiagnosticToken(t), `${text}: a typo may only produce a problem-describing canonical, got ${t.canonical}`);
            } else {
                assert.deepEqual(t, off[i], text);
            }
        });
    }
});

test('[G-L1-9] safe: no conversational or function word is ever corrected', async () => {
    const words = new Set(['انا', 'انت', 'ازاي', 'عايز', 'عاوز', 'محتاج', 'دلوقتي', 'النهارده', 'امبارح', 'بتاعي', 'بتاعكم', 'علشان', 'عشان', 'كمان', 'برضه', 'خالص', 'بصراحه',
        'معلش', 'لوسمحت', 'حضرتك', 'الحمد', 'مستعجل', 'زهقت', 'بقالي', 'جربت', 'حاولت', 'لسه', 'كتير', 'شويه']);
    for (const list of [SMALL_TALK_CATEGORIES.flatMap((c) => c.phrases), EMOTION_CATEGORIES.flatMap((c) => c.phrases), RESOLVED_PHRASES, UNRESOLVED_PHRASES]) {
        for (const p of list) for (const t of tokenizeForMatch(p)) if (!t.punct) words.add(t.t);
    }
    const corrected = [];
    for (const w of words) {
        const tokens = (await run(w, true)).normalizedTokens;
        if (tokens.some((t) => t.source === 'typo')) corrected.push(`${w} → ${tokens.map((t) => t.canonical).join(' ')}`);
    }
    assert.deepEqual(corrected, []);
});

test('[G-L1-9] safe: typo evidence weighs less than an exact or an Arabic match (and not below the stand-off floor), and is deterministic', async () => {
    assert.ok(BASE_WEIGHT_BY_SOURCE.typo < BASE_WEIGHT_BY_SOURCE.arabic);
    assert.ok(BASE_WEIGHT_BY_SOURCE.typo <= BASE_WEIGHT_BY_SOURCE.arabizi);
    assert.ok(BASE_WEIGHT_BY_SOURCE.typo >= OBSERVED_PRESENCE_MIN, 'the editions\' stand-off rule requires every weight ≥ 0.75');
    const r = await run('الواتسب واقف', true);
    const [ev] = extractTextEvidence(r.normalizedTokens.filter((t) => t.source === 'typo'), 1);
    assert.equal(ev?.weight, BASE_WEIGHT_BY_SOURCE.typo);
    assert.deepEqual(canon(await run('الواتسب واقف', true)), canon(r));
});
