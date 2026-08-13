/**
 * errors.js — قاموس أخطاء SIE API
 * ============================================================
 * كل خطأ في الـAPI بيخرج من هنا. مفيش هاندلر بيألف شكل رد خطأ بنفسه،
 * ومفيش خطأ بيخرج من غير كود ثابت.
 *
 * ── الشكل ────────────────────────────────────────────────────
 *   {
 *     "error": {
 *       "code": "invalid_api_key",
 *       "message": "…",
 *       "request_id": "req_…",
 *       "details": { … }        // اختياري
 *     }
 *   }
 *
 * ── ليه الكود قبل الرسالة ───────────────────────────────────
 * The message is for a human reading a log; the code is what a client
 * branches on. Keeping them separate means we can improve wording — or
 * translate it — without breaking anyone's error handling, which is the
 * usual way a "small copy change" becomes a breaking change.
 *
 * ── ٢٠٠ مابتحملش خطأ أبدًا ──────────────────────────────────
 * كل خطأ بيرجع بحالة HTTP بتوصفه. عميل بيتعامل مع 200 على إنه نجاح ده
 * سلوك سليم، وأي API بيرجّع خطأ جوه 200 بيكسره.
 *
 * ── الرسائل مابتقولش أكتر من اللازم ─────────────────────────
 * مفتاح غلط ومفتاح مش موجود بياخدوا نفس الرد بالظبط
 * (`invalid_api_key`). التفرقة بينهم بتحوّل الـAPI لأداة تخمين مفاتيح.
 * الفرق الوحيد المسموح بيه هو المفتاح اللي **إحنا** ألغيناه أو خلصت
 * مدته: العميل ده مالكه الشرعي ومحتاج يعرف يعمل إيه.
 */

/**
 * @typedef {Object} ApiErrorSpec
 * @property {number} status - HTTP status
 * @property {string} message - رسالة إنجليزي للمطوّر
 * @property {string} messageAr - نفس المعنى بالعربي، لواجهات مدعوم
 */

/** @type {Record<string, ApiErrorSpec>} */
export const ERRORS = Object.freeze({
    // ── 400 ─────────────────────────────────────────────────
    invalid_json: {
        status: 400,
        message: 'The request body is not valid JSON.',
        messageAr: 'جسم الطلب مش JSON صالح.'
    },
    invalid_request: {
        status: 400,
        message: 'The request is missing a required field or a field has the wrong type.',
        messageAr: 'الطلب ناقص حقل مطلوب أو نوع حقل غلط.'
    },
    unsupported_media_type: {
        status: 415,
        message: 'Content-Type must be application/json.',
        messageAr: 'لازم Content-Type يكون application/json.'
    },
    payload_too_large: {
        status: 413,
        message: 'The request body is larger than the limit.',
        messageAr: 'جسم الطلب أكبر من الحد المسموح.'
    },
    unprocessable_entity: {
        status: 422,
        message: 'The request is well formed but a value is out of range.',
        messageAr: 'الطلب مظبوط شكلًا بس فيه قيمة برّه المدى.'
    },

    // ── 401 / 403 ───────────────────────────────────────────
    missing_api_key: {
        status: 401,
        message: 'Provide an API key as: Authorization: Bearer sie_live_…',
        messageAr: 'ابعت مفتاح الـAPI في الهيدر: Authorization: Bearer sie_live_…'
    },
    invalid_api_key: {
        status: 401,
        message: 'The API key is invalid.',
        messageAr: 'مفتاح الـAPI مش صالح.'
    },
    api_key_revoked: {
        status: 401,
        message: 'This API key was revoked. Create a new one from the SIE dashboard.',
        messageAr: 'المفتاح ده اتلغى. اعمل واحد جديد من لوحة SIE.'
    },
    api_key_expired: {
        status: 401,
        message: 'This API key has expired. Create a new one from the SIE dashboard.',
        messageAr: 'المفتاح ده خلصت مدته. اعمل واحد جديد من لوحة SIE.'
    },
    forbidden: {
        status: 403,
        message: 'This key may not act on the requested resource.',
        messageAr: 'المفتاح ده مالوش حق على المورد المطلوب.'
    },
    access_disabled: {
        status: 403,
        message: 'SIE is not enabled for this account.',
        messageAr: 'المحرك الذكي مش مفعّل على الحساب ده.'
    },
    access_expired: {
        status: 403,
        message: 'This account\'s SIE access has expired.',
        messageAr: 'صلاحية الحساب على المحرك خلصت.'
    },
    quota_exhausted: {
        status: 403,
        message: 'This account has used its entire message quota.',
        messageAr: 'الحساب استهلك كل رصيد الرسائل بتاعه.'
    },

    // ── 404 / 405 / 409 ─────────────────────────────────────
    not_found: {
        status: 404,
        message: 'No such endpoint.',
        messageAr: 'المسار ده مش موجود.'
    },
    unsupported_version: {
        status: 404,
        message: 'Unsupported API version.',
        messageAr: 'إصدار الـAPI ده مش مدعوم.'
    },
    resource_not_found: {
        status: 404,
        message: 'The requested resource does not exist.',
        messageAr: 'المورد المطلوب مش موجود.'
    },
    method_not_allowed: {
        status: 405,
        message: 'This endpoint does not accept that HTTP method.',
        messageAr: 'المسار ده مابيقبلش الطريقة دي.'
    },
    session_conflict: {
        status: 409,
        message: 'That session belongs to a different account.',
        messageAr: 'الجلسة دي بتاعة حساب تاني.'
    },

    // ── 429 ─────────────────────────────────────────────────
    rate_limited: {
        status: 429,
        message: 'Too many requests. Slow down and retry after the interval in Retry-After.',
        messageAr: 'طلبات كتير أوي. استنى المدة اللي في Retry-After وجرّب تاني.'
    },

    // ── 5xx ─────────────────────────────────────────────────
    internal_error: {
        status: 500,
        message: 'Something went wrong on our side. Quote the request_id to support.',
        messageAr: 'حصلت مشكلة عندنا. ابعت request_id للدعم.'
    },
    engine_unavailable: {
        status: 503,
        message: 'SIE produced no reply for this turn. Retry shortly.',
        messageAr: 'المحرك مالوش رد على الدور ده دلوقتي. جرّب كمان شوية.'
    }
});

/**
 * خطأ بيعرف حالته وكوده. بيترمى من أي مكان جوه الـAPI والراوتر بيحوّله رد.
 */
export class ApiError extends Error {
    /**
     * @param {keyof typeof ERRORS} code
     * @param {{details?: Object, message?: string, status?: number}} [options]
     */
    constructor(code, { details = null, message = null, status = null } = {}) {
        const spec = ERRORS[code] ?? ERRORS.internal_error;
        super(message ?? spec.message);
        this.name = 'ApiError';
        this.code = ERRORS[code] ? code : 'internal_error';
        this.status = status ?? spec.status;
        this.messageAr = spec.messageAr;
        this.details = details;
    }
}

/**
 * جسم الخطأ زي ما العميل هيشوفه.
 *
 * @param {ApiError} error
 * @param {string} requestId
 * @returns {Object}
 */
export function errorBody(error, requestId) {
    const body = {
        error: {
            code: error.code,
            message: error.message,
            message_ar: error.messageAr,
            request_id: requestId
        }
    };
    if (error.details) body.error.details = error.details;
    return body;
}

/** يحوّل سبب رفض المفتاح لكود خطأ. */
export function keyRejectionCode(reason) {
    if (reason === 'revoked') return 'api_key_revoked';
    if (reason === 'expired') return 'api_key_expired';
    // malformed / invalid / verify_failed كلهم بياخدوا نفس الرد: مفيش
    // فايدة للعميل الشرعي من التفرقة، وفيه فايدة كبيرة للي بيجرّب.
    return 'invalid_api_key';
}

/** يحوّل سبب رفض الاستحقاق (من evaluateSieAccessRow) لكود خطأ. */
export function entitlementCode(reason) {
    if (reason === 'quota_exceeded') return 'quota_exhausted';
    if (reason === 'expired') return 'access_expired';
    return 'access_disabled';
}
