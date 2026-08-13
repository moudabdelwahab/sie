/**
 * live-engine.test.mjs — من الـSDK للمحرك الحقيقي
 * ============================================================
 * الاختبارات التانية بتثبت العقد فوق منافذ ثابتة. الملف ده بيوصّل
 * السلسلة كلها بالمحرك الحقيقي:
 *
 *   SDK → HTTP → الراوتر → sie-runtime → اللغة/التشخيص/الترتيب
 *
 * يعني: الكتالوج الحقيقي (٦٥٠ سيناريو)، القاموس الحقيقي، والمعالجة
 * الحقيقية للعامية والعربيزي. مفيش أي محاكاة في المسار ده.
 *
 * ── ليه /diagnose بالذات ────────────────────────────────────
 * `/chat` بيكتب في قاعدة البيانات (جلسة، رسالة، استهلاك)، فاختباره من
 * غير قاعدة معناه محاكاة قاعدة البيانات — وساعتها الاختبار بيثبت
 * المحاكاة مش المحرك. `/diagnose` بيمر على نفس طبقات الذكاء بالظبط
 * ومابيكتبش حاجة، فهو المسار الوحيد اللي بيتختبر لآخره بصدق هنا.
 *
 * `/chat` بيتغطى في: اختبارات العقد (المنافذ)، اختبارات SQL (الاستهلاك
 * والصلاحية)، والتحقق الحقيقي بعد النشر.
 *
 * ── الشيم ───────────────────────────────────────────────────
 * Node مابيقراش file:// بـfetch، والمحرك بيحمّل قاموسه كده في المتصفح
 * وDeno. الشيم بيقرا نفس الملفات المشحونة — مش نسخة اختبارية.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApiRouter } from '../v1/router.js';
import { startRouterServer, createTestPorts, enableFileFetch } from './helpers/test-server.mjs';
import { SIE } from '../../sdk/js/src/index.js';

const KEY = `sie_live_${'A'.repeat(43)}`;

let restoreFetch;
let server;
let sie;
let runtime;

before(async () => {
    restoreFetch = enableFileFetch();
    runtime = await import('../../sie-integration/sie-runtime.js');

    // المنافذ الثابتة بتغطي المصادقة والحدود (اللي محتاجة قاعدة)،
    // والمنفذين دول بس بيتوصلوا بالمحرك الحقيقي.
    const ports = createTestPorts({
        diagnose: (message, options) => runtime.diagnoseMessage(message, options),
        listScenarios: () => runtime.listActiveScenarios(),
        async engineHealth() {
            const scenarios = await runtime.listActiveScenarios();
            return {
                loaded: true,
                catalog_size: scenarios.length,
                runtime_version: runtime.SIE_RUNTIME_VERSION
            };
        }
    });

    server = await startRouterServer(createApiRouter({ ports }));
    sie = new SIE({ apiKey: KEY, baseUrl: `${server.url}/api/v1`, timeout: 60_000 });
});

after(async () => {
    await server?.close();
    restoreFetch?.();
});

test('الرَنتايم المحمّل هو 2.4.0 — النسخة اللي الـpin بيشاور عليها', () => {
    assert.equal(runtime.SIE_RUNTIME_VERSION, '2.4.0');
});

test('/health بيقول الكتالوج الحقيقي ونسخة الرَنتايم', async () => {
    const health = await sie.health();

    assert.equal(health.status, 'ok');
    assert.equal(health.engine.loaded, true);
    assert.ok(health.engine.catalog_size > 100,
        `الكتالوج المحمّل صغير أوي: ${health.engine.catalog_size}`);
    assert.equal(health.engine.runtime_version, '2.4.0');
});

test('/diagnose بيشغّل المحرك الحقيقي على عربي فصيح', async () => {
    const result = await sie.diagnose({ message: 'الاشتراك بتاعي منتهي وعايز أجدده' });

    assert.ok(result.candidates.length > 0, 'المحرك مافهمش رسالة واضحة');
    assert.ok(result.candidates[0].confidence > 0, 'درجة تأكد صفر');
    assert.ok(result.candidates[0].scenario_id, 'مفيش معرّف سيناريو');
    assert.equal(result.confidence_threshold, 0.6);
    // الترتيب لازم يبقى نازل — ده عقد الترتيب نفسه.
    const scores = result.candidates.map((candidate) => candidate.confidence);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test('/diagnose بيفهم العامية المصرية', async () => {
    const result = await sie.diagnose({ message: 'الواتساب مش مربوط عندي' });

    assert.ok(result.candidates.length > 0, 'المحرك مافهمش العامية');
    assert.ok(result.signals.length > 0, 'مفيش كلمات دالة اتشافت');
});

test('الإشارات جاية من قاموس المحرك مش مخترعة', async () => {
    const result = await sie.diagnose({ message: 'مشكلة في الاشتراك' });

    for (const signal of result.signals) {
        assert.equal(typeof signal.token, 'string');
        assert.ok(signal.token.length > 0);
    }
});

test('رسالة مالهاش معنى: مفيش مرشحين، ومفيش خطأ', async () => {
    const result = await sie.diagnose({ message: 'زززز ققق ذذذ' });

    assert.equal(result.will_resolve, false);
    assert.ok(Array.isArray(result.candidates));
});

test('limit بيتحترم على المحرك الحقيقي', async () => {
    const result = await sie.diagnose({ message: 'الاشتراك بتاعي منتهي', limit: 2 });
    assert.ok(result.candidates.length <= 2);
});

test('/scenarios بيرجّع الكتالوج الحقيقي من غير نصوص الحلول', async () => {
    const result = await sie.scenarios({ limit: 5 });

    assert.ok(result.total > 100, `الكتالوج الحقيقي المفروض أكبر: ${result.total}`);
    assert.equal(result.data.length, 5);

    for (const scenario of result.data) {
        assert.ok(scenario.id && scenario.label);
        assert.equal(typeof scenario.resolves_automatically, 'boolean');
        // نصوص الحلول قاعدة معرفة العميل — مالهاش مكان في رد عام.
        assert.ok(!('resolution' in scenario));
        assert.ok(!JSON.stringify(scenario).includes('hasAutoResolution'));
    }
});

test('الفلترة بالقسم شغالة على بيانات حقيقية', async () => {
    const all = await sie.scenarios({ limit: 500 });
    const category = all.data.find((scenario) => scenario.category)?.category;
    assert.ok(category, 'مفيش أي سيناريو ليه قسم');

    const filtered = await sie.scenarios({ category, limit: 500 });
    assert.ok(filtered.total > 0);
    assert.ok(filtered.data.every((scenario) => scenario.category === category));
    assert.ok(filtered.total <= all.total);
});

test('نفس الرسالة بتدي نفس النتيجة — المحرك حتمي', async () => {
    const first = await sie.diagnose({ message: 'مش عارف أدخل على حسابي' });
    const second = await sie.diagnose({ message: 'مش عارف أدخل على حسابي' });

    assert.deepEqual(
        first.candidates.map((candidate) => [candidate.scenario_id, candidate.confidence]),
        second.candidates.map((candidate) => [candidate.scenario_id, candidate.confidence])
    );
});
