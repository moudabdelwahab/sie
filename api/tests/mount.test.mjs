/**
 * mount.test.mjs — التوجيه بين الـAPI العام والمسارات القديمة
 * ============================================================
 * الدالة الطرفية بتخدم اتنين على نفس البادئة `/api/v1`:
 * مسارات منصة مدعوم القديمة (بتوكن مستخدم)، والـAPI العام (بمفتاح).
 *
 * الاختبار ده بيحرس الحد بينهم في الاتجاهين، لأن الغلطة في أي اتجاه
 * غالية:
 *
 *   - مسار قديم اتوجّه للعام  → ٤٠١، يعني كل محادثة على المنصة تقع.
 *   - مسار عام اتوجّه للقديم  → ٤٠٤، يعني الـAPI مش موجود.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicApiRequest, DOC_PATHS } from '../v1/mount.js';
import { ROUTES } from '../v1/router.js';

/**
 * المسارات اللي منصة مدعوم بتناديها فعلاً.
 * مأخوذة من supabase/functions/sie-api/README.md — أي واحد فيهم
 * يتحوّل للراوتر العام معناه عطل في الإنتاج.
 */
const LEGACY_PLATFORM_PATHS = [
    '/api/v1/chat/reply',
    '/api/v1/admin/is-admin',
    '/api/v1/admin/access',
    '/api/v1/admin/access/reset-usage',
    '/api/v1/access/status',
    '/api/v1/access/set',
    '/api/v1/access/reset',
    '/api/v1/access/9f1c2b7e-4d3a-4f5b-8c6d-0e1f2a3b4c5d',
    '/v1/chat/reply',
    '/v1/health',
    '/health'
];

test('مسارات المنصة القديمة مابتتحوّلش للـAPI العام', () => {
    for (const path of LEGACY_PLATFORM_PATHS) {
        assert.equal(isPublicApiRequest(path), false, `${path} اتحوّل للراوتر العام`);
    }
});

test('كل مسار في جدول الراوتر بيتحوّل للـAPI العام', () => {
    for (const route of ROUTES) {
        assert.equal(isPublicApiRequest(`/api/v1${route.path}`), true,
            `/api/v1${route.path} مااتحوّلش للراوتر العام`);
    }
});

test('المسارات العامة بتتقبل بشرطة زايدة وبـquery', () => {
    assert.equal(isPublicApiRequest('/api/v1/scenarios/'), true);
    assert.equal(isPublicApiRequest('/api/v1/scenarios?category=login&limit=5'), true);
});

test('المستند والتوثيق مسارات عامة', () => {
    for (const path of DOC_PATHS) {
        assert.equal(isPublicApiRequest(path), true, `${path} مش متعرّف كمسار عام`);
    }
});

test('إصدار مش مدعوم بيروح للراوتر العام عشان يرد بالخطأ الصح', () => {
    // الراوتر بيرد `unsupported_version` بقائمة المدعوم. لو سبناه
    // للقديم كان هياخد ٤٠٤ عامة من غير أي إرشاد.
    assert.equal(isPublicApiRequest('/api/v2/chat'), true);
    assert.equal(isPublicApiRequest('/api/v9/anything'), true);
});

test('مسار تحت /api/v1 مش معروف مابيتخطفش من القديم', () => {
    // `/api/v1/chat/reply` هو الحالة الحقيقية: بادئة مسار عام
    // (`/chat`) وبعدها جزء زيادة. لازم يفضل للقديم.
    assert.equal(isPublicApiRequest('/api/v1/chat/reply'), false);
    assert.equal(isPublicApiRequest('/api/v1/me/extra'), false);
    assert.equal(isPublicApiRequest('/api/v1/unknown'), false);
});

test('مسارات برّه /api خالص مالهاش علاقة', () => {
    for (const path of ['/', '/functions/v1/sie-api', '/apiv1/chat', '/api', '/apix/v1/chat']) {
        assert.equal(isPublicApiRequest(path), false, `${path} اتحسب مسار عام`);
    }
});

test('الشرط بياخد المسار بعد بادئة Supabase', () => {
    // index.ts بيشيل بادئة Supabase قبل ما ينده، فالشكل اللي بيوصل
    // هنا هو `/api/v1/...` — الاختبار بيثبت الافتراض ده.
    assert.equal(isPublicApiRequest('/api/v1/health'), true);
    assert.equal(isPublicApiRequest('/functions/v1/sie-api/api/v1/health'), false,
        'الشرط لازم ياخد المسار بعد شيل البادئة، مش قبلها');
});
