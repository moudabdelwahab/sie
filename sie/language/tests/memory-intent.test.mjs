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

// ══════════════════ حماية صوت النظام ══════════════════
// Replies leave through Telegram with parse_mode: 'Markdown' and nothing on
// that path escapes anything, so a stored note is markup unless something
// makes it not be. See sie/trust/egress-guard.js.

test('MEMORY_REPLIES: a stored markdown link cannot come back as a live link', () => {
    const reply = MEMORY_REPLIES.recalled([{ key: 'note', value: '[اضغط هنا](https://evil.example)' }]);
    assert.ok(!reply.includes('https://evil.example'), 'the URL survived into the bot reply');
    assert.ok(!reply.includes(']('), 'link syntax survived');
    assert.ok(reply.includes('اضغط هنا'), 'the label should survive — this neutralises, it does not censor');
});

test('MEMORY_REPLIES: stored text cannot forge the reply\'s own structure', () => {
    const reply = MEMORY_REPLIES.recalled([{ key: 'note', value: 'سطر\nسطر تاني\n• بند مزيف' }]);
    const bullets = reply.split('\n').filter((l) => l.trim().startsWith('•'));
    assert.equal(bullets.length, 1, 'one stored fact must render as exactly one bullet');
});

test('MEMORY_REPLIES: saved echoes are neutralised too, not just recalled', () => {
    const reply = MEMORY_REPLIES.saved([{ key: 'note', value: '*رسمي* [x](http://e.example)' }]);
    assert.ok(!reply.includes('http://e.example'));
    assert.ok(!reply.includes('*رسمي*'));
});

test('MEMORY_REPLIES: ordinary stored text is unchanged', () => {
    const reply = MEMORY_REPLIES.recalled([{ key: 'name', value: 'محمد من شركة النور' }]);
    assert.ok(reply.includes('• محمد من شركة النور'));
});

// ── «اسمي» و«شركتي» كمفعول به مش تعريف بالنفس ─────────────────────
// Found by the Pro phrasing benchmark: these were stored as facts, so the
// customer's question was swallowed as a memory write and never diagnosed.

test('«اغير اسمي» طلب، مش اسم جديد', () => {
    assert.deepEqual(extractFacts('عايز اغير اسمي اللي ظاهر'), []);
    assert.deepEqual(extractFacts('ازاي اغير اسمي'), []);
    assert.equal(detectMemoryIntent('عايز اغير اسمي اللي ظاهر'), null);
});

test('«لوجو شركتي» / «بيانات شركتي» مش اسم شركة', () => {
    assert.deepEqual(extractFacts('عايز احط لوجو شركتي على البوابة بتاعتي'), []);
    assert.deepEqual(extractFacts('بيانات شركتي مش ظاهرة'), []);
});

test('الأشكال الصريحة لسه بتتحفظ', () => {
    assert.deepEqual(extractFacts('مرحبا اسمي محمد، عندي مشكلة'), [{ key: 'name', value: 'محمد' }]);
    assert.deepEqual(extractFacts('شركتي اسمها النور'), [{ key: 'company', value: 'النور' }]);
    assert.deepEqual(extractFacts('شركتي النور للتجارة'), [{ key: 'company', value: 'النور للتجارة' }]);
    assert.deepEqual(extractFacts('انا احمد وشركتي اسمها تك'), [{ key: 'name', value: 'احمد' }, { key: 'company', value: 'تك' }]);
});
