/**
 * lexicon-match.test.mjs — the one matcher every Layer-1 detector uses.
 *
 * The detector-level consequences (no anger for «انصب», no "it worked" for
 * «ما اشتغلش») are in detector-boundaries.test.mjs and negation.test.mjs.
 * This file pins the primitive itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    analyzeMessage, findPhrase, firstPhrase, phraseWords, foldForMatch, tokenizeForMatch,
    isFusedNegative, NEGATION_WINDOW, hasDiagnosticContent, isDiagnosticToken
} from '../lexicon-match.js';

const hits = (text, phrase) => findPhrase(analyzeMessage(text), phrase);

test('[G-L1-1] a phrase never matches inside a longer word', () => {
    assert.deepEqual(hits('ازاي انصب الواتساب بزنس', 'نصب'), [], '«نصب» is not in «انصب»');
    assert.deepEqual(hits('عندي مشكلة في الدفع', 'مش'), [], '«مش» is not in «مشكلة»');
    assert.deepEqual(hits('الشغل مشغول', 'مش'), []);
    assert.deepEqual(hits('تم الحلول', 'تم الحل'), [], 'a multi-word phrase needs every word whole');
    assert.deepEqual(hits('اتمت العملية', 'تمت'), []);
    assert.deepEqual(hits('هلاك', 'هلا'), []);
    assert.deepEqual(hits('mynotes', 'no'), []);
});

test('[G-L1-1] a phrase matches as whole words, with diacritics, stretching and an attached «و»/«ف»', () => {
    assert.equal(hits('ده نصب', 'نصب').length, 1);
    assert.equal(hits('وشكرا', 'شكرا').length, 1);
    assert.equal(hits('فاشتغلت', 'اشتغلت').length, 1);
    assert.equal(hits('شكرًا', 'شكرا').length, 1, 'tanween is folded away');
    assert.equal(hits('مرحبااااا', 'مرحبا').length, 1, 'three or more repeats are emphasis');
    assert.equal(hits('تم، الحل', 'تم الحل').length, 1, 'punctuation between the words does not break the phrase');
    assert.equal(hits('أهلاً', 'اهلا').length, 1);
    // The conjunction is allowed on the FIRST word only.
    assert.deepEqual(hits('تم والحل', 'تم الحل'), []);
});

test('[G-L1-1] folding and tokenizing are total', () => {
    assert.equal(foldForMatch(null), '');
    assert.equal(foldForMatch(undefined), '');
    assert.deepEqual(tokenizeForMatch(''), []);
    assert.deepEqual(phraseWords('  '), []);
    assert.deepEqual(hits('anything', ''), []);
    assert.equal(firstPhrase(analyzeMessage('اهلا'), ['مرحبا', 'اهلا']).phrase, 'اهلا');
    assert.equal(firstPhrase(analyzeMessage('اهلا'), ['مرحبا']), null);
});

/**
 * The negation table. Each row: message, phrase, whether the phrase is
 * negated there. Egyptian first, MSA and English after, with the boundaries
 * that must CLOSE a scope as controls.
 */
const NEGATION_TABLE = [
    // Egyptian «مش»
    ['مش شغال', 'شغال', true],
    ['لسه مش شغال', 'شغال', true],
    ['الواتساب مش بيبعت رسايل', 'بيبعت', true],
    ['مش قادر ادخل', 'ادخل', true],
    ['مش عايز اتكلم مع حد', 'عايز اتكلم مع حد', true],
    ['مش تمام كده', 'تمام كده', true],
    ['مش متشكر', 'متشكر', true],
    // Egyptian «ما … ش», split and fused
    ['ما اشتغلش', 'اشتغل', true],
    ['جربت الخطوات بس ما اشتغلش', 'اشتغل', true],
    ['ماشتغلش', 'اشتغل', true],
    ['الحل مانفعش', 'انفع', true],
    ['ما اتحلتش', 'اتحلت', true],
    ['ماتحلتش', 'اتحلت', true],
    ['مبيشتغلش', 'بيشتغل', true],
    ['ما ظبطش', 'ظبط', true],
    ['ماظبطتش', 'ظبطت', true],
    ['مبقاش شغال', 'شغال', true],
    ['مابقاش شغال', 'شغال', true],
    ['مفيش حاجة اشتغلت', 'اشتغلت', true],
    ['مافيش رد', 'رد', true],
    ['ولا حاجة اشتغلت', 'اشتغلت', true],
    ['انا المدير ومش قادر اضيف موظف', 'قادر', true],
    ['وما اشتغلش برضه', 'اشتغل', true],
    // MSA
    ['لم يعمل', 'يعمل', true],
    ['لا يعمل', 'يعمل', true],
    ['لن يعمل', 'يعمل', true],
    ['ليس شغال', 'شغال', true],
    ['بدون فايدة', 'فايدة', true],
    // English
    ['it did not work', 'work', true],
    ["it didn't work", 'work', true],
    ['it doesnt work', 'work', true],
    ['never worked', 'worked', true],
    ['not fixed', 'fixed', true],
    // Controls — a boundary closes the scope, or there is no negation at all
    ['اشتغلت الحمد لله', 'اشتغلت', false],
    ['مش عارف ازاي بس اشتغلت', 'اشتغلت', false],
    ['مش مصدق، اشتغلت', 'اشتغلت', false],
    ['مش عارف ليه ولكن اشتغلت', 'اشتغلت', false],
    ['مش بيبعت رسايل وهرفع عليكم قضية', 'هرفع عليكم قضية', false], // an attached «و» opens a clause
    ['لا خلاص اشتغلت', 'اشتغلت', false],
    ['بعد ما غيرت الإعدادات اشتغل', 'اشتغل', false],
    ['ما شاء الله اشتغلت', 'اشتغلت', false],
    ['كل ما افتح التطبيق بيقفل', 'بيقفل', false],
    ['مش قادر افهم الخطوات الكتير دي بجد شغال', 'شغال', false], // beyond the window
    ['it works', 'works', false]
];

test('[G-L1-2] the negation table: a phrase in a negation scope is negated, and a boundary closes the scope', () => {
    assert.ok(NEGATION_TABLE.length >= 40, `the table has ${NEGATION_TABLE.length} rows; the plan requires at least 40`);
    const wrong = [];
    for (const [text, phrase, negated] of NEGATION_TABLE) {
        const found = hits(text, phrase);
        if (found.length === 0) { wrong.push(`${text} | ${phrase}: not found`); continue; }
        if (found[0].negated !== negated) wrong.push(`${text} | ${phrase}: negated=${found[0].negated}, want ${negated}`);
    }
    assert.deepEqual(wrong, []);
});

test('[G-L1-2] the scope reaches NEGATION_WINDOW words, and «لا» reaches one', () => {
    assert.equal(NEGATION_WINDOW, 4);
    const a = analyzeMessage('مش w1 w2 w3 w4 w5');
    assert.deepEqual(a.negatedAt, [false, true, true, true, true, false]);
    const b = analyzeMessage('لا يعمل الحل');
    assert.deepEqual(b.negatedAt, [false, true, false]);
    assert.equal(isFusedNegative('ماشتغلش'), true);
    assert.equal(isFusedNegative('مش'), false, 'too short: «مش» itself is a negator word, not a fused form');
    assert.equal(isFusedNegative('اشتغل'), false);
});

test('[G-L1-2] a phrase in a question or a condition is not asserted', () => {
    const q = hits('حلت المشكلة؟ لا', 'حلت')[0];
    assert.equal(q.question, true);
    assert.equal(q.asserted, false);
    const q2 = hits('اشتغل ولا لا؟', 'اشتغل')[0];
    assert.equal(q2.asserted, false, 'the question mark covers its whole sentence');
    const c = hits('لما اشتغل على الموبايل بيقفل', 'اشتغل')[0];
    assert.equal(c.conditional, true);
    assert.equal(c.asserted, false);
    assert.equal(hits('لو سمحت اشتغل', 'اشتغل')[0].asserted, true, '«لو سمحت» is "please", not a condition');
    assert.equal(hits('اشتغلت. هل في حاجة تانية؟', 'اشتغلت')[0].asserted, true, 'a later question does not reach back');
});

test('[G-L1-3] diagnostic content is any problem-describing token; conversational families do not count', () => {
    assert.equal(isDiagnosticToken({ canonical: 'entity_whatsapp' }), true);
    assert.equal(isDiagnosticToken({ canonical: 'symptom_not_sending' }), true);
    assert.equal(isDiagnosticToken({ canonical: 'intent_how_to' }), true);
    assert.equal(isDiagnosticToken({ canonical: 'social_greeting_extended' }), false);
    assert.equal(isDiagnosticToken({ canonical: 'trigger_neutral_ack' }), false);
    assert.equal(isDiagnosticToken({ canonical: 'emotion_anger' }), false);
    assert.equal(isDiagnosticToken({ canonical: 'اهلا' }), false, 'an unresolved word is not evidence');
    assert.equal(hasDiagnosticContent([{ canonical: 'اهلا' }, { canonical: 'entity_whatsapp' }]), true);
    assert.equal(hasDiagnosticContent([{ canonical: 'social_greeting_extended' }]), false);
    assert.equal(hasDiagnosticContent(null), false);
});

test('[G-L1-8] analyzeMessage is deterministic and total', () => {
    const inputs = [null, undefined, '', ' ', 42, {}, [], '؟؟؟', '!!!', '‏‎', '😡😡', 'a'.repeat(10000),
        'و و و و و و و و و و', 'مش '.repeat(500), '\ud800', 'ﻻ', 'مَشْ شَغّالْ'];
    for (const input of inputs) {
        const first = analyzeMessage(input);
        const second = analyzeMessage(input);
        assert.deepEqual(first, second);
        assert.equal(first.words.length, first.negatedAt.length);
    }
});
