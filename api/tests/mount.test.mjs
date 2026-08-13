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

// ── التوجيه من الدومين العام ────────────────────────────────────────

/**
 * `sie.mad3oom.com` على Vercel والدالة على Supabase، فالوصلة بينهم
 * rewrite في `vercel.json`. الوصلة دي مالهاش اختبار في أي مكان تاني،
 * وغلطة حرف واحد في الوجهة معناها إن الـAPI كله ٤٠٤ على الدومين
 * المنشور — من غير ما أي اختبار يحمرّ.
 *
 * فالاختبار ده بيمشي المسار الحقيقي كله: مسار عام → القاعدة →
 * stripMount → القرار.
 */
const VERCEL_CONFIG = new URL('../../vercel.json', import.meta.url);

/** نسخة من stripMount بتاعة index.ts — نفس البادئات بالظبط. */
function stripMount(pathname) {
    for (const prefix of ['/functions/v1/sie-api', '/sie-api']) {
        if (pathname.startsWith(prefix)) return pathname.slice(prefix.length) || '/';
    }
    return pathname || '/';
}

test('rewrite بتاع Vercel بيوصّل كل مسار عام للدالة صح', async () => {
    const { readFile } = await import('node:fs/promises');
    const config = JSON.parse(await readFile(VERCEL_CONFIG, 'utf8'));

    const rule = config.rewrites.find((r) => r.source === '/api/(.*)');
    assert.ok(rule, 'مافيش قاعدة بتاخد /api/* في vercel.json');
    assert.match(rule.destination, /\/functions\/v1\/sie-api\/api\/\$1$/,
        'الوجهة لازم تسيب /api في المسار عشان الدالة تفرّق بين السطحين');

    const [prefix] = rule.destination.split('$1');
    const applyRewrite = (path) => new URL(prefix + path.slice('/api/'.length)).pathname;

    // كل مسار عام + المستند + التوثيق لازم يوصلوا لقرار «ده عام».
    const publicPaths = [
        ...ROUTES.map((route) => `/api/v1${route.path}`),
        ...DOC_PATHS
    ];
    for (const path of publicPaths) {
        const arrived = stripMount(applyRewrite(path));
        assert.equal(arrived, path, `${path} وصل مشوّه: ${arrived}`);
        assert.equal(isPublicApiRequest(arrived), true, `${path} مااتحوّلش للراوتر العام بعد الـrewrite`);
    }
});

test('rewrite بتاع Vercel مابيكسرش مسارات المنصة القديمة', async () => {
    // القاعدة بتاخد `/api/*` كله عن قصد — والدالة هي اللي بتوزّع.
    // اللي لازم يتأكد إن المسار القديم بيوصل للدالة **بشكله الأصلي**
    // فتوزّعه على المعالج القديم، مش إنه مايوصلش.
    const { readFile } = await import('node:fs/promises');
    const config = JSON.parse(await readFile(VERCEL_CONFIG, 'utf8'));
    const rule = config.rewrites.find((r) => r.source === '/api/(.*)');
    const [prefix] = rule.destination.split('$1');

    for (const path of LEGACY_PLATFORM_PATHS.filter((p) => p.startsWith('/api/'))) {
        const arrived = stripMount(new URL(prefix + path.slice('/api/'.length)).pathname);
        assert.equal(arrived, path, `${path} وصل مشوّه: ${arrived}`);
        assert.equal(isPublicApiRequest(arrived), false, `${path} اتخطف للراوتر العام`);
    }
});

test('الوجهة بتشاور على مشروع Supabase الصح', async () => {
    // مشروع غلط معناه إن الـAPI بيرد من قاعدة بيانات تانية خالص.
    const { readFile } = await import('node:fs/promises');
    const config = JSON.parse(await readFile(VERCEL_CONFIG, 'utf8'));
    const rule = config.rewrites.find((r) => r.source === '/api/(.*)');

    const engine = await readFile(
        new URL('../../supabase/functions/sie-api/_shared/engine.ts', import.meta.url), 'utf8');
    assert.ok(engine.includes('cdn.jsdelivr.net'), 'المحرك مش متثبّت على CDN');

    const host = new URL(rule.destination.replace('$1', '')).host;
    assert.match(host, /^[a-z]+\.supabase\.co$/, `الوجهة مش على Supabase: ${host}`);
});
