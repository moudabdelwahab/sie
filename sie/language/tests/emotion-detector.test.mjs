import test from 'node:test';
import assert from 'node:assert/strict';
import {
    detectEmotion,
    acknowledgementFor,
    shouldEscalateForEmotion,
    EMOTION_ACKNOWLEDGEMENT,
    ESCALATING_EMOTIONS
} from '../emotion-detector.js';

// ── الحالات الست ────────────────────────────────────────────────────

test('detectEmotion: يقرا الغضب', () => {
    const signal = detectEmotion('ده استهبال بصراحة وهلغي الاشتراك');
    assert.equal(signal.emotion, 'anger');
    assert.equal(signal.negative, true);
});

test('detectEmotion: يقرا الإحباط', () => {
    const signal = detectEmotion('كل مرة نفس المشكلة وانا بعتلكم كذا مرة');
    assert.equal(signal.emotion, 'frustration');
});

test('detectEmotion: يقرا الاستعجال', () => {
    const signal = detectEmotion('محتاج حل النهاردة الشغل واقف والعملاء مستنيين');
    assert.equal(signal.emotion, 'urgency');
});

test('detectEmotion: يقرا الشكر', () => {
    const signal = detectEmotion('شكرا ليك على المساعدة');
    assert.equal(signal.emotion, 'thanks');
    assert.equal(signal.negative, false);
});

test('detectEmotion: يقرا الرضا', () => {
    const signal = detectEmotion('الحمد لله اشتغلت');
    assert.equal(signal.emotion, 'satisfaction');
    assert.equal(signal.negative, false);
});

// ── السخرية: أهم حاجة في الموديول ده ─────────────────────────────────

test('detectEmotion: السخرية بتكسب الشكر، مش العكس', () => {
    // لو الترتيب اتعكس، المحرك هيرد «تسلم!» على عميل غضبان.
    const signal = detectEmotion('شكرا على الخدمة الممتازة دي، اسبوع وانتوا بتردوا');
    assert.equal(signal.emotion, 'sarcasm');
    assert.equal(signal.negative, true, 'السخرية لازم تتحسب سلبية');
});

test('detectEmotion: مدح حقيقي يفضل مدح', () => {
    const signal = detectEmotion('شكرا على الشرح');
    assert.equal(signal.emotion, 'thanks');
});

// ── مش small talk ───────────────────────────────────────────────────

test('detectEmotion: بيشتغل على الرسايل الطويلة اللي فيها مشكلة حقيقية', () => {
    // small-talk.js عنده حد أقصى للكلمات، فمش هيشوف الرسالة دي أصلاً.
    const long = 'الموقع واقف من امبارح وانا مستعجل جدا والعملاء بيزعقولي '
        + 'وانا مش عارف اقولهم ايه وده بيأثر على شغلي كله';
    assert.ok(long.split(/\s+/).length > 6, 'الرسالة لازم تكون أطول من حد الـ small talk');
    const signal = detectEmotion(long);
    assert.equal(signal.emotion, 'urgency');
});

test('detectEmotion: الرسالة العادية مالهاش نبرة', () => {
    assert.equal(detectEmotion('ازاي اربط رقم واتساب جديد'), null);
});

test('detectEmotion: الرسالة الفاضية مالهاش نبرة', () => {
    assert.equal(detectEmotion(''), null);
    assert.equal(detectEmotion(null), null);
    assert.equal(detectEmotion('   '), null);
});

// ── الشدة ───────────────────────────────────────────────────────────

test('detectEmotion: علامات التعجب بتزوّد الشدة', () => {
    const calm = detectEmotion('ده استهبال');
    const loud = detectEmotion('ده استهبال!!!');
    assert.ok(loud.intensity > calm.intensity);
});

test('detectEmotion: تكرار الحروف بيزوّد الشدة', () => {
    const calm = detectEmotion('زهقت');
    const loud = detectEmotion('زهقتتتت');
    assert.ok(loud.intensity > calm.intensity);
});

test('detectEmotion: الشدة مابتعديش الواحد الصحيح', () => {
    const signal = detectEmotion('ده استهبال!!! وحاجة تجننننن ' + 'ا'.repeat(250));
    assert.ok(signal.intensity <= 1);
});

// ── الإعدادات بتتحكم في اللي بيتقرا ─────────────────────────────────

test('detectEmotion: الحالة المقفولة مابتتقراش', () => {
    const text = 'ده استهبال بصراحة';
    assert.equal(detectEmotion(text).emotion, 'anger');
    assert.equal(detectEmotion(text, { enabled: ['urgency', 'thanks'] }), null);
});

test('detectEmotion: قفل حالة بيسيب اللي بعدها تشتغل', () => {
    // الرسالة دي فيها غضب وإحباط. لو الغضب اتقفل، لازم يقرا الإحباط.
    const text = 'ده استهبال، كل مرة نفس المشكلة';
    assert.equal(detectEmotion(text).emotion, 'anger');
    assert.equal(detectEmotion(text, { enabled: ['frustration'] }).emotion, 'frustration');
});

test('detectEmotion: بيقبل Set زي ما بيقبل Array', () => {
    const signal = detectEmotion('ده استهبال', { enabled: new Set(['anger']) });
    assert.equal(signal.emotion, 'anger');
});

// ── التصعيد ─────────────────────────────────────────────────────────

test('shouldEscalateForEmotion: الغضب والسخرية بيروحوا لموظف', () => {
    assert.equal(shouldEscalateForEmotion(detectEmotion('ده استهبال')), true);
    assert.equal(shouldEscalateForEmotion(detectEmotion('شكرا على الخدمة الممتازة بجد')), true);
});

test('shouldEscalateForEmotion: الاستعجال والإحباط مايروحوش لموظف لوحدهم', () => {
    // دول بيغيّروا نبرة الرد، مش مسار المحادثة — العميل المستعجل عايز حل
    // مش انتظار موظف.
    assert.equal(shouldEscalateForEmotion(detectEmotion('محتاج حل دلوقتي')), false);
    assert.equal(shouldEscalateForEmotion(detectEmotion('زهقت خلاص')), false);
});

test('shouldEscalateForEmotion: مفيش نبرة يعني مفيش تصعيد', () => {
    assert.equal(shouldEscalateForEmotion(null), false);
});

// ── الردود ──────────────────────────────────────────────────────────

test('acknowledgementFor: كل حالة ليها رد بالعربي والإنجليزي', () => {
    for (const emotion of Object.keys(EMOTION_ACKNOWLEDGEMENT)) {
        const ar = acknowledgementFor(emotion, 'ar');
        const en = acknowledgementFor(emotion, 'en');
        assert.ok(ar && ar.length > 5, `${emotion} مالوش رد عربي`);
        assert.ok(en && en.length > 5, `${emotion} مالوش رد إنجليزي`);
    }
});

test('acknowledgementFor: العربي هو الافتراضي', () => {
    assert.equal(acknowledgementFor('thanks'), EMOTION_ACKNOWLEDGEMENT.thanks.ar);
});

test('acknowledgementFor: حالة مش موجودة بترجع null', () => {
    assert.equal(acknowledgementFor('confusion'), null);
});

test('الردود العربية مفيهاش حروف لاتينية', () => {
    // زلة كتابة زي «ده» -> «de» بتعدي بسهولة جوه نص عربي طويل، وبتوصل
    // للعميل. الفحص ده بيمسكها.
    for (const [emotion, texts] of Object.entries(EMOTION_ACKNOWLEDGEMENT)) {
        assert.ok(!/[A-Za-z]/.test(texts.ar), `الرد العربي بتاع ${emotion} فيه حروف لاتينية: ${texts.ar}`);
    }
});

test('كل حالة بتتصعّد ليها رد', () => {
    for (const emotion of ESCALATING_EMOTIONS) {
        assert.ok(EMOTION_ACKNOWLEDGEMENT[emotion], `${emotion} مالوش رد`);
    }
});

// ── الردود مش أسئلة ─────────────────────────────────────────────────

test('ردود الاعتراف مش بتسأل العميل سؤال', () => {
    // الجملة دي بتتحط قدّام رد المحرك، واللي بعدها غالبًا سؤال توضيح.
    // سؤالين ورا بعض بيلخبطوا العميل ويضيّعوا دور كامل.
    for (const [emotion, texts] of Object.entries(EMOTION_ACKNOWLEDGEMENT)) {
        assert.ok(!texts.ar.includes('؟'), `رد ${emotion} بيسأل سؤال`);
        assert.ok(!texts.en.includes('?'), `رد ${emotion} الإنجليزي بيسأل سؤال`);
    }
});

// ── إشارة «اتحلّت» / «لسه» ───────────────────────────────────────────
// السبب المباشر في إن المحرك كان بيكرر نفس الرد للأبد: مافيش طريقة
// يعرف بيها إن العميل قال خلاص.

import { detectResolutionSignal, foldForMatch } from '../emotion-detector.js';

test('detectResolutionSignal: بيعرف إن المشكلة اتحلّت', () => {
    assert.equal(detectResolutionSignal('تم الحل'), 'resolved');
    assert.equal(detectResolutionSignal('المشكلة اتحلت'), 'resolved');
    assert.equal(detectResolutionSignal('اشتغلت خلاص'), 'resolved');
});

test('detectResolutionSignal: بيعرف إن المشكلة لسه موجودة', () => {
    assert.equal(detectResolutionSignal('لسه عندي نفس المشكلة'), 'unresolved');
    assert.equal(detectResolutionSignal('الحل مانفعش'), 'unresolved');
});

test('detectResolutionSignal: «لسه» بتكسب حتى لو الجملة فيها كلمات إيجابية', () => {
    // «لسه مش شغال» فيها «شغال» اللي في قايمة الحلول. العميل اللي بيقول
    // إنها لسه بايظة لازم يكسب دايمًا.
    assert.equal(detectResolutionSignal('لسه مش شغال'), 'unresolved');
});

test('detectResolutionSignal: التنوين والفاصلة العربية مابيكسروش المطابقة', () => {
    // ده بالظبط اللي حصل: زرار تيليجرام بيبعت «تم، شكرًا» بالتنوين،
    // والقايمة فيها «تم، شكرا» — فالمطابقة فشلت والمحرك كرر الرد.
    assert.equal(detectResolutionSignal('تم، شكرًا'), 'resolved');
    assert.equal(detectResolutionSignal('تم شكرا'), 'resolved');
});

test('detectResolutionSignal: الرسالة العادية مالهاش إشارة', () => {
    assert.equal(detectResolutionSignal('الرسايل مش بتتبعت للجروبات'), null);
    assert.equal(detectResolutionSignal('انا محمود'), null);
    assert.equal(detectResolutionSignal(''), null);
});

test('foldForMatch: بيوحّد التشكيل والهمزات والترقيم', () => {
    assert.equal(foldForMatch('شكرًا'), foldForMatch('شكرا'));
    assert.equal(foldForMatch('أهلاً'), foldForMatch('اهلا'));
    assert.equal(foldForMatch('تم، شكرا'), 'تم شكرا');
});

test('detectEmotion: التشكيل مابيمنعش قراءة النبرة', () => {
    assert.equal(detectEmotion('شكرًا جدًا')?.emotion, 'thanks');
});
