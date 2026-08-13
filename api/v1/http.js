/**
 * http.js — أدوات HTTP للـAPI العام
 * ============================================================
 * معرّفات الطلبات، قراءة الجسم بحد أقصى، CORS، وشكل الرد.
 *
 * كله على Web APIs القياسية (Request/Response/crypto)، فنفس الملف بيشتغل
 * في Deno (الدالة الطرفية) وNode 18+ (الاختبارات) والمتصفح من غير أي
 * طبقة توافق.
 */
import { ApiError } from './errors.js';

/** أكبر جسم طلب مقبول. الرسالة الطبيعية بضع مئات من البايتات. */
export const MAX_BODY_BYTES = 32 * 1024;

/** أطول رسالة مقبولة. أطول من كده مش سؤال دعم، ده لصق ملف. */
export const MAX_MESSAGE_CHARS = 4000;

/**
 * معرّف طلب.
 *
 * بيتولد لكل طلب، وبيرجع في الهيدر وفي كل رد خطأ. ده الرقم اللي العميل
 * بيبعته للدعم، واللي بيربط سطر السجل بالطلب اللي العميل شافه.
 *
 * بنقبل معرّف من العميل لو بعت واحد — التكاملات الجادة بيكون عندها
 * معرّف من نظامها هي وعايزة الاتنين يتطابقوا — بس بننضّفه: أي حرف
 * غريب أو طول زيادة بيتشال، عشان مايتسربش في سجل ولا هيدر.
 *
 * @param {Request} request
 * @returns {string}
 */
export function requestId(request) {
    const supplied = request?.headers?.get?.('x-request-id');
    if (supplied) {
        const clean = String(supplied).replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64);
        if (clean.length >= 8) return clean;
    }
    return `req_${randomId()}`;
}

function randomId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * IP العميل بأفضل تقدير. بيستخدم لتحديد دلو المعدل للنداءات اللي مالهاش
 * هوية بس — مابيغلبش هوية حقيقية أبدًا.
 *
 * @param {Request} request
 * @returns {string|null}
 */
export function clientIp(request) {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim();
    return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? null;
}

/**
 * المفتاح من هيدر Authorization.
 *
 * @param {Request} request
 * @returns {string|null}
 */
export function bearerToken(request) {
    const header = request.headers.get('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    return match ? match[1] : null;
}

/**
 * بيقرا جسم JSON بحد أقصى.
 *
 * الحد بيتفحص على البايتات الفعلية مش على Content-Length: هيدر بيكدب
 * أرخص من جسم بيكدب، والاتنين بيتفحصوا هنا.
 *
 * @param {Request} request
 * @returns {Promise<Object>}
 */
export async function readJsonBody(request) {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType && !/^application\/json\b/i.test(contentType.trim())) {
        throw new ApiError('unsupported_media_type');
    }

    const declared = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        throw new ApiError('payload_too_large', { details: { max_bytes: MAX_BODY_BYTES } });
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
        throw new ApiError('payload_too_large', { details: { max_bytes: MAX_BODY_BYTES } });
    }
    if (!raw.trim()) return {};

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new ApiError('invalid_request', { details: { expected: 'a JSON object' } });
        }
        return parsed;
    } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError('invalid_json');
    }
}

/**
 * نص مطلوب.
 *
 * @param {Object} body
 * @param {string} field
 * @param {{max?: number, min?: number}} [limits]
 * @returns {string}
 */
export function requireString(body, field, { max = MAX_MESSAGE_CHARS, min = 1 } = {}) {
    const value = body?.[field];
    if (typeof value !== 'string' || value.trim().length < min) {
        throw new ApiError('invalid_request', {
            details: { field, expected: `a non-empty string of at most ${max} characters` }
        });
    }
    if (value.length > max) {
        throw new ApiError('unprocessable_entity', {
            details: { field, max_length: max, received_length: value.length }
        });
    }
    return value.trim();
}

/**
 * نص اختياري.
 *
 * @param {Object} body
 * @param {string} field
 * @param {{max?: number}} [limits]
 * @returns {string|null}
 */
export function optionalString(body, field, { max = 200 } = {}) {
    const value = body?.[field];
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') {
        throw new ApiError('invalid_request', { details: { field, expected: 'a string' } });
    }
    if (value.length > max) {
        throw new ApiError('unprocessable_entity', { details: { field, max_length: max } });
    }
    return value.trim();
}

/**
 * ── CORS ───────────────────────────────────────────────────
 * الـAPI ده للسيرفرات في المقام الأول، والمفتاح مالوش مكان في متصفح:
 * أي مفتاح بيتحط في صفحة بيبقى مكشوف لأي حد بيفتح devtools.
 *
 * عشان كده مفيش `*` هنا. الأصول المسموحة بتتحدد صراحة، والاعتمادات
 * (كوكيز) ممنوعة خالص — المصادقة بهيدر، فمفيش سبب نفتح باب CSRF.
 *
 * المسارات العامة (التوثيق وopenapi) استثناء مقصود: مالهاش مصادقة
 * ومحتواها منشور أصلاً، فقراءتها من أي أصل مش تسريب.
 *
 * @param {string|null} origin
 * @param {{allowedOrigins?: string[], publicRead?: boolean}} [options]
 * @returns {Record<string, string>}
 */
export function corsHeaders(origin, { allowedOrigins = [], publicRead = false } = {}) {
    const base = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type, x-request-id',
        'Access-Control-Expose-Headers': [
            'X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'
        ].join(', '),
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin'
    };

    if (publicRead) return { ...base, 'Access-Control-Allow-Origin': '*' };
    if (!origin) return base;

    const allowed = allowedOrigins.includes(origin) || allowedOrigins.includes('*');
    // أصل مش في القايمة بياخد رد عادي من غير هيدرز CORS — المتصفح هو
    // اللي بيمنع، والسيرفر مابيتظاهرش إنه رافض.
    return allowed ? { ...base, 'Access-Control-Allow-Origin': origin } : base;
}

/** هيدرز حد المعدل. مابتتبعتش لما الحد يكون مقفول. */
export function rateLimitHeaders(decision) {
    if (!decision?.enabled) return {};
    const headers = {
        'RateLimit-Limit': String(decision.limit),
        'RateLimit-Remaining': String(Math.max(decision.remaining, 0)),
        'RateLimit-Reset': String(decision.resetSeconds)
    };
    if (!decision.allowed) headers['Retry-After'] = String(Math.max(decision.retryAfter, 1));
    return headers;
}

/**
 * رد JSON. كل رد بيعدي من هنا، فمفيش رد من غير معرّف طلب ولا نوع محتوى.
 *
 * @param {unknown} body
 * @param {number} status
 * @param {{requestId: string, headers?: Record<string, string>}} context
 * @returns {Response}
 */
export function jsonResponse(body, status, { requestId: id, headers = {} }) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Request-Id': id,
            'Cache-Control': 'no-store',
            ...headers
        }
    });
}
