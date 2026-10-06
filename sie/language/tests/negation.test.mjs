/**
 * negation.test.mjs — G-L1-2 at the detector level.
 *
 * A positive signal whose trigger is negated, questioned or conditional is
 * never reported as positive. The audit's production cases: «جربت الخطوات بس
 * ما اشتغلش» closed the conversation as solved and replied «مبسوط إنها
 * اتظبطت»; «مش عايز اتكلم مع موظف» would have been a request for one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectEmotion, detectResolutionSignal } from '../emotion-detector.js';
import { detectSmallTalk } from '../small-talk.js';

/** [message, what must NOT be reported] — resolution. */
const NOT_RESOLVED = [
    'ما اشتغلش',
    'جربت الخطوات بس ما اشتغلش',
    'جربت الحل بس ما اشتغلش',
    'ماشتغلش',
    'الحل ماشتغلش معايا',
    'مش اشتغل الربط خالص',
    'مش شغال دلوقتي',
    'لسه مش شغال',
    'مبقاش شغال',
    'ما اتحلتش',
    'المشكلة ما اتحلتش',
    'ماتحلتش لسه',
    'متحلتش',
    'ما ظبطتش',
    'لا ما ظبطتش',
    'مظبطتش معايا',
    'الحل مانفعش',
    'مفيش حاجة اشتغلت',
    'ولا حاجة اشتغلت',
    'لم يعمل',
    'لا يعمل',
    'لم يتم حل المشكلة',
    'حلت المشكلة؟ لا',
    'اشتغل ولا لا؟',
    'لما اشتغل على الموبايل بيقفل',
    'لو اشتغل هقولك',
    'تمت عملية الدفع بس الاشتراك مش ظاهر',
    'الطلب تمت الموافقة عليه ومش ظاهر',
    "it didn't work",
    'it is not working',
    'still not fixed'
];

/** Messages that DO say it is solved — the controls. */
const RESOLVED = [
    'اشتغلت',
    'الحمد لله اشتغلت',
    'تم الحل',
    'تمام كده',
    'خلاص اتحلت',
    'مش عارف ازاي بس اشتغلت',
    'مش مصدق، اشتغلت',
    'لا خلاص اشتغلت',
    'بعد ما غيرت الإعدادات اشتغل',
    'ما شاء الله اشتغلت',
    'وشكرا اشتغلت'
];

/** Positive emotion words under negation, in a question or in a condition: never thanks or satisfaction. */
const NOT_POSITIVE_EMOTION = [
    'مش متشكر خالص',
    'ما اشتغلش',
    'مش تمام كده',
    'مش شغال دلوقتي',
    'لسه ماتظبطتش',
    'لما اشتغل على الموبايل بيقفل',
    'اشتغل ولا لا؟'
];

/** Negative emotion words under negation: never that emotion. */
const NOT_EMOTION = [
    ['مش مستعجل خالص', 'urgency'],
    ['الموضوع مش ضروري', 'urgency'],
    ['انا مش زهقان', 'frustration'],
    ['مش قصدي اني زهقت', 'frustration']
];

test('[G-L1-2] a negated, questioned or conditional "it worked" is never a resolution', () => {
    assert.ok(NOT_RESOLVED.length + RESOLVED.length + NOT_POSITIVE_EMOTION.length + NOT_EMOTION.length >= 40);
    const wrong = NOT_RESOLVED.filter((t) => detectResolutionSignal(t) === 'resolved');
    assert.deepEqual(wrong, []);
});

test('[G-L1-2] a negated "it worked" reads as unresolved, not as nothing', () => {
    const negated = ['ما اشتغلش', 'جربت الخطوات بس ما اشتغلش', 'ماشتغلش', 'مش شغال دلوقتي', 'ما اتحلتش', 'الحل مانفعش', "it didn't work"];
    const wrong = negated.filter((t) => detectResolutionSignal(t) !== 'unresolved');
    assert.deepEqual(wrong, []);
});

test('[G-L1-2] a boundary closes the negation: these do say it is solved', () => {
    const wrong = RESOLVED.filter((t) => detectResolutionSignal(t) !== 'resolved');
    assert.deepEqual(wrong, []);
});

test('[G-L1-2] a negated, questioned or conditional positive is never acknowledged as thanks or satisfaction', () => {
    const wrong = NOT_POSITIVE_EMOTION.filter((t) => ['thanks', 'satisfaction'].includes(detectEmotion(t)?.emotion));
    assert.deepEqual(wrong, []);
});

test('[G-L1-2] a negated emotion word is not that emotion', () => {
    const wrong = NOT_EMOTION.filter(([t, e]) => detectEmotion(t)?.emotion === e).map(([t]) => t);
    assert.deepEqual(wrong, []);
});

test('[G-L1-2] "I do NOT want a person" is not a request for a person', () => {
    assert.equal(detectSmallTalk('مش عايز اتكلم مع موظف')?.type ?? null, null);
    assert.equal(detectSmallTalk('لا مش عايز موظف')?.type ?? null, null);
    assert.equal(detectSmallTalk('عايز اتكلم مع موظف')?.type, 'human_request', 'control: the un-negated request still is one');
});
