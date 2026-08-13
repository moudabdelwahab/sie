/**
 * mount.js — مين بياخد الطلب: الـAPI العام ولا المسارات القديمة؟
 * ============================================================
 * الدالة الطرفية `sie-api` بتخدم اتنين مختلفين تمامًا على نفس الأصل:
 *
 *   - مسارات منصة مدعوم القديمة (`/api/v1/chat/reply`, `/api/v1/access/…`)
 *     اللي بتتكلم بتوكن المستخدم، وموجودة من قبل الـAPI العام بكتير.
 *   - الـAPI العام (`/api/v1/chat`, `/api/v1/me`, …) اللي بيتكلم بمفتاح.
 *
 * البادئة واحدة، فالتفرقة لازم تكون **دقيقة**: لو مسار قديم اتوجّه
 * للراوتر العام، هيترفض بـ٤٠١ لأنه مالوش مفتاح API — يعني كل محادثة
 * على منصة مدعوم تقع. ولو مسار عام اتوجّه للقديم، هياخد ٤٠٤.
 *
 * عشان كده الشرط هنا **قائمة صريحة** من جدول الراوتر نفسه، مش نمط زي
 * «أي حاجة تحت /api». الملف ده في الطبقة المحمولة عشان يتختبر في Node
 * من غير Deno ولا شبكة — وده اللي بيخلي «/api/v1/chat/reply مايتحوّلش»
 * جملة متأكد منها مش مفترضة.
 */
import { ROUTES, SUPPORTED_VERSIONS } from './router.js';

/** المسارات العامة، من جدول الراوتر — مش مكتوبة تاني. */
const PUBLIC_PATHS = new Set(ROUTES.map((route) => route.path));

/** مسارات المستند والتوثيق: عامة، من غير مفتاح، ومن غير إصدار. */
export const DOC_PATHS = Object.freeze(['/api/openapi.json', '/api/docs']);

/**
 * @param {string} path المسار بعد شيل بادئة Supabase، لسه فيه `/api`
 * @returns {boolean}
 */
export function isPublicApiRequest(path) {
    const clean = String(path ?? '').split('?')[0];
    if (DOC_PATHS.includes(clean)) return true;

    const match = /^\/api\/(v\d+)(\/.*)?$/.exec(clean);
    if (!match) return false;

    const [, version, rest = '/'] = match;

    // إصدار مش مدعوم بيروح للراوتر العام عن قصد: هو اللي بيعرف يرد
    // `unsupported_version` بقائمة المدعوم. المسارات القديمة كلها على
    // v1، فمفيش تعارض.
    if (!SUPPORTED_VERSIONS.includes(version)) return true;

    return PUBLIC_PATHS.has(rest.replace(/\/+$/, '') || '/');
}
