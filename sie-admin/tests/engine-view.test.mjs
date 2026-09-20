/**
 * engine-view.test.mjs
 * ------------------------------------------------------------
 * اختبار اللي بيتعرض فعلاً في مركز التحكم.
 *
 * مش اختبار شكل — اختبار **معنى**. المفتاح اللي بيبان مفتوح وهو مقفول أسوأ
 * من مفتاح ناقص، لأن المسؤول هيمشي فاكر إنه ظبط حاجة. وكل تأكيد هنا بيقرا
 * النص اللي المسؤول هيقراه بعينه.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    engineMasterHtml, capabilityGridHtml, rateLimitHtml, shadowHtml, engineAlerts
} from '../ui/engine-view.js';
import { describeCapabilities, describeRateLimit } from '../../sie/config/engine-status.js';
import { SETTINGS_BY_KEY, SIE_DEFAULT_SETTINGS } from '../../sie/config/settings-schema.js';

const caps = (settings, signals = {}) => describeCapabilities({ ...SIE_DEFAULT_SETTINGS, ...settings }, signals);

/** كل `data-key` في نص الـHTML. */
const keysIn = (html) => [...html.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
/** هل المفتاح ده متشيّك؟ */
const checked = (html, key) =>
    new RegExp(`data-key="${key}"[^>]*\\bchecked\\b`).test(html)
    || new RegExp(`data-key="${key}"[\\s\\S]{0,120}?\\bchecked\\b`).test(html.replace(/\n\s+/g, ' '));

// ── الكارت الكبير ──────────────────────────────────────────────

test('المحرك شغّال: الجملة والنقطة والمفتاح كلهم بيقولوا نفس الحاجة', () => {
    const html = engineMasterHtml(caps({ engine_enabled: true }));
    assert.match(html, /المحرك شغّال/);
    assert.match(html, /master-dot--on/);
    assert.ok(checked(html, 'engine_enabled'), 'المفتاح لازم يبان مفتوح');
});

test('المحرك متوقف: الجملة بتقول النتيجة، مش اسم الإعداد', () => {
    const html = engineMasterHtml(caps({ engine_enabled: false }));
    assert.match(html, /المحرك متوقف/);
    assert.match(html, /master-dot--off/);
    assert.ok(!checked(html, 'engine_enabled'), 'المفتاح لازم يبان مقفول');
    assert.match(html, /البوت العادي/, 'لازم يقول للمسؤول هيحصل إيه للعميل');
});

test('عدّاد القدرات المفتوحة بيعد صح', () => {
    // الافتراضي: البحث السريع (مدمج) + حد الطلبات = اتنين من خمسة.
    const none = engineMasterHtml(caps({}));
    assert.match(none, /2 من 5 قدرات/);

    const some = engineMasterHtml(caps({ trust_boundary_enabled: true, sparse_diagnostic_state: true }));
    assert.match(some, /4 من 5 قدرات/);
});

// ── شبكة القدرات ───────────────────────────────────────────────

test('كل مفتاح في الشبكة بيشير لإعداد حقيقي', () => {
    const html = capabilityGridHtml(caps({ trust_boundary_enabled: true }));
    const unknown = keysIn(html).filter((k) => !SETTINGS_BY_KEY[k]);
    assert.deepEqual(unknown, [], `مفاتيح مش موجودة في الإعدادات: ${unknown.join(', ')}`);
});

test('البحث السريع مالوش مفتاح — مدمج، ومابيتعرضش كأن ليه', () => {
    const html = capabilityGridHtml(caps({}));
    assert.match(html, /مدمجة/);
    const cards = html.split('<article');
    const retrieval = cards.find((c) => c.includes('البحث السريع'));
    assert.ok(retrieval, 'الكارت موجود');
    assert.ok(!retrieval.includes('data-key='), 'مالوش يكون فيه مفتاح');
});

test('الحماية: الدرجة التانية مابتظهرش وهي مقفولة — مفتاح مالوش معنى مايتعرضش', () => {
    const off = capabilityGridHtml(caps({ trust_boundary_enabled: false }));
    assert.ok(!off.includes('trust_boundary_enforce'), 'مفيش مفتاح منع والحماية مقفولة');

    const watching = capabilityGridHtml(caps({ trust_boundary_enabled: true }));
    assert.ok(watching.includes('trust_boundary_enforce'), 'الدرجة التانية بتظهر لما الأولى تتفتح');
    assert.ok(!checked(watching, 'trust_boundary_enforce'), 'وبتبان مقفولة');

    const enforcing = capabilityGridHtml(caps({ trust_boundary_enabled: true, trust_boundary_enforce: true }));
    assert.ok(checked(enforcing, 'trust_boundary_enforce'), 'وبتبان مفتوحة لما تتفتح');
});

test('حالات الحماية التلاتة بتتعرض بكلام مختلف وألوان مختلفة', () => {
    const off = capabilityGridHtml(caps({}));
    const watching = capabilityGridHtml(caps({ trust_boundary_enabled: true }));
    const on = capabilityGridHtml(caps({ trust_boundary_enabled: true, trust_boundary_enforce: true }));

    assert.match(watching, /cap-card--watching/);
    assert.match(on, /cap-card--on/);
    assert.match(watching, /بتراقب بس/);
    assert.ok(off.includes('من غير أي فحص'), 'المقفولة بتقول النتيجة');
});

test('الدليل: «لسه مافيش قياس» بيتعرض رمادي، والمؤكد بيتعرض أخضر', () => {
    const noProof = capabilityGridHtml(caps({ trust_boundary_enabled: true }, {}));
    assert.match(noProof, /cap-proof--no/);

    const proven = capabilityGridHtml(caps({ trust_boundary_enabled: true }, { tracesWithTrust: 12 }));
    assert.match(proven, /cap-proof--yes/);
    assert.match(proven, /12/, 'الرقم الحقيقي بيتعرض');
});

test('المستخدم اللي مش من الفريق مايقدرش يلمس أي مفتاح', () => {
    const html = capabilityGridHtml(caps({ trust_boundary_enabled: true }), { isStaff: false });
    const inputs = [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]);
    assert.ok(inputs.length > 0, 'فيه مفاتيح أصلاً');
    for (const input of inputs) {
        assert.match(input, /disabled/, `مفتاح مفتوح لمستخدم مش من الفريق: ${input}`);
    }
});

test('المفاتيح مفتوحة لفريق العمل', () => {
    const html = capabilityGridHtml(caps({}), { isStaff: true });
    assert.ok(!/<input[^>]*disabled/.test(html), 'مفيش مفتاح مقفول على الفريق');
});

// ── حد الطلبات ─────────────────────────────────────────────────

test('حد الطلبات: مفتوح ومؤكد ≠ مفتوح ومش مؤكد', () => {
    const unverified = rateLimitHtml(describeRateLimit({}, []));
    const verified = rateLimitHtml(describeRateLimit({}, [
        { total_requests: 500, total_rejected: 0, last_request_at: '2026-09-20T01:00:00Z' }
    ]));

    assert.match(unverified, /hint--warn/, 'المش مؤكد لازم يحذّر');
    assert.ok(!verified.includes('hint--warn'), 'المؤكد مالوش لازمة تحذير');
    assert.match(verified, /status-line--success/);
});

test('حد الطلبات مقفول: تحذير أحمر ومفيش تأكيد', () => {
    const html = rateLimitHtml(describeRateLimit({ rate_limit_enabled: false }));
    assert.match(html, /status-line--danger/);
    assert.match(html, /أي جهة/);
});

test('حد الطلبات: «مش معروف» مش «صفر»', () => {
    const html = rateLimitHtml(describeRateLimit({}, null));
    assert.match(html, /مش معروف/, 'مقدرناش نقرا ≠ مفيش طلبات');
});

// ── النسخة التجريبية ───────────────────────────────────────────

test('النسخة التجريبية: تلات حالات مختلفة تمامًا', () => {
    const off = shadowHtml({ enabled: false });
    const empty = shadowHtml({ enabled: true, records: [] });
    const busy = shadowHtml({
        enabled: true,
        records: [{ status: 'ok', agreed: true }, { status: 'ok', agreed: true }, { status: 'ok', agreed: false }]
    });

    assert.match(off, /مش شغّالة/);
    assert.match(empty, /لسه مافيش مقارنات/);
    assert.match(busy, /67%/, 'اتنين من تلاتة');
    assert.match(busy, /محتاج مراجعة/, 'الاختلاف لازم يتقال إنه محتاج مراجعة');
});

test('النسخة التجريبية: اتفاق كامل بيتقال إنه اتفاق كامل', () => {
    const html = shadowHtml({ enabled: true, records: [{ status: 'ok', agreed: true }] });
    assert.match(html, /100%/);
    assert.match(html, /status-line--success/);
    assert.match(html, /مفيش أي اختلاف/);
});

test('النسخة التجريبية: الأخطاء والوقت الزايد بيتعدوا لوحدهم', () => {
    const html = shadowHtml({
        enabled: true,
        records: [{ status: 'ok', agreed: true }, { status: 'error' }, { status: 'timeout' }]
    });
    assert.match(html, /100%/, 'النسبة على اللي نجح بس');
    assert.match(html, /أخطاء<\/dt><dd>1/);
    assert.match(html, /تجاوزوا الوقت<\/dt><dd>1/);
});

test('النسخة التجريبية بتقول صراحة إن العميل مش بيشوفها', () => {
    assert.match(shadowHtml({ enabled: false }), /العميل مش بيشوف/);
});

// ── التنبيهات ──────────────────────────────────────────────────

test('التنبيهات: المحرك المتوقف وحد الطلبات المقفول خطر أحمر', () => {
    const alerts = engineAlerts(caps({ engine_enabled: false, rate_limit_enabled: false }),
        { engine_enabled: false, rate_limit_enabled: false });
    assert.equal(alerts.filter((a) => a.tone === 'danger').length, 2);
});

test('التنبيهات: الحماية اللي بتراقب بس تنبيه معلوماتي مش خطر', () => {
    const settings = { ...SIE_DEFAULT_SETTINGS, trust_boundary_enabled: true };
    const alerts = engineAlerts(caps(settings), settings);
    const watch = alerts.find((a) => /بتسجّل بس/.test(a.text));
    assert.ok(watch, 'التنبيه موجود');
    assert.equal(watch.tone, 'info', 'ده وضع صح في البداية، مش خطر');
});

test('التنبيهات: كل حاجة تمام = مفيش تنبيهات', () => {
    const alerts = engineAlerts(caps({}), SIE_DEFAULT_SETTINGS);
    assert.deepEqual(alerts, [], 'مفيش تنبيه من غير سبب');
});

test('التنبيهات: المستخدم المتفرّج بيتقاله إنه متفرّج', () => {
    const alerts = engineAlerts(caps({}), SIE_DEFAULT_SETTINGS, { isStaff: false });
    assert.ok(alerts.some((a) => /بتتفرّج/.test(a.text)));
});

// ── الهروب من الـHTML ──────────────────────────────────────────

test('النص اللي جاي من البيانات بيتهرب، مابيتحقنش', () => {
    const hostile = [{ id: 'engine', title: '<img src=x onerror=alert(1)>', what: '', means: '', keys: [], switchState: 'on', switchLabel: 'x', proofLabel: '' }];
    const html = engineMasterHtml(hostile);
    assert.ok(!html.includes('<img'), 'لازم يتهرب');
});
