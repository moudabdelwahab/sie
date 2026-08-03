import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseContentDocument, topTwoShare } from '../sie-content-import.js';

const ok = (doc, opts) => parseContentDocument(doc, opts);
const first = (doc, opts) => ok(doc, opts).entries[0];

const MINIMAL = `
# سيناريو: نسيان كلمة المرور
المعرّف: forgot_password
القسم: الدخول والحساب

## الكلمات الدالة
- entity_password (5)
- action_login (4)

## الرد
اضغط «نسيت كلمة المرور».
`;

// ── القراءة الأساسية ─────────────────────────────────────────────────

test('بيقرا سيناريو كامل', () => {
    const entry = first(MINIMAL);
    assert.equal(entry.kind, 'scenario');
    assert.equal(entry.valid, true, entry.errors.join(' | '));
    assert.equal(entry.value.id, 'forgot_password');
    assert.equal(entry.value.label.ar, 'نسيان كلمة المرور');
    assert.equal(entry.value.category, 'login');
    assert.equal(entry.value.resolution.hasAutoResolution, true);
    assert.equal(entry.value.resolution.text.ar, 'اضغط «نسيت كلمة المرور».');
});

test('بيقرا أكتر من سيناريو في ملف واحد', () => {
    const doc = MINIMAL + `
---
# سيناريو: الواتساب مش شغال
المعرّف: whatsapp_down
القسم: واتساب

## الكلمات الدالة
- entity_whatsapp (5)
- symptom_not_working (4)
`;
    const result = ok(doc);
    assert.equal(result.scenarios.length, 2);
    assert.deepEqual(result.scenarios.map((s) => s.value.id), ['forgot_password', 'whatsapp_down']);
});

test('الرد الفاضي يعني «بيسلّم لفريق»', () => {
    const doc = `
# سيناريو: طلب استرداد
المعرّف: refund
القسم: الاشتراكات والفلوس

## الكلمات الدالة
- action_refund (5)
- entity_payment (4)
`;
    const entry = first(doc);
    assert.equal(entry.valid, true, entry.errors.join(' | '));
    assert.equal(entry.value.resolution.hasAutoResolution, false);
});

test('بيقرا المعرفة كنوع تاني', () => {
    const doc = `
# معرفة: مواعيد العمل
المفتاح: working_hours

## النص
من ٩ لـ ٦.
`;
    const result = ok(doc);
    assert.equal(result.knowledge.length, 1);
    assert.equal(result.scenarios.length, 0);
    assert.equal(result.knowledge[0].value.key, 'working_hours');
    assert.equal(result.knowledge[0].value.text.ar, 'من ٩ لـ ٦.');
});

// ── التسامح: الملف الجاي من PDF ───────────────────────────────────────

test('بيشتغل من غير علامات #', () => {
    // استخراج نص الـ PDF بيضيّع علامات الماركداون.
    const doc = `
سيناريو: نسيان كلمة المرور
المعرّف: forgot_password
القسم: الدخول والحساب
`;
    const entry = first(doc);
    assert.equal(entry.value.id, 'forgot_password');
});

test('الأرقام العربية زي الإنجليزية', () => {
    const doc = MINIMAL.replace('(5)', '(٥)').replace('(4)', '(٤)');
    const entry = first(doc);
    assert.equal(entry.value.evidenceSignature[0].weight, 5);
    assert.equal(entry.value.evidenceSignature[1].weight, 4);
});

test('التشكيل والهمزات مابيكسروش أسماء الحقول', () => {
    const doc = `
# سيناريو: تجربة
المعرف: t1
القسم: الدخول والحساب

## الكلمات الداله
- a (5)
- b (4)

## الرد
اهلا
`;
    const entry = first(doc);
    assert.equal(entry.value.id, 't1');
    assert.equal(entry.value.category, 'login');
    assert.equal(entry.value.evidenceSignature.length, 2);
});

test('أي علامة تنقيط بتنفع كنقطة قائمة', () => {
    const doc = `
# سيناريو: تجربة
المعرّف: t1

## الكلمات الدالة
* a (5)
• b (4)
+ c (2)
`;
    const entry = first(doc);
    assert.deepEqual(entry.value.evidenceSignature.map((e) => e.token), ['a', 'b', 'c']);
});

test('الوزن بيتقرا بأكتر من شكل', () => {
    const doc = `
# سيناريو: تجربة
المعرّف: t1

## الكلمات الدالة
- a (5)
- b: 4
- c = 2
- d — 1
`;
    const entry = first(doc);
    assert.deepEqual(entry.value.evidenceSignature.map((e) => e.weight), [5, 4, 2, 1]);
});

// ── الأوزان الافتراضية ───────────────────────────────────────────────

test('من غير أوزان، أقوى كلمتين بيحسموا', () => {
    for (let n = 1; n <= 8; n += 1) {
        const tokens = Array.from({ length: n }, (_, i) => `- tok_${i}`).join('\n');
        const doc = `# سيناريو: تجربة\nالمعرّف: t${n}\n\n## الكلمات الدالة\n${tokens}\n`;
        const entry = first(doc);
        const share = topTwoShare(entry.value.evidenceSignature.map((e) => e.weight));
        assert.ok(share >= 0.6, `${n} كلمة: النصيب ${share.toFixed(2)} أقل من 0.60`);
        assert.equal(entry.valid, true, `${n} كلمة: ${entry.errors.join(' | ')}`);
    }
});

test('توقيع مش هيحسم أبدًا بيترفض بسبب واضح', () => {
    // ده الفشل الوحيد اللي بيعدي التحقق وبعدين يبان للعميل كإن البوت
    // بيتجاهله: السيناريو سليم شكلًا وعمره ما هيتنفذ.
    const doc = `
# سيناريو: تجربة
المعرّف: t1

## الكلمات الدالة
- a (1)
- b (1)
- c (1)
- d (1)
- e (1)
- f (1)
`;
    const entry = first(doc);
    assert.equal(entry.valid, false);
    assert.ok(entry.errors.some((e) => e.includes('مش هيحسم')), entry.errors.join(' | '));
});

test('كلمات كتير أوي بتتحذّر منها', () => {
    const tokens = Array.from({ length: 10 }, (_, i) => `- tok_${i}`).join('\n');
    const entry = first(`# سيناريو: تجربة\nالمعرّف: t1\n\n## الكلمات الدالة\n${tokens}\n`);
    assert.ok(entry.warnings.some((w) => w.includes('كتير')), entry.warnings.join(' | '));
});

// ── التحقق ──────────────────────────────────────────────────────────

test('سيناريو من غير كلمات دالة بيترفض', () => {
    const entry = first('# سيناريو: تجربة\nالمعرّف: t1\nالقسم: واتساب\n');
    assert.equal(entry.valid, false);
    assert.ok(entry.errors.length > 0);
});

test('المعرّف المكرر بيتمسك وبيقول مكان الأول', () => {
    const result = ok(MINIMAL + '\n' + MINIMAL);
    assert.equal(result.entries[0].valid, true);
    assert.equal(result.entries[1].valid, false);
    assert.ok(result.entries[1].errors.some((e) => e.includes('مكرر')));
});

test('كل مدخل بيرجّع رقم السطر بتاعه', () => {
    const result = ok(MINIMAL + '\n' + MINIMAL.replace('forgot_password', 'other_key'));
    assert.ok(result.entries[0].line >= 1);
    assert.ok(result.entries[1].line > result.entries[0].line);
});

test('ملف مافيهوش سيناريوهات بيقول ده بوضوح', () => {
    const result = ok('# عنوان عادي\nكلام عادي مالوش علاقة.');
    assert.equal(result.entries.length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].includes('سيناريو'));
});

test('المدخل الغلط مابيوقّفش اللي بعده', () => {
    const broken = '# سيناريو: ناقص\nالمعرّف: broken\n';
    const result = ok(broken + '\n' + MINIMAL);
    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0].valid, false);
    assert.equal(result.entries[1].valid, true);
});

// ── الإنجليزي الناقص: تحذير، مش رفض ─────────────────────────────────

test('من غير إنجليزي، العربي بيتحط مكانه مع تحذير', () => {
    const entry = first(MINIMAL);
    assert.equal(entry.valid, true);
    assert.equal(entry.value.resolution.text.en, entry.value.resolution.text.ar);
    assert.ok(entry.warnings.some((w) => w.includes('إنجليزي')), entry.warnings.join(' | '));
});

test('لما الإنجليزي مكتوب، مابيتحطّش العربي مكانه', () => {
    const doc = MINIMAL + '\n## الرد بالإنجليزي\nTap "Forgot password".\n';
    const entry = first(doc);
    assert.equal(entry.value.resolution.text.en, 'Tap "Forgot password".');
    assert.ok(!entry.warnings.some((w) => w.includes('الرد بالإنجليزي')));
});

// ── التذكرة ─────────────────────────────────────────────────────────

test('«افتح تذكرة» هي الافتراضي', () => {
    assert.equal(first(MINIMAL).value.requiresTicketIfUnresolved, true);
});

test('«متقفلش تذكرة» بتتقرا صح رغم إن فيها كلمة تذكرة', () => {
    const doc = MINIMAL.replace('القسم: الدخول والحساب', 'القسم: الدخول والحساب\nلو مااتحلّتش: متقفلش تذكرة');
    assert.equal(first(doc).value.requiresTicketIfUnresolved, false);
});

// ── السؤال التوضيحي ─────────────────────────────────────────────────

test('السؤال التوضيحي بيتقرا بخياراته', () => {
    const doc = MINIMAL + `
## سؤال توضيحي
الرقم ظاهر عندك ولا لأ؟
- ظاهر
- مش ظاهر
`;
    const q = first(doc).value.discriminatingQuestions[0];
    assert.equal(q.prompt.ar, 'الرقم ظاهر عندك ولا لأ؟');
    assert.deepEqual(q.options.map((o) => o.label.ar), ['ظاهر', 'مش ظاهر']);
    assert.deepEqual(q.resolvesEvidence, ['entity_password', 'action_login']);
});

// ── الأمان: الأمثلة جوه ``` مش بيتقروا ───────────────────────────────

test('الأمثلة اللي جوه بلوك كود مابتتحسبش سيناريوهات', () => {
    const doc = [
        '```',
        '# سيناريو: ده مجرد مثال في الشرح',
        'المعرّف: example_only',
        '```',
        MINIMAL
    ].join('\n');
    const result = ok(doc);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].value.id, 'forgot_password');
});

test('عنوان فيه كلمة «المعرفة» من غير نقطتين مش بيفتح مدخل', () => {
    // «# المعرفة — إمتى تستخدمها بدل السيناريو» عنوان شرح، مش مدخل.
    const doc = '# المعرفة — إمتى تستخدمها بدل السيناريو\nكلام شرح.\n' + MINIMAL;
    const result = ok(doc);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].kind, 'scenario');
});

test('«شرح حقل الرد» مش هو قسم الرد', () => {
    const doc = `
# سيناريو: تجربة
المعرّف: t1

## الكلمات الدالة
- a (5)
- b (4)

## شرح حقل الرد
الكلام ده شرح مش رد.
`;
    assert.equal(first(doc).value.resolution.hasAutoResolution, false);
});

// ── تحويل التوكنات ──────────────────────────────────────────────────

test('resolveToken بيحوّل اللي الكاتب كتبه لتوكن المحرك', () => {
    const doc = `
# سيناريو: تجربة
المعرّف: t1

## الكلمات الدالة
- واتساب (5)
- مش شغال (4)
`;
    const map = { 'واتساب': 'entity_whatsapp', 'مش شغال': 'symptom_not_working' };
    const entry = first(doc, { resolveToken: (t) => map[t] || t });
    assert.deepEqual(entry.value.evidenceSignature.map((e) => e.token),
        ['entity_whatsapp', 'symptom_not_working']);
});

// ── الملف النموذج نفسه ──────────────────────────────────────────────

test('النموذج اللي بنبعته للعميل بيتقرا صح', async () => {
    // لو النموذج نفسه مابيعديش، يبقى بنعلّم الناس صيغة غلط.
    const path = fileURLToPath(new URL('../../docs/نموذج-إضافة-سيناريو.md', import.meta.url));
    const result = parseContentDocument(await readFile(path, 'utf8'));

    assert.equal(result.errors.length, 0);
    assert.equal(result.scenarios.length, 3, 'المفروض ٣ سيناريوهات في قسم الأمثلة');
    assert.equal(result.knowledge.length, 1);

    for (const entry of result.entries) {
        assert.equal(entry.valid, true, `${entry.title}: ${entry.errors.join(' | ')}`);
    }
    assert.deepEqual(
        result.scenarios.map((s) => s.value.id),
        ['forgot_password', 'whatsapp_not_linked', 'refund_request']
    );
    // مثال «بيسلّم لفريق» لازم يفضل من غير رد جاهز.
    assert.equal(result.scenarios[2].value.resolution.hasAutoResolution, false);
});

test('شرح النموذج مابيدخلش جوه الأمثلة', () => {
    // الشرح فوق والأمثلة تحت — لو الترتيب اتقلب، فقرات الشرح هتبقى ردود
    // بتوصل لعملاء حقيقيين.
    const path = fileURLToPath(new URL('../../docs/نموذج-إضافة-سيناريو.md', import.meta.url));
    return readFile(path, 'utf8').then((text) => {
        const result = parseContentDocument(text);
        const answer = result.scenarios[0].value.resolution.text.ar;
        assert.ok(!answer.includes('اختياري'), answer);
        assert.ok(answer.startsWith('تقدر تعمل كلمة مرور جديدة'), answer);
    });
});

test('سطر فيه نقطتين جوه الرد بيفضل جزء من الرد', () => {
    // «ملاحظة: …» جملة، مش حقل. لو اتشالت من الرد، العميل بياخد رد ناقص
    // من غير ما حد ياخد باله.
    const doc = MINIMAL + 'ملاحظة: لو اللينك مجاش، بصّ في Spam.\n';
    const entry = first(doc);
    assert.ok(entry.value.resolution.text.ar.includes('ملاحظة: لو اللينك مجاش'),
        entry.value.resolution.text.ar);
});
