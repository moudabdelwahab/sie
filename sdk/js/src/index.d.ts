/**
 * @mad3oom/sie — الأنواع
 * ============================================================
 * الأنواع دي مكتوبة بالإيد جنب المصدر بدل ما تتولّد من بناء TypeScript،
 * عشان اللي بيتنشر هو اللي بيتقرا بالظبط. أي حقل هنا موجود فعلاً في رد
 * الـAPI — الأشكال مأخوذة من مخططات OpenAPI في `api/openapi.js`.
 */

export declare const DEFAULT_BASE_URL: string;
export declare const DEFAULT_TIMEOUT_MS: number;
export declare const SDK_VERSION: string;

/** كل أكواد الأخطاء اللي الـAPI بيرجّعها. */
export type SIEErrorCode =
    | 'invalid_json'
    | 'invalid_request'
    | 'unsupported_media_type'
    | 'payload_too_large'
    | 'unprocessable_entity'
    | 'missing_api_key'
    | 'invalid_api_key'
    | 'api_key_revoked'
    | 'api_key_expired'
    | 'forbidden'
    | 'access_disabled'
    | 'access_expired'
    | 'quota_exhausted'
    | 'not_found'
    | 'unsupported_version'
    | 'resource_not_found'
    | 'method_not_allowed'
    | 'session_conflict'
    | 'rate_limited'
    | 'internal_error'
    | 'engine_unavailable'
    | 'unknown_error';

export interface RateLimitSnapshot {
    limit: number;
    remaining: number;
    resetSeconds: number;
    retryAfter: number | null;
}

/** بيتحط على كل رد ناجح كخصائص غير قابلة للعد. */
export interface SIEResponseMeta {
    readonly requestId: string | null;
    readonly rateLimit: RateLimitSnapshot | null;
}

export interface Usage {
    messages_used: number;
    /** `null` معناها الحساب من غير حد. */
    message_quota: number | null;
    remaining: number | null;
}

export interface ChatResult extends SIEResponseMeta {
    request_id: string;
    /** ابعته في الرسالة اللي بعدها عشان المحرك يفتكر. */
    session_id: string;
    reply: {
        text: string;
        options: Array<{ label: string; value: string }>;
    };
    ticket: { number: string } | null;
    usage: Usage | null;
}

export interface DiagnoseCandidate {
    scenario_id: string;
    label: string;
    label_en: string | null;
    category: string | null;
    confidence: number;
}

export interface DiagnoseResult extends SIEResponseMeta {
    request_id: string;
    message: string;
    /** هل أقرب سيناريو وصل لحد الحسم. */
    will_resolve: boolean;
    confidence_threshold: number;
    candidates: DiagnoseCandidate[];
    signals: Array<{ token: string; source: string | null }>;
}

export interface AccountResult extends SIEResponseMeta {
    account: {
        id: string;
        sie_enabled: boolean;
        status: string;
        access_mode: 'unlimited' | 'quota' | 'expiration' | null;
        expires_at: string | null;
    };
    api_key: {
        id: string;
        /** أول ١٦ حرف بس — القيمة الكاملة مابترجعش أبدًا. */
        prefix: string;
        environment: 'live' | 'test';
    };
    usage: Usage;
    rate_limit: {
        enabled: boolean;
        limit_per_minute: number | null;
        remaining: number | null;
        reset_seconds: number | null;
    };
}

export interface Scenario {
    id: string;
    label: string;
    label_en: string | null;
    category: string | null;
    resolves_automatically: boolean;
    opens_ticket_if_unresolved: boolean;
}

export interface ScenarioListResult extends SIEResponseMeta {
    total: number;
    limit: number;
    offset: number;
    data: Scenario[];
}

export interface HealthResult extends SIEResponseMeta {
    status: 'ok' | 'degraded';
    service: string;
    version: string;
    engine: {
        loaded: boolean;
        catalog_size?: number;
        /** نسخة الرَنتايم اللي الدالة المنشورة حمّلتها فعلاً. */
        runtime_version?: string;
    };
}

/** خيارات مشتركة بين كل النداءات. */
export interface RequestOptions {
    /** معرّفك أنت للطلب. بيرجع في الرد وفي سجلاتنا. */
    requestId?: string;
    /** مهلة بالملي ثانية لهذا النداء. */
    timeout?: number;
    signal?: AbortSignal;
}

export interface ChatParams extends RequestOptions {
    message: string;
    sessionId?: string;
    /** معرّف العميل النهائي عندك — بيفصل محادثات مستخدمينك. */
    endUserId?: string;
    metadata?: Record<string, string | number | boolean | null>;
}

export interface DiagnoseParams extends RequestOptions {
    message: string;
    /** ١..٢٠، الافتراضي ٥. */
    limit?: number;
}

export interface ScenarioParams extends RequestOptions {
    category?: string;
    limit?: number;
    offset?: number;
}

export interface SIEOptions {
    /** المفتاح من لوحة SIE. الشكل: sie_live_… أو sie_test_… */
    apiKey: string;
    /** الافتراضي: https://sie.mad3oom.com/api/v1 */
    baseUrl?: string;
    /** الافتراضي: 30000 */
    timeout?: number;
    /** للبيئات اللي مافيهاش fetch عالمي، أو للاختبارات. */
    fetch?: typeof fetch;
    userAgent?: string;
}

/** خطأ جاي من الـAPI: فيه كود ثابت ومعرّف طلب. */
export declare class SIEError extends Error {
    readonly name: 'SIEError';
    readonly code: SIEErrorCode;
    readonly messageAr: string | null;
    readonly status: number;
    readonly requestId: string | null;
    readonly details: Record<string, unknown> | null;
    /** ٤٢٩ أو ٥xx. */
    readonly retryable: boolean;
}

/** الشبكة فشلت أو المهلة خلصت — مفيش رد أصلاً. */
export declare class SIEConnectionError extends Error {
    readonly name: 'SIEConnectionError';
    readonly cause: unknown;
    readonly timeout: boolean;
    readonly requestId: string | null;
}

export declare class SIE {
    constructor(options: SIEOptions);
    readonly baseUrl: string;
    readonly timeout: number;

    chat(params: ChatParams): Promise<ChatResult>;
    diagnose(params: DiagnoseParams): Promise<DiagnoseResult>;
    me(options?: RequestOptions): Promise<AccountResult>;
    scenarios(params?: ScenarioParams): Promise<ScenarioListResult>;
    health(options?: RequestOptions): Promise<HealthResult>;

    /** نداء خام لأي مسار — للمسارات الجديدة قبل ترقية الحزمة. */
    request<T = unknown>(
        method: string,
        path: string,
        options?: RequestOptions & { body?: unknown }
    ): Promise<T>;
}

export default SIE;
