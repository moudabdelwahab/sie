/**
 * engine-status.test.mjs
 * ------------------------------------------------------------
 * القسم ده هو اللي بيقرر إيه اللي بيتعرض للمسؤول، فالاختبار هنا مش عن
 * الشكل — عن الفرق بين «المفتاح مفتوح» و«القدرة بتشتغل فعلاً»، وعن إن
 * كل مفتاح خطير لسه متحمي.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    describeCapabilities, describeRateLimit, isSensitiveSetting,
    confirmTextFor, SENSITIVE_KEYS, SWITCH_STATE, PROOF_STATE
} from '../engine-status.js';
import { SIE_DEFAULT_SETTINGS, SETTINGS_BY_KEY } from '../settings-schema.js';

const byId = (caps, id) => caps.find((c) => c.id === id);

// ── الحالة بتتقرا من الإعدادات، مش متخيلة ──────────────────────

test('القدرات: الافتراضي بيعكس إن المفاتيح الجديدة مقفولة', () => {
    const caps = describeCapabilities(SIE_DEFAULT_SETTINGS, {});
    assert.equal(byId(caps, 'engine').switchState, SWITCH_STATE.ON, 'المحرك مفتوح افتراضيًا');
    assert.equal(byId(caps, 'rate_limit').switchState, SWITCH_STATE.ON, 'حد الطلبات مفتوح افتراضيًا');
    assert.equal(byId(caps, 'trust').switchState, SWITCH_STATE.OFF);
    assert.equal(byId(caps, 'sparse_state').switchState, SWITCH_STATE.OFF);
    assert.equal(byId(caps, 'shadow').switchState, SWITCH_STATE.OFF);
});

test('الحماية ليها تلات حالات، والفرق بينهم مهم', () => {
    const off = byId(describeCapabilities({}, {}), 'trust');
    const watching = byId(describeCapabilities({ trust_boundary_enabled: true }, {}), 'trust');
    const enforcing = byId(describeCapabilities({ trust_boundary_enabled: true, trust_boundary_enforce: true }, {}), 'trust');

    assert.equal(off.switchState, SWITCH_STATE.OFF);
    assert.equal(watching.switchState, SWITCH_STATE.WATCHING);
    assert.equal(enforcing.switchState, SWITCH_STATE.ON);

    // الجملة اللي بتتعرض لازم تفرق — «بتراقب» و«بتمنع» مش نفس الكلام.
    assert.notEqual(watching.means, enforcing.means);
    assert.match(watching.means, /مابتمنعش|تسجّل/);
});

test('البحث السريع مدمج — مالوش مفتاح، ومابيتعرضش كأن ليه', () => {
    const cap = byId(describeCapabilities({}, {}), 'retrieval');
    assert.equal(cap.alwaysOn, true);
    assert.deepEqual(cap.keys, []);
    assert.equal(cap.switchState, SWITCH_STATE.ON);
});

// ── الدليل: «لسه مافيش قياس» إجابة، مش علامة خضراء ──────────────

test('قدرة مفتوحة من غير إشارة بتتعرض «لسه مافيش قياس»، مش مؤكدة', () => {
    const cap = byId(describeCapabilities({ trust_boundary_enabled: true }, {}), 'trust');
    assert.equal(cap.proofState, PROOF_STATE.NONE);
    assert.match(cap.proofLabel, /لسه|مافيش/);
});

test('الإشارة الحقيقية بتخلي الدليل مؤكد، والرقم بيتعرض', () => {
    const cap = byId(describeCapabilities({ trust_boundary_enabled: true }, { tracesWithTrust: 42 }), 'trust');
    assert.equal(cap.proofState, PROOF_STATE.CONFIRMED);
    assert.match(cap.proofLabel, /٤٢/, 'الرقم بيتعرض بالعربي');
});

test('إشارة بصفر معناها «مافيش نشاط»، مش مؤكدة', () => {
    const cap = byId(describeCapabilities({ shadow_run_enabled: true }, { tracesWithShadow: 0 }), 'shadow');
    assert.equal(cap.proofState, PROOF_STATE.NONE);
});

test('القدرة المقفولة مالهاش دليل أصلاً — مفيش حاجة تتأكد', () => {
    const cap = byId(describeCapabilities({}, { tracesWithTrust: 99 }), 'trust');
    assert.equal(cap.proofState, PROOF_STATE.NOT_APPLICABLE);
    assert.equal(cap.proofLabel, '');
});

// ── حد الطلبات: الإعداد بيقول المفروض، الدلاء بتقول الواقع ──────

test('حد الطلبات: مقفول = خطر واضح', () => {
    const status = describeRateLimit({ rate_limit_enabled: false });
    assert.equal(status.enabled, false);
    assert.equal(status.tone, 'danger');
    assert.equal(status.verified, false);
});

test('حد الطلبات: مفتوح من غير أي طلب = مش مؤكد', () => {
    const status = describeRateLimit({}, []);
    assert.equal(status.enabled, true);
    assert.equal(status.verified, false, 'مفيش طلبات يعني مفيش دليل');
    assert.match(status.detail, /مفيش طلبات|مفيش دليل/);
});

test('حد الطلبات: مفتوح ومعدّى عليه طلبات = مؤكد', () => {
    const status = describeRateLimit({}, [
        { total_requests: 300, total_rejected: 0, last_request_at: '2026-09-20T01:00:00Z' },
        { total_requests: 40, total_rejected: 4, last_request_at: '2026-09-20T02:00:00Z' }
    ]);
    assert.equal(status.verified, true);
    assert.equal(status.requests, 340);
    assert.equal(status.rejected, 4);
    assert.equal(status.lastSeen, '2026-09-20T02:00:00Z', 'أحدث طلب، مش أول واحد');
    assert.equal(status.tone, 'warning', 'فيه رفض يعني فيه حد قرّب من الحد');
});

test('حد الطلبات: مقدرناش نقرا الدلاء ≠ مفيش طلبات', () => {
    const unreadable = describeRateLimit({}, null);
    const empty = describeRateLimit({}, []);
    assert.equal(unreadable.verified, false);
    assert.equal(empty.verified, false);
    assert.notEqual(unreadable.detail, empty.detail, 'الفرق بين «مش عارفين» و«مفيش» لازم يبان');
});

// ── الإعدادات الحسّاسة ─────────────────────────────────────────

test('كل مفتاح حسّاس موجود فعلاً في وصف الإعدادات', () => {
    for (const key of SENSITIVE_KEYS) {
        assert.ok(SETTINGS_BY_KEY[key], `«${key}» متحمي بس مش موجود في الإعدادات`);
    }
});

test('المفاتيح اللي إغلاقها بيوقف المحرك أو بيفتح الباب كلها متحمية', () => {
    // القايمة دي هي **الشرط**، مش نسخة من الكود: أي مفتاح هنا لازم يكون
    // متحمي، ولو حد شال الحماية عنه الاختبار ده بيوقع.
    for (const key of ['engine_enabled', 'rate_limit_enabled', 'trust_boundary_enforce']) {
        assert.equal(isSensitiveSetting(key), true, `«${key}» المفروض يطلب تأكيد`);
    }
    assert.equal(isSensitiveSetting('emotion_sarcasm'), false, 'إعداد عادي مالوش لازمة يوقف المستخدم');
});

test('نص التأكيد بيوصف النتيجة، مش الإعداد', () => {
    const off = confirmTextFor('engine_enabled', false, SETTINGS_BY_KEY.engine_enabled);
    assert.equal(off.tone, 'danger');
    assert.match(off.body, /كل العملاء/, 'لازم يقول مين هيتأثر');
    assert.ok(!/engine_enabled|false/.test(off.body), 'مفيش أسماء مفاتيح ولا قيم في كلام المستخدم');

    const on = confirmTextFor('engine_enabled', true, SETTINGS_BY_KEY.engine_enabled);
    assert.equal(on.tone, 'primary');
    assert.notEqual(on.body, off.body, 'الفتح والقفل مش نفس التحذير');
});

test('تشغيل المنع الحقيقي بيحذّر من الإنذارات الغلط', () => {
    const text = confirmTextFor('trust_boundary_enforce', true, SETTINGS_BY_KEY.trust_boundary_enforce);
    assert.match(text.body, /الإنذارات|راجع/);
});

// ── اللغة: اللوحة عربية بالكامل ────────────────────────────────

test('مفيش مصطلح إنجليزي في أي كلام بيتعرض للمسؤول', () => {
    const caps = describeCapabilities({ trust_boundary_enabled: true, shadow_run_enabled: true }, {});
    const visible = [];
    for (const cap of caps) visible.push(cap.title, cap.what, cap.means, cap.switchLabel);
    for (const key of SENSITIVE_KEYS) {
        const text = confirmTextFor(key, false, SETTINGS_BY_KEY[key]);
        visible.push(text.title, text.body, text.confirmLabel);
    }
    visible.push(describeRateLimit({}, []).detail, describeRateLimit({ rate_limit_enabled: false }).detail);

    const offenders = visible.filter((t) => /[A-Za-z]{3,}/.test(String(t)));
    assert.deepEqual(offenders, [], `كلام فيه إنجليزي:\n${offenders.join('\n')}`);
});
