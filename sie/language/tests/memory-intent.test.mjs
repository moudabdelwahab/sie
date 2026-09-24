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

// «انا» is a self-introduction only at the start of a message or after a
// greeting. Found by the general-support probe (bench/corpora/general-probe):
// each sentence below was saved as the customer's NAME, and the turn —
// usually a correction — was never diagnosed. 19 of 6,323 corpus messages
// changed with this rule; every one was a false save.
test('«انا» inside a sentence, or before a state or a verb, is not a name', () => {
    for (const t of [
        'لا انا قصدي الفاتورة مش الاشتراك', 'انا ماقلتش كده', 'استنى انا كتبت غلط', 'انا تايه خالص',
        'انا مسألتش على كده', 'مش ده اللي انا عايزه', 'انا زعلانة', 'ممكن تساعدني انا جديد',
        'لو سمحت انا بسوق واستنى شوية', 'انا بسالك انت مين', 'انا معاكم من زمان'
    ]) assert.deepEqual(extractFacts(t), [], t);
});

test('real introductions still save — including names that end like verbs', () => {
    const name = (t) => extractFacts(t).find((f) => f.key === 'name')?.value;
    assert.equal(name('انا رفعت'), 'رفعت');
    assert.equal(name('انا مدحت عبدالله'), 'مدحت عبدالله');
    assert.equal(name('اهلا انا سارة'), 'سارة');
    assert.equal(name('صباح الخير، انا مروان'), 'مروان');
    assert.equal(name('السلام عليكم انا منى من شركة النور'), 'منى');
    assert.equal(name('انا محمود عبدالوهاب صاحب منصة مدعوم'), 'محمود عبدالوهاب');
});

// The first version of the rule above was ONE regex with a repeated optional
// greeting prefix, which backtracks exponentially: «و و و …» × 28 took 1.6 s
// and the bridge's 50,000-character test hung for twenty minutes. The memory
// detector runs on every message in every edition, so this is a DoS guard.
test('memory extraction is linear on hostile input', () => {
    for (const hostile of ['و '.repeat(25_000), 'السلام عليكم '.repeat(4_000) + 'انا', ('انا ' + 'و'.repeat(90) + ' ').repeat(500)]) {
        const t0 = performance.now();
        extractFacts(hostile);
        assert.ok(performance.now() - t0 < 250, `took ${(performance.now() - t0).toFixed(0)} ms on ${hostile.length} chars`);
    }
});
