import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMemoryIntent, extractFacts, MEMORY_REPLIES } from '../memory-intent.js';

test('بيفصل الاسم عن الدور في نفس الجملة', () => {
    // الجملة اللي العميل كتبها فعلاً. قبل الإصلاح كانت بتتاخد كلها كاسم
    // وتترفض لأنها طويلة، فمكانش بيتحفظ أي حاجة.
    const facts = extractFacts('انا محمود عبدالوهاب صاحب منصة مدعوم');
    assert.deepEqual(facts, [
        { key: 'name', value: 'محمود عبدالوهاب' },
        { key: 'role', value: 'صاحب منصة مدعوم' }
    ]);
});

test('«اسمي X» بتتحفظ', () => {
    assert.deepEqual(extractFacts('اسمي أحمد'), [{ key: 'name', value: 'أحمد' }]);
});

test('مابيحفظش شكوى على إنها اسم', () => {
    // «انا عندي مشكلة» لو اتحفظت كاسم، المحرك هيقول للعميل بعد كده
    // «أهلاً يا عندي مشكلة».
    assert.deepEqual(extractFacts('انا عندي مشكلة في الاشتراك'), []);
    assert.deepEqual(extractFacts('انا محتاج مساعدة'), []);
    assert.deepEqual(extractFacts('انا مش عارف ادخل'), []);
});

test('«احفظ ده» بيرجع لرسالة العميل اللي قبلها', () => {
    const intent = detectMemoryIntent('احفظ ده في ذاكرتك', 'انا محمود عبدالوهاب صاحب منصة مدعوم');
    assert.equal(intent.kind, 'save');
    assert.ok(intent.facts.some((f) => f.value.includes('محمود')));
});

test('«احفظ ده» من غير سياق بيطلب توضيح مش بيحفظ فاضي', () => {
    const intent = detectMemoryIntent('احفظ ده في ذاكرتك', '');
    assert.equal(intent.kind, 'save');
    assert.deepEqual(intent.facts, []);
});

test('طلب الاسترجاع والمسح بيتعرفوا', () => {
    assert.equal(detectMemoryIntent('انت فاكر ايه عني')?.kind, 'recall');
    assert.equal(detectMemoryIntent('امسح ذاكرتك')?.kind, 'forget');
});

test('رسالة المشكلة العادية مش نية حفظ', () => {
    // لو دي رجعت نية، المشكلة الحقيقية مش هتتشخّص أبدًا.
    assert.equal(detectMemoryIntent('الرسايل مش بتتبعت للجروبات'), null);
    assert.equal(detectMemoryIntent('الاشتراك بتاعي منتهي'), null);
    assert.equal(detectMemoryIntent(''), null);
});

test('كل الردود عربية ومفيهاش حروف لاتينية', () => {
    assert.ok(!/[A-Za-z]/.test(MEMORY_REPLIES.nothingToSave));
    assert.ok(!/[A-Za-z]/.test(MEMORY_REPLIES.forgotten));
    assert.ok(!/[A-Za-z]/.test(MEMORY_REPLIES.saved([{ key: 'name', value: 'محمود' }])));
    assert.ok(!/[A-Za-z]/.test(MEMORY_REPLIES.recalled([])));
});
