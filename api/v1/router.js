/**
 * router.js — SIE Public API, v1
 * ============================================================
 * الحد العام لمحرك الدعم الذكي. كل طلب بيعدي من هنا بالترتيب ده:
 *
 *   CORS/OPTIONS → المسار والإصدار → المفتاح → حد المعدل →
 *   الاستحقاق (جوه المنفذ) → الرَنتايم → الرد → السجل
 *
 * ── ليه الترتيب ده بالذات ───────────────────────────────────
 * المفتاح قبل حد المعدل: من غير هوية مؤكدة، الحد بيتحسب على IP —
 * وIP مشترك يعني عميل بيدفع تمن عميل تاني.
 *
 * حد المعدل قبل المحرك: المحرك أغلى حاجة في المسار، والحد موجود
 * أصلاً عشان يمنع الوصول له.
 *
 * السجل في الآخر ودايمًا: نجح أو فشل، لازم يبقى فيه سطر بمعرّف الطلب،
 * وإلا مفيش حد يقدر يجاوب على «إيه اللي حصل في الطلب ده».
 *
 * ── الإصدار في المسار ───────────────────────────────────────
 * `/api/v1/...`. الإصدار في المسار مش في هيدر عشان الرابط لوحده يبقى
 * كامل: يتلصق في curl، يتشير في تذكرة، يتفتح في متصفح. `/api/v2`
 * هيبقى فرع جديد هنا جنب ده، والقديم مايتلمسش.
 *
 * ── اللي مش هنا عن قصد ──────────────────────────────────────
 * إدارة المفاتيح **مش** في الـAPI. مفتاح يقدر يعمل مفاتيح هو مفتاح
 * يقدر يرقّي نفسه، وسرقة واحد ساعتها بتبقى دائمة. المفاتيح بتتعمل من
 * لوحة SIE بجلسة أدمن حقيقية، وبس.
 */
import { ApiError, errorBody, keyRejectionCode } from './errors.js';
import {
    requestId as makeRequestId, clientIp, bearerToken, corsHeaders,
    rateLimitHeaders, jsonResponse
} from './http.js';
import { handleHealth, handleMe, handleChat, handleDiagnose, handleScenarios } from './handlers.js';

export const API_VERSION = 'v1';
export const SUPPORTED_VERSIONS = Object.freeze(['v1']);

/**
 * جدول المسارات. مصدر واحد للمسارات المعروفة، بيستخدمه الراوتر
 * للتوجيه وOpenAPI للتوثيق — فمستحيل يتوثّق مسار مش موجود، أو يتنسى
 * مسار موجود.
 *
 * @type {Array<{method: string, path: string, auth: boolean, handler: Function, operationId: string}>}
 */
export const ROUTES = Object.freeze([
    { method: 'GET', path: '/health', auth: false, operationId: 'getHealth', handler: handleHealth },
    { method: 'GET', path: '/me', auth: true, operationId: 'getMe', handler: handleMe },
    { method: 'POST', path: '/chat', auth: true, operationId: 'createChatTurn', handler: handleChat },
    { method: 'POST', path: '/diagnose', auth: true, operationId: 'diagnoseMessage', handler: handleDiagnose },
    { method: 'GET', path: '/scenarios', auth: true, operationId: 'listScenarios', handler: handleScenarios }
]);

/**
 * @typedef {Object} ApiPorts
 * @property {(apiKey: string) => Promise<Object>} verifyApiKey
 * @property {(params: {userId: string|null, clientIp: string|null}) => Promise<Object>} checkRateLimit
 * @property {(entry: Object) => Promise<void>} logRequest
 * @property {(userId: string) => Promise<Object>} getAccount
 * @property {(params: Object) => Promise<Object>} chat
 * @property {(message: string, options: Object) => Promise<Object>} diagnose
 * @property {() => Promise<Array>} listScenarios
 * @property {() => Promise<{loaded: boolean, catalog_size?: number}>} engineHealth
 */

/**
 * @param {{ports: ApiPorts, config?: {allowedOrigins?: string[]}}} params
 * @returns {{handle: (request: Request) => Promise<Response>, matches: (pathname: string) => boolean}}
 */
export function createApiRouter({ ports, config = {} }) {
    const allowedOrigins = config.allowedOrigins ?? [];

    return {
        /** هل المسار ده بتاع الـAPI العام أصلاً؟ */
        matches(pathname) {
            return normalizePath(pathname).startsWith('/api/');
        },

        async handle(request) {
            const startedAt = Date.now();
            const id = makeRequestId(request);
            const url = new URL(request.url);
            const path = normalizePath(url.pathname);
            const origin = request.headers.get('origin');

            // نداء استكشافي للمتصفح. بيترد عليه قبل أي حاجة — قبل
            // المفتاح وقبل الحد — لأنه مابيوصلش لأي مورد.
            if (request.method === 'OPTIONS') {
                return new Response(null, {
                    status: 204,
                    headers: { ...corsHeaders(origin, { allowedOrigins }), 'X-Request-Id': id }
                });
            }

            const cors = corsHeaders(origin, { allowedOrigins });
            /** @type {Object|null} */
            let auth = null;
            let rateHeaders = {};

            try {
                const { version, route } = resolve(path, request.method);

                if (route.auth) {
                    auth = await authenticate(request, ports);
                }

                // حد المعدل: بعد الهوية، وقبل أي شغل. الفحص بيتم حتى
                // للمسارات اللي من غير مفتاح لكن بدلو الـIP، عشان
                // /health مايبقاش باب مفتوح على السيرفر.
                const decision = await ports.checkRateLimit({
                    userId: auth?.userId ?? null,
                    clientIp: clientIp(request)
                });
                rateHeaders = rateLimitHeaders(decision);

                if (!decision.allowed) {
                    throw new ApiError('rate_limited', {
                        details: {
                            limit: decision.limit,
                            retry_after_seconds: Math.max(decision.retryAfter, 1)
                        }
                    });
                }

                const payload = await route.handler({
                    request, url, ports, auth, requestId: id, version, rateLimit: decision
                });

                const response = jsonResponse(payload, 200, {
                    requestId: id,
                    headers: { ...cors, ...rateHeaders }
                });

                await log(ports, { id, request, path, status: 200, auth, startedAt });
                return response;
            } catch (err) {
                const error = err instanceof ApiError ? err : wrapUnknown(err, id);
                const response = jsonResponse(errorBody(error, id), error.status, {
                    requestId: id,
                    headers: { ...cors, ...rateHeaders }
                });

                await log(ports, {
                    id, request, path, status: error.status, auth, startedAt, errorCode: error.code
                });
                return response;
            }
        }
    };
}

/**
 * بيرجّع المسار لشكله المعياري `/api/v1/...`.
 *
 * الدالة بتتقدّم على Supabase تحت `/functions/v1/sie-api/...`، وبتوصلها
 * طلبات من `sie.mad3oom.com/api/v1/...` بعد إعادة كتابة. الاتنين
 * بيتقبلوا، فالعميل مايهموش إزاي وصل.
 */
function normalizePath(pathname) {
    let path = pathname;
    for (const prefix of ['/functions/v1/sie-api', '/sie-api']) {
        if (path.startsWith(prefix)) {
            path = path.slice(prefix.length) || '/';
            break;
        }
    }
    return path.replace(/\/+$/, '') || '/';
}

/** بيلاقي المسار والإصدار، أو بيرمي الخطأ الصح. */
function resolve(path, method) {
    const match = /^\/api\/(v\d+)(\/.*)?$/.exec(path);
    if (!match) throw new ApiError('not_found', { details: { path } });

    const [, version, rest = ''] = match;
    if (!SUPPORTED_VERSIONS.includes(version)) {
        throw new ApiError('unsupported_version', {
            details: { requested: version, supported: [...SUPPORTED_VERSIONS] }
        });
    }

    const routePath = rest || '/';
    const byPath = ROUTES.filter((route) => route.path === routePath);
    if (byPath.length === 0) {
        throw new ApiError('not_found', { details: { path } });
    }

    const route = byPath.find((candidate) => candidate.method === method);
    if (!route) {
        throw new ApiError('method_not_allowed', {
            details: { allowed: byPath.map((candidate) => candidate.method) }
        });
    }

    return { version, route };
}

/**
 * بيحوّل المفتاح لهوية، أو بيرمي ٤٠١.
 *
 * المفتاح نفسه مابيخرجش من الدالة دي أبدًا — اللي بيرجع هو الهوية
 * والبادئة، والبادئة هي اللي بتتكتب في السجل.
 */
async function authenticate(request, ports) {
    const key = bearerToken(request);
    if (!key) throw new ApiError('missing_api_key');

    const verdict = await ports.verifyApiKey(key);
    if (!verdict.valid) {
        throw new ApiError(keyRejectionCode(verdict.reason));
    }

    return {
        userId: verdict.userId,
        keyId: verdict.keyId,
        environment: verdict.environment,
        prefix: verdict.prefix
    };
}

/**
 * أي استثناء مش متوقع بيبقى ٥٠٠ برسالة عامة.
 *
 * السبب الحقيقي بيروح للسجل بس. رسالة خطأ داخلية في رد HTTP هي أسهل
 * طريقة تسريب أسماء جداول ودوال ومسارات ملفات لأي حد بيجرب.
 */
function wrapUnknown(err, id) {
    console.error(`[sie-api] ${id} unhandled:`, err instanceof Error ? err.stack || err.message : err);
    return new ApiError('internal_error');
}

async function log(ports, { id, request, path, status, auth, startedAt, errorCode = null }) {
    try {
        await ports.logRequest({
            requestId: id,
            keyId: auth?.keyId ?? null,
            userId: auth?.userId ?? null,
            method: request.method,
            path,
            status,
            errorCode,
            durationMs: Date.now() - startedAt
        });
    } catch (err) {
        // السجل مابيوقعش الطلب. طلب نجح وماتسجلش أفضل من طلب فشل عشان
        // السجل وقع.
        console.warn('[sie-api] request log failed:', err?.message || err);
    }
}
