/**
 * detector-boundaries.test.mjs — G-L1-1 at the detector level.
 *
 * The audit found every conversational detector matching raw substrings:
 * «انصب» (install) read as «نصب» (fraud) → anger → a human; «مشكلة»
 * (problem) read as «مش» (no) → a decline. This file proves, for every
 * detector, that a lexicon phrase never fires from inside a longer word:
 *
 *   1. the cases the audit found, by name;
 *   2. a GENERATED collision corpus: every single-word lexicon phrase ×
 *      every word in the glossary, the catalog (labels and answers) and
 *      the precision corpus that contains it as a substring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectSmallTalk, SMALL_TALK_CATEGORIES } from '../small-talk.js';
import { detectEmotion, detectResolutionSignal, EMOTION_CATEGORIES, RESOLVED_PHRASES } from '../emotion-detector.js';
import { detectMemoryIntent, SAVE_TRIGGERS, RECALL_TRIGGERS, FORGET_TRIGGERS } from '../memory-intent.js';
import { replyPolarity } from '../reply-polarity.js';
import { foldForMatch, tokenizeForMatch } from '../lexicon-match.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

/** Every folded Arabic/Latin word the engine's own data contains. */
function wordlist() {
    const words = new Set();
    const add = (text) => { for (const t of tokenizeForMatch(text)) if (!t.punct && t.t.length >= 2) words.add(t.t); };
    for (const e of readJson('sie/language/data/technical-glossary.json').entries) for (const p of e.patterns) add(p);
    const catalog = readJson('sie/scenarios/scenario-catalog.data/scenarios.json');
    for (const s of (Array.isArray(catalog) ? catalog : catalog.scenarios)) {
        add(s.label?.ar); add(s.label?.en); add(s.resolution?.text?.ar);
    }
    const corpus = readJson('sie/language/tests/fixtures/precision-corpus.json');
    for (const c of corpus.cores) add(c);
    return [...words].sort();
}
const WORDS = wordlist();

/** The single-word phrases of a lexicon, folded. */
const singleWords = (phrases) => new Set(phrases.map((p) => tokenizeForMatch(p).filter((t) => !t.punct).map((t) => t.t)).filter((w) => w.length === 1).map((w) => w[0]));

/** Words that contain `phrase` strictly inside them (not the phrase, not the phrase with «و»/«ف»). */
function containing(phrase, ownWords) {
    return WORDS.filter((w) => w !== phrase && w.includes(phrase) && w !== `و${phrase}` && w !== `ف${phrase}` && !ownWords.has(w)
        && !ownWords.has(w.replace(/^[وف]/, '')));
}

function collisions(lexicon, fires) {
    const own = singleWords(lexicon);
    const wrong = [];
    for (const phrase of own) {
        for (const w of containing(phrase, own)) if (fires(w)) wrong.push(`${phrase} ⊂ ${w}`);
    }
    return wrong;
}

test('[G-L1-1] the audit\'s collisions: «انصب» is not fraud, «مشكلة» is not a no, «اهتمام» is not a yes', () => {
    assert.equal(detectEmotion('ازاي انصب الواتساب بزنس'), null);
    assert.equal(detectEmotion('عايز انصب البرنامج على الكمبيوتر'), null);
    assert.equal(replyPolarity('عندي مشكلة'), null);
    assert.equal(replyPolarity('مشكلة'), null);
    assert.equal(replyPolarity('محتاج اهتمام بالموضوع ده'), null);
    assert.equal(replyPolarity('تمت الموافقة عليه ومش ظاهر', { diagnosticContent: true }), null);
    assert.notEqual(detectResolutionSignal('اتمت العملية'), 'resolved');
    assert.equal(detectSmallTalk('مهلا'), null, '«هلا» is not in «مهلا»');
});

test('[G-L1-1] collision corpus: no small-talk phrase fires from inside a longer word', () => {
    const lexicon = SMALL_TALK_CATEGORIES.flatMap((c) => c.phrases);
    assert.ok(WORDS.length > 2000, `the corpus is too small to mean anything (${WORDS.length} words)`);
    assert.deepEqual(collisions(lexicon, (w) => detectSmallTalk(w) !== null), []);
});

test('[G-L1-1] collision corpus: no emotion phrase fires from inside a longer word', () => {
    const lexicon = EMOTION_CATEGORIES.flatMap((c) => c.phrases);
    assert.deepEqual(collisions(lexicon, (w) => detectEmotion(w) !== null), []);
});

test('[G-L1-1] collision corpus: no resolution phrase reads "resolved" from inside a longer word', () => {
    assert.deepEqual(collisions(RESOLVED_PHRASES, (w) => detectResolutionSignal(w) === 'resolved'), []);
});

test('[G-L1-1] collision corpus: no memory trigger fires from inside a longer word', () => {
    const lexicon = [...SAVE_TRIGGERS, ...RECALL_TRIGGERS, ...FORGET_TRIGGERS];
    assert.deepEqual(collisions(lexicon, (w) => detectMemoryIntent(w) !== null), []);
});

test('[G-L1-1] collision corpus: no yes/no word gives a reply polarity from inside a longer word', () => {
    // The words the confirmation classifier has always keyed on.
    const POLARITY_WORDS = ['لا', 'مش', 'اه', 'نعم', 'تمام', 'صح', 'اوك', 'ايوه', 'موافق', 'no', 'yes', 'ok'].map(foldForMatch);
    // Words that contain one of those and ARE themselves a yes or a no.
    const ALSO_POLARITY = new Set(['لاء', 'اوكي', 'okay', 'not']);
    const own = new Set([...POLARITY_WORDS, ...ALSO_POLARITY]);
    const wrong = [];
    for (const word of POLARITY_WORDS) {
        for (const w of containing(word, own)) if (replyPolarity(w) !== null) wrong.push(`${word} ⊂ ${w} → ${replyPolarity(w)}`);
    }
    assert.deepEqual(wrong, []);
});
