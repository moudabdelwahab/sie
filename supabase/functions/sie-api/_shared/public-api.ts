/**
 * public-api.ts — تركيب الـAPI العام جوه الدالة الطرفية
 * ------------------------------------------------------------
 * الملف ده **مابيعرّفش أي مسار**. المسارات كلها عايشة في
 * `api/v1/router.js` في الريبو، والملف ده بيوصّلها بالبيئة: عميل
 * Supabase بصلاحية الخدمة، الرَنتايم المثبّت، وقايمة الأصول المسموحة.
 *
 * ── ليه فيه ملف تركيب أصلاً ─────────────────────────────────
 * الراوتر بيتشغّل في Node (الاختبارات) وفي Deno (هنا). الحاجات الوحيدة
 * اللي بتختلف بين الاتنين هي اللي في الملف ده: من فين ييجي المحرك، ومن
 * فين ييجي مفتاح الخدمة، وإيه الأصول المسموح لها. أي حاجة تانية تتكتب
 * هنا معناها إن الاختبارات بتختبر API تاني غير المنشور.
 *
 * ── الفصل عن المسارات القديمة ───────────────────────────────
 * مسارات `/v1/*` القديمة (اللي منصة مدعوم بتناديها) مالهاش أي علاقة
 * بالملف ده: لسه بتتكلم بتوكن المستخدم، ولسه بتعدي على حد المعدل
 * القديم، ولسه بترد بنفس الأشكال. الـAPI العام بيتوجّه له **قبلها**
 * وبس لما المسار يكون واحد من مساراته هو بالظبط — عشان مايمرش على
 * حد المعدل مرتين (مرة بدلو الـIP ومرة بدلو الحساب).
 */
import { createApiRouter } from '../../../../api/v1/router.js';
import { isPublicApiRequest } from '../../../../api/v1/mount.js';
import { createApiPorts } from '../../../../api/v1/ports.js';
import { buildOpenApiDocument } from '../../../../api/openapi.js';
import { renderDocsPage } from '../../../../api/docs.js';
import { buildServiceClient } from './supabase-client.ts';
import { runtime, SIE_RUNTIME_VERSION } from './engine.ts';

/**
 * العنوان اللي العملاء بيشوفوه. بيدخل في مستند OpenAPI وفي التوثيق،
 * فلو الدومين اتغير، السطر ده (أو المتغير) هو اللي بيتغير.
 */
const PUBLIC_BASE_URL = Deno.env.get('SIE_PUBLIC_BASE_URL') ?? 'https://sie.mad3oom.com';

/**
 * الأصول المسموح لها تنده الـAPI من متصفح.
 *
 * فاضية افتراضيًا **عن قصد**: ده API للسيرفرات، والمفتاح مالوش مكان في
 * صفحة. أي أصل هنا معناه إن حد قرر إنه محتاج نداء من متصفح وقبل إن
 * المفتاح يبقى مكشوف لأي حد بيفتح devtools.
 *
 * SIE_API_ALLOWED_ORIGINS="https://a.example,https://b.example"
 */
const ALLOWED_ORIGINS = (Deno.env.get('SIE_API_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

/**
 * العميل والمنافذ بيتبنوا مرة واحدة لكل نسخة من الدالة، مش لكل طلب:
 * بناء عميل Supabase بيعمل شغل، والدالة بتتنادى آلاف المرات على نفس
 * النسخة.
 */
const serviceClient = buildServiceClient();
const basePorts = createApiPorts({ supabase: serviceClient, runtime });

/**
 * الصحة بتقول نسخة الرَنتايم اللي **اتحمّلت فعلاً**.
 *
 * ده اللي بيحوّل الـpin من نية لحقيقة قابلة للفحص: بعد أي نشر، نداء
 * واحد على /api/v1/health بيقول المحرك اللي شغال نسخته كام. الرقم جاي
 * من الوحدة المحمّلة نفسها.
 *
 * `catalogSize` بالاسم القديم كمان: فاحص الصحة في منصة مدعوم اتكتب على
 * الشكل القديم، وإضافة مفتاح أرخص من كسر فاحص شغّال.
 */
const ports = {
    ...basePorts,
    async engineHealth() {
        const health = await basePorts.engineHealth();
        return {
            ...health,
            runtime_version: SIE_RUNTIME_VERSION,
            catalogSize: health.catalog_size
        };
    }
};

export const publicApi = createApiRouter({
    ports,
    config: { allowedOrigins: ALLOWED_ORIGINS }
});

/**
 * هل الطلب ده للـAPI العام؟
 *
 * الشرط نفسه متعرّف في `api/v1/mount.js` عشان يتختبر في Node من غير
 * Deno — ده أخطر سطر في التركيبة كلها: لو مسار قديم زي
 * `/api/v1/chat/reply` اتوجّه هنا بالغلط، كل محادثة على منصة مدعوم
 * بتقع بـ٤٠١.
 */
export { isPublicApiRequest };

/**
 * المستند والتوثيق. الاتنين عامّين ومن غير مفتاح — محتواهم منشور
 * أصلاً، ومطوّر بيقرا التوثيق لسه مافيش عنده مفتاح.
 */
export function servePublicDoc(path: string): Response | null {
    if (path === '/api/openapi.json') {
        return new Response(JSON.stringify(buildOpenApiDocument({ baseUrl: PUBLIC_BASE_URL }), null, 2), {
            status: 200,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                // قراءة عامة: مفيش مصادقة ولا بيانات عميل هنا، والأدوات
                // (Postman/Swagger/مولّدات العملاء) بتجيبه من أي مكان.
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=300'
            }
        });
    }

    if (path === '/api/docs') {
        return new Response(renderDocsPage({ baseUrl: PUBLIC_BASE_URL }), {
            status: 200,
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=300',
                // الصفحة مافيهاش سكربت خارجي، فالسياسة ضيقة فعلاً.
                'Content-Security-Policy':
                    "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; "
                    + "font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; "
                    + "connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'",
                'X-Content-Type-Options': 'nosniff',
                'Referrer-Policy': 'no-referrer'
            }
        });
    }

    return null;
}
