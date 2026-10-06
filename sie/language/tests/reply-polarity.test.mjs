/**
 * reply-polarity.test.mjs — G-L1-4 and G-L1-5.
 *
 * At a yes/no prompt the engine has to know which one the customer said.
 * The audit (D1, D2) found the bridge's classifier reading «لا» as unclear
 * (an ASCII `\b` never matches after an Arabic letter), «اه» as unclear, and
 * «أيوه عندي مشكلة» as a NO — because «مشكلة» contains «مش».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { replyPolarity } from '../reply-polarity.js';
import { detectResolutionSignal } from '../emotion-detector.js';
import { TICKET_CONFIRM_OPTIONS } from '../../dialogue/templates/conversational.js';
import { ar } from '../../dialogue/templates/ar.js';
import { en } from '../../dialogue/templates/en.js';

const PLAIN = [
    ['لا', 'no'], ['لأ', 'no'], ['لاء', 'no'], ['لا.', 'no'], ['لا شكرا', 'no'], ['لأ مش عايز', 'no'],
    ['مش دلوقتي', 'no'], ['no', 'no'], ['No', 'no'], ['nope', 'no'], ['no thanks', 'no'],
    ['اه', 'yes'], ['آه', 'yes'], ['ايوه', 'yes'], ['أيوه', 'yes'], ['ايوا', 'yes'], ['أيوة', 'yes'], ['نعم', 'yes'],
    ['اه طبعا', 'yes'], ['موافق', 'yes'], ['تمام', 'yes'], ['ماشي', 'yes'], ['اوكي', 'yes'], ['ok', 'yes'],
    ['yes', 'yes'], ['Yes please', 'yes'], ['y', 'yes'], ['اكيد', 'yes'], ['صح', 'yes'],
    ['', null], ['متشكر', null], ['مش فاهم السؤال', null], ['؟', null]
];

test('[G-L1-5] plain yes and no words classify correctly', () => {
    const wrong = PLAIN.filter(([text, want]) => replyPolarity(text) !== want).map(([t, w]) => `${JSON.stringify(t)} → ${replyPolarity(t)} (want ${w})`);
    assert.deepEqual(wrong, []);
});

test('[G-L1-5] content without a leading yes/no has no polarity; a leading yes/no still counts', () => {
    // «مشكلة» contains «مش», «الواتساب مش بيبعت» negates a verb, not the question.
    assert.equal(replyPolarity('الواتساب مش بيبعت رسايل', { diagnosticContent: true }), null);
    assert.equal(replyPolarity('عندي مشكلة في الدفع', { diagnosticContent: true }), null);
    assert.equal(replyPolarity('الدفع تمام بس الاشتراك مش ظاهر', { diagnosticContent: true }), null);
    assert.equal(replyPolarity('أيوه عندي مشكلة في الدفع', { diagnosticContent: true }), 'yes');
    assert.equal(replyPolarity('أيوه، افتحلي تذكرة', { diagnosticContent: true }), 'yes');
    assert.equal(replyPolarity('لا مش عايز تذكرة', { diagnosticContent: true }), 'no');
});

test('[G-L1-5] a negated yes is a no', () => {
    assert.equal(replyPolarity('مش موافق'), 'no');
    assert.equal(replyPolarity('لا مش تمام'), 'no');
});

test('[G-L1-4] every ticket-confirmation button classifies to its intended polarity', () => {
    const want = { ar: ['yes', 'no'], en: ['yes', 'no'] };
    for (const lang of ['ar', 'en']) {
        assert.equal(TICKET_CONFIRM_OPTIONS[lang].length, 2);
        TICKET_CONFIRM_OPTIONS[lang].forEach((opt, i) => {
            assert.equal(replyPolarity(opt.value), want[lang][i], `${lang} value "${opt.value}"`);
            // The button text, typed by hand, means the same thing.
            assert.equal(replyPolarity(opt.label.replace(/\[\[[^\]]+\]\]/g, '').trim()), want[lang][i], `${lang} label "${opt.label}"`);
        });
    }
});

test('[G-L1-4] every verification button classifies to its intended polarity', () => {
    const decision = { scenarioLabel: { ar: 'الدفع', en: 'payment' } };
    for (const tpl of [ar, en]) {
        const [yes, no] = tpl.VERIFY_INFORMATION(decision).options;
        assert.equal(replyPolarity(yes.value), 'yes', `"${yes.value}"`);
        assert.equal(replyPolarity(no.value), 'no', `"${no.value}"`);
    }
});

test('[G-L1-4] every "did that solve it?" button reads as the resolution it offers', () => {
    const decision = { action: 'ANSWER', scenarioLabel: { ar: 'الدفع', en: 'payment' }, resolution: { text: { ar: 'خطوات', en: 'steps' } } };
    for (const tpl of [ar, en]) {
        const { options } = tpl.ANSWER(decision);
        assert.equal(options.length, 2);
        assert.equal(detectResolutionSignal(options[0].value), 'resolved', `"${options[0].value}"`);
        assert.equal(detectResolutionSignal(options[1].value), 'unresolved', `"${options[1].value}"`);
    }
});
