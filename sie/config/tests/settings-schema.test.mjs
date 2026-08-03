import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
    SETTINGS,
    SETTINGS_BY_KEY,
    SETTING_GROUPS,
    SIE_DEFAULT_SETTINGS,
    BEHAVIOR_PROFILES,
    behaviorProfileValues,
    detectBehaviorProfile,
    validateSetting,
    mergeStoredSettings,
    isSettingActive,
    groupedSettings
} from '../settings-schema.js';

// ── سلامة الشكل ─────────────────────────────────────────────────────

test('كل إعداد عنده كل الحقول المطلوبة', () => {
    for (const s of SETTINGS) {
        assert.ok(s.key, 'مفيش مفتاح');
        assert.ok(s.title, `${s.key} مالوش اسم عربي`);
        assert.ok(s.desc, `${s.key} مالوش شرح`);
        assert.ok(s.effect, `${s.key} مش مكتوب بيأثر فين`);
        assert.ok(['boolean', 'number', 'enum'].includes(s.type), `${s.key} نوعه غريب: ${s.type}`);
        assert.ok(SETTING_GROUPS.some((g) => g.id === s.group), `${s.key} في مجموعة مش موجودة: ${s.group}`);
        assert.notEqual(s.default, undefined, `${s.key} مالوش قيمة افتراضية`);
    }
});

test('مفيش مفتاح متكرر', () => {
    const keys = SETTINGS.map((s) => s.key);
    assert.equal(new Set(keys).size, keys.length);
});

test('الأرقام عندها حدود، والقوائم عندها اختيارات', () => {
    for (const s of SETTINGS) {
        if (s.type === 'number') {
            assert.equal(typeof s.min, 'number', `${s.key} مالوش حد أدنى`);
            assert.equal(typeof s.max, 'number', `${s.key} مالوش حد أقصى`);
            assert.ok(s.min < s.max, `${s.key} حدوده مقلوبة`);
        }
        if (s.type === 'enum') {
            assert.ok(Array.isArray(s.options) && s.options.length >= 2, `${s.key} لازم يكون له اختيارين على الأقل`);
            for (const o of s.options) {
                assert.ok(o.value && o.label, `${s.key} فيه اختيار ناقص`);
            }
        }
    }
});

test('كل قيمة افتراضية بتعدي على التحقق بتاعها', () => {
    // لو دي فشلت، يبقى المحرك بيبدأ بقيمة هو نفسه بيرفضها.
    for (const s of SETTINGS) {
        const result = validateSetting(s.key, s.default);
        assert.ok(result.ok, `القيمة الافتراضية بتاعة ${s.key} مرفوضة: ${result.error}`);
    }
});

test('كل إعداد بيعتمد على مفتاح موجود فعلاً', () => {
    for (const s of SETTINGS) {
        if (!s.dependsOn) continue;
        assert.ok(SETTINGS_BY_KEY[s.dependsOn], `${s.key} بيعتمد على مفتاح مش موجود: ${s.dependsOn}`);
        assert.equal(SETTINGS_BY_KEY[s.dependsOn].type, 'boolean', `${s.key} بيعتمد على حاجة مش مفتاح`);
    }
});

test('مفيش إعداد بيعتمد على نفسه', () => {
    for (const s of SETTINGS) {
        assert.notEqual(s.dependsOn, s.key, `${s.key} بيعتمد على نفسه`);
    }
});

// ── اللوحة عربية بالكامل ────────────────────────────────────────────

test('مفيش نص إنجليزي في أي حاجة العميل أو الموظف هيشوفها', () => {
    // ده الشرط اللي المستخدم طلبه: «مفيهاش مصطلحات انجليزيه».
    // `effect` مستثنى — ده تعليق للمبرمج مش نص بيظهر في اللوحة.
    const visible = [];
    for (const g of SETTING_GROUPS) visible.push([`group:${g.id}`, g.title], [`group:${g.id}`, g.desc]);
    for (const s of SETTINGS) {
        visible.push([s.key, s.title], [s.key, s.desc]);
        if (s.warn) visible.push([s.key, s.warn]);
        for (const o of s.options || []) {
            visible.push([s.key, o.label]);
            if (o.desc) visible.push([s.key, o.desc]);
        }
    }
    for (const [where, text] of visible) {
        assert.ok(!/[A-Za-z]{2,}/.test(text), `فيه كلام إنجليزي في ${where}: «${text}»`);
    }
});

test('كل مجموعة فيها إعداد واحد على الأقل', () => {
    for (const group of groupedSettings()) {
        assert.ok(group.settings.length > 0, `مجموعة «${group.title}» فاضية`);
    }
});

test('groupedSettings بترجع كل الإعدادات من غير ما تفقد ولا واحد', () => {
    const total = groupedSettings().reduce((n, g) => n + g.settings.length, 0);
    assert.equal(total, SETTINGS.length);
});

// ── التحقق ──────────────────────────────────────────────────────────

test('validateSetting: بيرفض المفتاح المجهول', () => {
    const r = validateSetting('made_up_key', true);
    assert.equal(r.ok, false);
});

test('validateSetting: بيرفض النوع الغلط', () => {
    assert.equal(validateSetting('engine_enabled', 'أيوه').ok, false);
    assert.equal(validateSetting('max_clarifying_questions', 'تلاتة').ok, false);
    assert.equal(validateSetting('diagnosis_level', 'سريع').ok, false);
});

test('validateSetting: بيرفض الرقم اللي بره الحدود', () => {
    assert.equal(validateSetting('max_clarifying_questions', 99).ok, false);
    assert.equal(validateSetting('max_clarifying_questions', 0).ok, false);
    assert.equal(validateSetting('answer_confidence', 0.6).ok, true);
});

test('validateSetting: بيقبل نص فيه رقم ويحوّله', () => {
    const r = validateSetting('max_clarifying_questions', '3');
    assert.equal(r.ok, true);
    assert.equal(r.value, 3, 'لازم يترجع رقم مش نص، عشان المحرك يقارن بيه صح');
});

test('validateSetting: رسايل الخطأ عربية', () => {
    for (const [key, bad] of [['engine_enabled', 'x'], ['max_clarifying_questions', 99], ['diagnosis_level', 'zzz']]) {
        const r = validateSetting(key, bad);
        assert.equal(r.ok, false);
        assert.ok(/[؀-ۿ]/.test(r.error), `رسالة الخطأ بتاعة ${key} مش عربية: ${r.error}`);
    }
});

// ── الدمج ───────────────────────────────────────────────────────────

test('mergeStoredSettings: المخزّن بيغلب الافتراضي', () => {
    const merged = mergeStoredSettings([{ key: 'engine_enabled', value: false }]);
    assert.equal(merged.engine_enabled, false);
    assert.equal(merged.answer_directly, SIE_DEFAULT_SETTINGS.answer_directly);
});

test('mergeStoredSettings: الصف الغلط بيتتجاهل ومايوقّفش المحرك', () => {
    // صف قديم من نسخة أقدم مايصحّش يقفل المحرك على كل العملاء.
    const merged = mergeStoredSettings([
        { key: 'engine_enabled', value: 'مش بوليان' },
        { key: 'مفتاح_اتشال', value: 1 },
        { key: 'answer_directly', value: false }
    ]);
    assert.equal(merged.engine_enabled, SIE_DEFAULT_SETTINGS.engine_enabled, 'الصف الغلط لازم يرجع للافتراضي');
    assert.equal(merged.answer_directly, false, 'الصفوف السليمة لازم تعدي عادي');
});

test('mergeStoredSettings: مفيش صفوف يعني الافتراضي بالظبط', () => {
    assert.deepEqual(mergeStoredSettings([]), { ...SIE_DEFAULT_SETTINGS });
    assert.deepEqual(mergeStoredSettings(null), { ...SIE_DEFAULT_SETTINGS });
});

// ── الأساليب ────────────────────────────────────────────────────────

test('كل أسلوب بيظبط مفاتيح موجودة فعلاً', () => {
    for (const [profile, values] of Object.entries(BEHAVIOR_PROFILES)) {
        for (const [key, value] of Object.entries(values)) {
            assert.ok(SETTINGS_BY_KEY[key], `أسلوب ${profile} بيظبط مفتاح مش موجود: ${key}`);
            assert.ok(validateSetting(key, value).ok, `أسلوب ${profile} بيدي ${key} قيمة مرفوضة`);
        }
    }
});

test('الأسلوب المتوازن هو نفسه الافتراضي', () => {
    // لو دول اتفرقوا، لوحة مالمسهاش حد هتقول «مخصص» وهي متعملتش حاجة.
    for (const [key, value] of Object.entries(BEHAVIOR_PROFILES.balanced)) {
        assert.equal(SIE_DEFAULT_SETTINGS[key], value, `${key} مختلف بين المتوازن والافتراضي`);
    }
});

test('detectBehaviorProfile: بيعرف الأسلوب من قيمه', () => {
    assert.equal(detectBehaviorProfile(SIE_DEFAULT_SETTINGS), 'balanced');
    assert.equal(detectBehaviorProfile({ ...SIE_DEFAULT_SETTINGS, ...BEHAVIOR_PROFILES.bold }), 'bold');
    assert.equal(detectBehaviorProfile({ ...SIE_DEFAULT_SETTINGS, ...BEHAVIOR_PROFILES.conservative }), 'conservative');
});

test('detectBehaviorProfile: أي تعديل بإيد بيبقى «مخصص»', () => {
    const tweaked = { ...SIE_DEFAULT_SETTINGS, answer_confidence: 0.5 };
    assert.equal(detectBehaviorProfile(tweaked), 'custom');
});

test('behaviorProfileValues: «مخصص» مالوش قيم', () => {
    assert.equal(behaviorProfileValues('custom'), null);
    assert.ok(behaviorProfileValues('bold'));
});

test('behaviorProfileValues: بيرجع نسخة، مش المرجع نفسه', () => {
    const values = behaviorProfileValues('bold');
    values.answer_confidence = 0.99;
    assert.notEqual(behaviorProfileValues('bold').answer_confidence, 0.99);
});

// ── الاعتماديات ─────────────────────────────────────────────────────

test('isSettingActive: الإعداد بيبقى معطّل لو اللي بيعتمد عليه مقفول', () => {
    const def = SETTINGS_BY_KEY.max_suggested_solutions;
    assert.equal(isSettingActive(def, { suggest_multiple_solutions: true }), true);
    assert.equal(isSettingActive(def, { suggest_multiple_solutions: false }), false);
});

test('isSettingActive: اللي مالوش اعتمادية بيبقى شغّال دايمًا', () => {
    assert.equal(isSettingActive(SETTINGS_BY_KEY.engine_enabled, {}), true);
});

// ── الوعد الأساسي: كل إعداد بيعمل حاجة فعلاً ────────────────────────

test('كل إعداد بيتقرا في كود المحرك فعلاً', async () => {
    // ده أهم اختبار في الملف. لوحة بتعرض مفتاح مالوش تأثير أسوأ من
    // لوحة ناقصة، لأن الموظف بياخد قرار على أساس إن المفتاح شغّال.
    const roots = [
        '../../../sie-integration/sie-chat-bridge.js',
        '../../../sie-integration/sie-entitlement.js',
        '../../../sie-admin/settings.js'
    ];
    const sources = await Promise.all(
        roots.map((rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'))
    );
    const haystack = sources.join('\n');

    const unused = SETTINGS.map((s) => s.key).filter((key) => !haystack.includes(key));
    assert.deepEqual(unused, [], `الإعدادات دي معروضة في اللوحة بس محدش بيقراها: ${unused.join('، ')}`);
});
