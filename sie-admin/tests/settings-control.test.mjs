/**
 * settings-control.test.mjs
 * ------------------------------------------------------------
 * إن كل مفتاح في اللوحة بيغيّر سلوك حقيقي، مش شكل.
 *
 * ده الفرق اللي الاختبار ده موجود عشانه: لوحة فيها مفتاح بيتحرك وبيتحفظ
 * ومابيغيّرش حاجة في المحرك أسوأ من لوحة مافيهاش المفتاح ده خالص — لأن
 * المسؤول هيمشي فاكر إنه ظبط حاجة.
 *
 * @no-legitimate-corpus
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
    SETTINGS, SETTINGS_BY_KEY, SIE_DEFAULT_SETTINGS, validateSetting, mergeStoredSettings
} from '../../sie/config/settings-schema.js';
import { describeCapabilities, SENSITIVE_KEYS } from '../../sie/config/engine-status.js';

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/**
 * الكود من غير التعليقات.
 *
 * لازم، مش تجميل: التعليق اللي بيشرح إن الظل **مابيستدعيش** `sendMessage`
 * فيه كلمة `sendMessage`. اختبار بيدوّر في النص الخام بيقع على الشرح
 * ويعتبره مخالفة — يعني بيعاقب على توثيق الضمان.
 */
const codeOnly = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

// ── الحفظ والقراءة ─────────────────────────────────────────────

test('كل إعداد بقيمته الافتراضية بيعدي من التحقق', () => {
    const rejected = [];
    for (const def of SETTINGS) {
        const result = validateSetting(def.key, SIE_DEFAULT_SETTINGS[def.key]);
        if (!result.ok) rejected.push(`${def.key}: ${result.error}`);
    }
    assert.deepEqual(rejected, [], `قيم افتراضية مرفوضة:\n${rejected.join('\n')}`);
});

test('القيمة المحفوظة بترجع زي ما هي', () => {
    // ده مسار الحفظ الحقيقي: التحقق بيرجّع القيمة، والقراءة بتدمجها فوق
    // الافتراضي. لو الاتنين اختلفوا، المفتاح هيبان متغيّر وهو متحفوظ صح.
    const stored = [];
    for (const def of SETTINGS) {
        const value = def.type === 'boolean' ? !SIE_DEFAULT_SETTINGS[def.key]
            : def.type === 'number' ? def.min
                : def.options[def.options.length - 1].value;
        const check = validateSetting(def.key, value);
        assert.ok(check.ok, `${def.key} رفض قيمة صالحة`);
        stored.push({ key: def.key, value: check.value });
    }
    const merged = mergeStoredSettings(stored);
    for (const { key, value } of stored) {
        assert.deepEqual(merged[key], value, `«${key}» اتغيّر بين الحفظ والقراءة`);
    }
});

test('الصف اللي مش معروف بيتتجاهل، مابيكسرش القراءة', () => {
    const merged = mergeStoredSettings([
        { key: 'engine_enabled', value: false },
        { key: 'مفتاح_مخترع', value: 'أي حاجة' }
    ]);
    assert.equal(merged.engine_enabled, false);
    assert.equal(merged['مفتاح_مخترع'], undefined, 'مفتاح مش في الوصف مالوش يدخل الحالة');
});

// ── المدخلات الغلط ─────────────────────────────────────────────

test('المفتاح المخترع بيترفض', () => {
    const result = validateSetting('حاجة_مش_موجودة', true);
    assert.equal(result.ok, false);
});

test('النوع الغلط بيترفض — مش بيتحوّل بالعافية', () => {
    assert.equal(validateSetting('engine_enabled', 'true').ok, false, 'نص مش منطقي');
    assert.equal(validateSetting('engine_enabled', 1).ok, false, 'رقم مش منطقي');
    assert.equal(validateSetting('engine_enabled', null).ok, false);
});

test('الرقم بره الحدود بيترفض، مش بيتقصّ في صمت', () => {
    const numbers = SETTINGS.filter((d) => d.type === 'number');
    assert.ok(numbers.length > 0);
    for (const def of numbers) {
        assert.equal(validateSetting(def.key, def.min - 1).ok, false, `${def.key} قبل أقل من الحد`);
        assert.equal(validateSetting(def.key, def.max + 1).ok, false, `${def.key} قبل أكتر من الحد`);
        assert.equal(validateSetting(def.key, NaN).ok, false, `${def.key} قبل NaN`);
        assert.equal(validateSetting(def.key, Infinity).ok, false, `${def.key} قبل لانهاية`);
    }
});

test('الاختيار اللي مش في القايمة بيترفض', () => {
    for (const def of SETTINGS.filter((d) => d.type === 'enum')) {
        assert.equal(validateSetting(def.key, 'اختيار_مخترع').ok, false, `${def.key}`);
    }
});

// ── المفاتيح الجديدة بتغيّر سلوك حقيقي ─────────────────────────

test('كل علم جديد بيتقرا فعلاً في كود المحرك', async () => {
    // نفس الوعد اللي في اختبار الإعدادات الأصلي، بس مطبّق على الأعلام
    // اللي اتضافت في مركز التحكم: مفتاح في اللوحة مالوش قارئ في المحرك
    // هو مفتاح بيكدب.
    const sources = await Promise.all([
        read('../../sie-integration/sie-chat-bridge.js'),
        read('../../sie-integration/sie-shadow.js'),
        read('../../sie/pipeline/pipeline.js'),
        read('../../sie/diagnostics/sparse-state.js')
    ]);
    const haystack = sources.join('\n');

    for (const key of ['trust_boundary_enabled', 'trust_boundary_enforce',
        'sparse_diagnostic_state', 'shadow_run_enabled']) {
        assert.ok(haystack.includes(key), `«${key}» معروض في اللوحة ومحدش بيقراه`);
    }
});

test('علم النسخة التجريبية بيتحكم في تشغيلها فعلاً', async () => {
    const bridge = await read('../../sie-integration/sie-chat-bridge.js');
    assert.match(bridge, /settings\.shadow_run_enabled === true/,
        'التشغيل لازم يبقى مربوط بالعلم، ومحتاج true صريح');
    // والاستدعاء نفسه لازم يكون جوه الشرط — مش قبله. الاستيراد في أول
    // الملف بيسبق الشرط بطبيعته، فبندوّر على الاستدعاء اللي بعد الشرط.
    const code = codeOnly(bridge);
    const gate = code.indexOf('settings.shadow_run_enabled === true');
    assert.ok(gate > -1, 'الشرط مش موجود في الكود');
    const call = code.indexOf('runShadowComparison(', gate);
    assert.ok(call > -1, 'مفيش استدعاء بعد الشرط');
    assert.ok(call - gate < 600, 'الاستدعاء بعيد عن الشرط — يمكن يكون بره الشرط');
});

test('النسخة التجريبية مالهاش طريق توصل للعميل', async () => {
    const shadow = codeOnly(await read('../../sie-integration/sie-shadow.js'));
    // الضمان بنيوي: الملف بيستدعي `runTurn` اللي بيقف عند القرار. لو استورد
    // أي حاجة من طبقات الرد أو التنفيذ، الضمان بيبقى وعد مكتوب بس.
    for (const forbidden of ['dialogue-renderer', 'action-layer', 'executeDecision', 'sendMessage']) {
        assert.ok(!shadow.includes(forbidden), `الظل بيلمس «${forbidden}» — ده ممكن يوصل للعميل`);
    }
    assert.match(shadow, /runTurn/, 'بيستخدم المسار اللي بيقف عند القرار');
});

// ── الصلاحيات ──────────────────────────────────────────────────

test('اللوحة بتقفل كل المدخلات على اللي مش من الفريق', async () => {
    const js = await read('../settings.js');
    assert.match(js, /if \(!state\.isStaff\)[\s\S]{0,200}disabled = true/,
        'الإعدادات لازم تتقفل على غير الفريق');
});

test('الصلاحية بتتقرر في قاعدة البيانات، واللوحة بتخبّي بس', async () => {
    const js = await read('../settings.js');
    // `isCurrentUserEngineStaff` بتنده على RPC. اللوحة مالهاش تقرر الصلاحية
    // بنفسها — لو قررت، أي حد يقدر يعدّل الجافاسكريبت ويفتحها.
    assert.match(js, /isCurrentUserEngineStaff/);
    assert.ok(!/state\.isStaff\s*=\s*true/.test(js), 'مفيش مكان بيدّي صلاحية من غير سؤال قاعدة البيانات');
});

// ── الإعدادات الحسّاسة ─────────────────────────────────────────

test('كل إعداد حسّاس هو فعلاً إعداد بيغيّر سلوك المحرك للكل', () => {
    for (const key of SENSITIVE_KEYS) {
        const def = SETTINGS_BY_KEY[key];
        assert.ok(def, `«${key}» متحمي ومش موجود`);
        assert.ok(def.effect, `«${key}» متحمي ومالوش تأثير معلن في المحرك`);
    }
});

test('كل قدرة في مركز التحكم مفاتيحها موجودة في الإعدادات', () => {
    for (const cap of describeCapabilities({}, {})) {
        for (const key of cap.keys) {
            assert.ok(SETTINGS_BY_KEY[key], `«${cap.title}» بتعرض مفتاح «${key}» مش موجود`);
        }
    }
});
