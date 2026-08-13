/**
 * @mad3oom/sie — العميل الرسمي لـSIE API
 * ============================================================
 * غلاف رفيع فوق `https://sie.mad3oom.com/api/v1`. مافيش أي منطق محرك
 * هنا: كل الذكاء في SIE نفسه، والحزمة دي مسؤولة عن أربع حاجات بس —
 * تبعت المفتاح صح، تحوّل الأخطاء لأشكال يقدر الكود يتعامل معاها، تحترم
 * المهلة، وتديك معرّف الطلب.
 *
 * ── ليه JavaScript + .d.ts مش TypeScript متبنى ──────────────
 * الريبو ده كله ESM بلا خطوة بناء — الدوال الطرفية بتقرا المصدر زي ما
 * هو، والاختبارات بتشغّله مباشرة. حزمة محتاجة `tsc` كانت هتضيف خطوة
 * بناء لريبو مالوش واحدة، وتخلي «اللي اتنشر» مختلف عن «اللي اتقرا».
 * الأنواع كاملة في `index.d.ts` جنب الملف ده، فمستخدم TypeScript بياخد
 * كل حاجة (إكمال، فحص أنواع، أنواع الأخطاء) من غير بناء.
 *
 * ── ليه مفيش اعتمادات ───────────────────────────────────────
 * `fetch` و`AbortController` موجودين أصلاً في Node 18+ وDeno والمتصفح.
 * أي اعتماد هنا كان هيبقى اعتماد على كل عميل بيركّب الحزمة.
 */

/** العنوان الافتراضي — الـAPI العام الرسمي. */
export const DEFAULT_BASE_URL = 'https://sie.mad3oom.com/api/v1';

/** مهلة افتراضية. دور المحادثة بيعدي على المحرك كله، فمش لحظي. */
export const DEFAULT_TIMEOUT_MS = 30_000;

export const SDK_VERSION = '1.0.0';

/**
 * خطأ جاي من الـAPI نفسه (٤xx/٥xx برد JSON).
 *
 * بيحمل `code` الثابت — ده اللي بتفرّع عليه — و`status` و`requestId`
 * اللي بتبعته للدعم. الرسالة للقراءة، مش للتفريع.
 */
export class SIEError extends Error {
    /**
     * @param {{code: string, message: string, messageAr?: string|null,
     *          status: number, requestId: string|null, details?: Object|null}} params
     */
    constructor({ code, message, messageAr = null, status, requestId = null, details = null }) {
        super(message);
        this.name = 'SIEError';
        this.code = code;
        this.messageAr = messageAr;
        this.status = status;
        this.requestId = requestId;
        this.details = details;
    }

    /** هل يستاهل إعادة محاولة؟ ٤٢٩ و٥xx أيوه، الباقي لأ. */
    get retryable() {
        return this.status === 429 || this.status >= 500;
    }
}

/**
 * الشبكة نفسها فشلت: مفيش رد، أو المهلة خلصت.
 *
 * منفصل عن SIEError عن قصد: «الـAPI رفض طلبك» و«مفيش رد أصلاً» بيتعاملوا
 * بشكل مختلف تمامًا — التانية بتتعاد، والأولى غالبًا بتتصلح.
 */
export class SIEConnectionError extends Error {
    /**
     * @param {string} message
     * @param {{cause?: unknown, timeout?: boolean, requestId?: string|null}} [options]
     */
    constructor(message, { cause = null, timeout = false, requestId = null } = {}) {
        super(message);
        this.name = 'SIEConnectionError';
        this.cause = cause;
        this.timeout = timeout;
        this.requestId = requestId;
    }
}

/**
 * عميل SIE.
 *
 * @example
 * const sie = new SIE({ apiKey: process.env.SIE_API_KEY });
 * const result = await sie.chat({ message: 'مش عارف أدخل' });
 * console.log(result.reply.text);
 */
export class SIE {
    /**
     * @param {{apiKey: string, baseUrl?: string, timeout?: number,
     *          fetch?: typeof fetch, userAgent?: string}} options
     */
    constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, timeout = DEFAULT_TIMEOUT_MS, fetch: fetchImpl, userAgent } = {}) {
        if (!apiKey || typeof apiKey !== 'string') {
            throw new TypeError('SIE: apiKey is required. Create one in the SIE dashboard → API & Developers.');
        }
        // فحص شكلي بس، ومحلي: بيمسك الغلطة الشائعة (لصق قيمة غلط، أو
        // متغير بيئة فاضي) من غير ما يبعت المفتاح لأي مكان.
        if (!/^sie_(live|test)_/.test(apiKey)) {
            throw new TypeError('SIE: apiKey does not look like a SIE key (expected sie_live_… or sie_test_…).');
        }

        /** @private */
        this._apiKey = apiKey;
        this.baseUrl = String(baseUrl).replace(/\/+$/, '');
        this.timeout = timeout;
        /** @private */
        this._fetch = fetchImpl ?? globalThis.fetch;
        /** @private */
        this._userAgent = userAgent ?? `mad3oom-sie-sdk/${SDK_VERSION}`;

        if (typeof this._fetch !== 'function') {
            throw new TypeError('SIE: no fetch implementation available. Pass one via { fetch }.');
        }
    }

    /**
     * دور محادثة كامل. بيستهلك رسالة من رصيد الحساب.
     *
     * @param {{message: string, sessionId?: string, endUserId?: string,
     *          metadata?: Record<string, string|number|boolean|null>,
     *          requestId?: string, timeout?: number, signal?: AbortSignal}} params
     * @returns {Promise<Object>}
     */
    chat({ message, sessionId, endUserId, metadata, ...options } = {}) {
        return this.request('POST', '/chat', {
            ...options,
            body: {
                message,
                // الحقول بتتشال لو مش موجودة بدل ما تتبعت null: الـAPI
                // بيفرّق بين «مش مبعوت» و«مبعوت فاضي».
                ...(sessionId ? { session_id: sessionId } : {}),
                ...(endUserId ? { end_user_id: endUserId } : {}),
                ...(metadata ? { metadata } : {})
            }
        });
    }

    /**
     * تشخيص من غير رد: مافيش رصيد بيتصرف ولا تذكرة بتتفتح.
     *
     * @param {{message: string, limit?: number, requestId?: string,
     *          timeout?: number, signal?: AbortSignal}} params
     * @returns {Promise<Object>}
     */
    diagnose({ message, limit, ...options } = {}) {
        return this.request('POST', '/diagnose', {
            ...options,
            body: { message, ...(limit === undefined ? {} : { limit }) }
        });
    }

    /**
     * الحساب اللي المفتاح ده بيتكلم باسمه: الاستحقاق والرصيد والحد.
     *
     * @param {{requestId?: string, timeout?: number, signal?: AbortSignal}} [options]
     * @returns {Promise<Object>}
     */
    me(options = {}) {
        return this.request('GET', '/me', options);
    }

    /**
     * السيناريوهات المنشورة.
     *
     * @param {{category?: string, limit?: number, offset?: number,
     *          requestId?: string, timeout?: number, signal?: AbortSignal}} [params]
     * @returns {Promise<Object>}
     */
    scenarios({ category, limit, offset, ...options } = {}) {
        const query = new URLSearchParams();
        if (category) query.set('category', category);
        if (limit !== undefined) query.set('limit', String(limit));
        if (offset !== undefined) query.set('offset', String(offset));

        const suffix = query.toString() ? `?${query}` : '';
        return this.request('GET', `/scenarios${suffix}`, options);
    }

    /**
     * حالة الخدمة. المسار الوحيد اللي مابيحتاجش مفتاح — بس بنبعته
     * برضه، فمفيش سبب نعمل استثناء في العميل.
     *
     * @param {{timeout?: number, signal?: AbortSignal}} [options]
     * @returns {Promise<Object>}
     */
    health(options = {}) {
        return this.request('GET', '/health', options);
    }

    /**
     * النداء الخام. مكشوف عن قصد: مسار جديد في الـAPI يبقى قابل
     * للاستخدام من غير ترقية الحزمة.
     *
     * @param {string} method
     * @param {string} path - نسبةً للعنوان الأساسي، يبدأ بـ/
     * @param {{body?: Object, requestId?: string, timeout?: number, signal?: AbortSignal}} [options]
     * @returns {Promise<Object>}
     */
    async request(method, path, { body, requestId, timeout, signal } = {}) {
        const url = `${this.baseUrl}${path}`;
        const controller = new AbortController();
        const limit = timeout ?? this.timeout;

        // مهلة العميل نفسه. من غيرها، طلب معلّق بيعلّق التكامل كله.
        const timer = setTimeout(() => controller.abort(new Error('timeout')), limit);
        // إشارة المستخدم بتتربط بإشارتنا عشان الاتنين يقدروا يلغوا.
        const onAbort = () => controller.abort(signal?.reason);
        signal?.addEventListener?.('abort', onAbort, { once: true });

        const headers = {
            Authorization: `Bearer ${this._apiKey}`,
            Accept: 'application/json',
            'User-Agent': this._userAgent
        };
        if (requestId) headers['X-Request-Id'] = requestId;
        if (body !== undefined) headers['Content-Type'] = 'application/json';

        let response;
        try {
            response = await this._fetch(url, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: controller.signal
            });
        } catch (err) {
            const timedOut = controller.signal.aborted && !signal?.aborted;
            throw new SIEConnectionError(
                timedOut
                    ? `SIE request timed out after ${limit}ms`
                    : `SIE request failed: ${err?.message ?? err}`,
                { cause: err, timeout: timedOut, requestId: requestId ?? null }
            );
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener?.('abort', onAbort);
        }

        return this._parse(response, requestId);
    }

    /** @private */
    async _parse(response, requestId) {
        const id = response.headers?.get?.('X-Request-Id') ?? requestId ?? null;
        const rateLimit = readRateLimit(response.headers);
        const text = await response.text();

        let payload = null;
        if (text) {
            try {
                payload = JSON.parse(text);
            } catch {
                // رد مش JSON من حاجة في النص (بروكسي، صفحة خطأ من
                // بوابة). ده عطل شبكة من ناحية العميل، مش خطأ API.
                throw new SIEConnectionError(
                    `SIE returned a non-JSON response (HTTP ${response.status})`,
                    { requestId: id }
                );
            }
        }

        if (!response.ok) {
            const error = payload?.error ?? {};
            throw new SIEError({
                code: error.code ?? 'unknown_error',
                message: error.message ?? `SIE request failed with HTTP ${response.status}`,
                messageAr: error.message_ar ?? null,
                status: response.status,
                requestId: error.request_id ?? id,
                details: error.details ?? null
            });
        }

        // معرّف الطلب وحالة الحد بيتحطوا كخصائص غير قابلة للعد: العميل
        // يقدر يقراهم، وJSON.stringify للرد بيفضل نظيف زي ما الـAPI
        // بعته بالظبط.
        if (payload && typeof payload === 'object') {
            Object.defineProperty(payload, 'requestId', { value: id, enumerable: false });
            Object.defineProperty(payload, 'rateLimit', { value: rateLimit, enumerable: false });
        }
        return payload;
    }
}

/** @private */
function readRateLimit(headers) {
    if (!headers?.get) return null;
    const limit = headers.get('RateLimit-Limit');
    if (limit === null) return null;

    return {
        limit: Number(limit),
        remaining: Number(headers.get('RateLimit-Remaining') ?? 0),
        resetSeconds: Number(headers.get('RateLimit-Reset') ?? 0),
        retryAfter: headers.get('Retry-After') === null ? null : Number(headers.get('Retry-After'))
    };
}

export default SIE;
