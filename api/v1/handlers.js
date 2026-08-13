/**
 * handlers.js — مسارات SIE API v1
 * ============================================================
 * كل هاندلر هنا بيعمل حاجة واحدة: يقرا الطلب، ينادي على منفذ
 * (port) واحد، ويشكّل الرد. مفيش منطق محرك هنا خالص — المحرك ورا
 * `ports`، واللي بيوصّلهم هو `api/v1/ports.js` في النشر الحقيقي.
 *
 * ── ليه منافذ مش استيراد مباشر ──────────────────────────────
 * الملف ده بيتشغّل في Deno جوه الدالة الطرفية، وفي Node جوه
 * الاختبارات. لو استورد المحرك مباشرة، الاختبار كان هيبقى محتاج
 * قاعدة بيانات وشبكة عشان يتأكد إن ٤٢٩ بترجع ٤٢٩. المنافذ بتخلي
 * الراوتر يتختبر كامل، والمحرك الحقيقي يتوصّل في مكان واحد.
 *
 * ── شكل الرد ────────────────────────────────────────────────
 * كل رد ناجح فيه `request_id`، وأسماء الحقول snake_case زي ما
 * بتتكتب في التوثيق وفي OpenAPI بالظبط.
 */
import { ApiError } from './errors.js';
import { readJsonBody, requireString, optionalString, MAX_MESSAGE_CHARS } from './http.js';

/**
 * GET /v1/health — مفتوح من غير مفتاح.
 *
 * مفتوح عن قصد: فحص التوفر اللي محتاج مفتاح مايقدرش يفرّق بين «الخدمة
 * واقعة» و«مفتاحي باظ»، وده الفرق الوحيد اللي هو موجود عشانه.
 * مابيرجعش أي حاجة عن أي عميل.
 */
export async function handleHealth({ ports, version }) {
    const engine = await ports.engineHealth();
    return {
        status: engine.loaded ? 'ok' : 'degraded',
        service: 'sie-api',
        version,
        engine
    };
}

/**
 * GET /v1/me — الحساب اللي المفتاح ده بيتكلم باسمه.
 *
 * بيجاوب على السؤال اللي بيسبق أي تكامل: أنا مين عند SIE، ومسموح لي
 * بكام، وفاضلي كام. الأرقام كلها من نفس الصفوف اللي اللوحة بتقراها،
 * فمفيش شاشتين بيقولوا رقمين.
 */
export async function handleMe({ ports, auth, rateLimit }) {
    const account = await ports.getAccount(auth.userId);

    return {
        account: {
            id: auth.userId,
            sie_enabled: account.entitlement.available,
            status: account.entitlement.statusLabel,
            access_mode: account.access?.access_mode ?? null,
            expires_at: account.access?.expires_at ?? null
        },
        api_key: {
            id: auth.keyId,
            prefix: auth.prefix,
            environment: auth.environment
        },
        usage: account.usage,
        // نفس أرقام هيدرز RateLimit-* بتاعة الطلب ده بالظبط — قراءة
        // تانية من مكان تاني كانت هتقدر تختلف عنها.
        rate_limit: {
            enabled: rateLimit.enabled,
            limit_per_minute: rateLimit.enabled ? rateLimit.limit : null,
            remaining: rateLimit.enabled ? rateLimit.remaining : null,
            reset_seconds: rateLimit.enabled ? rateLimit.resetSeconds : null
        }
    };
}

/**
 * POST /v1/chat — دور محادثة كامل.
 *
 * ده المسار اللي بيشغّل المحرك فعلاً: نفس الـpipeline اللي بيرد على
 * عميل على الموقع أو على تيليجرام، بنفس الاستحقاق ونفس الاستهلاك.
 *
 * `session_id` اختياري: أول نداء من غيره بيفتح جلسة ويرجّع معرّفها،
 * واللي بعده بيبعت المعرّف عشان المحرك يفتكر. من غير الجلسة كل رسالة
 * هتبان للمحرك كأنها أول رسالة، والتشخيص بيتبني عبر الأدوار.
 */
export async function handleChat({ request, ports, auth, requestId }) {
    const body = await readJsonBody(request);

    const message = requireString(body, 'message', { max: MAX_MESSAGE_CHARS });
    const sessionId = optionalString(body, 'session_id', { max: 64 });
    const endUserId = optionalString(body, 'end_user_id', { max: 120 });
    const metadata = readMetadata(body);

    const result = await ports.chat({
        userId: auth.userId,
        message,
        sessionId,
        endUserId,
        metadata
    });

    return {
        request_id: requestId,
        session_id: result.sessionId,
        reply: {
            text: result.reply,
            options: result.options ?? []
        },
        // مفيش حقل «سيناريو» هنا عن قصد: getSieReply مابيرجّعش المعرّف،
        // واستخراجه من حالة المحادثة معناه إن الـAPI بيقرا دواخل المحرك.
        // اللي عايز التصنيف يستخدم /v1/diagnose — هو موجود عشان كده.
        ticket: result.ticketNumber ? { number: result.ticketNumber } : null,
        usage: result.usage ?? null
    };
}

/**
 * POST /v1/diagnose — فهم من غير رد.
 *
 * بيوقف قبل القرار والتنفيذ: مفيش رسالة بتتبعت، ولا تذكرة بتتفتح، ولا
 * رصيد بيتصرف. مفيد لتصنيف تذاكر واردة، أو توجيهها، أو معرفة إذا كان
 * SIE هيقدر يرد قبل ما تحوّلهاله.
 */
export async function handleDiagnose({ request, ports, requestId }) {
    const body = await readJsonBody(request);
    const message = requireString(body, 'message', { max: MAX_MESSAGE_CHARS });

    const limit = body.limit === undefined ? 5 : Number(body.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
        throw new ApiError('unprocessable_entity', {
            details: { field: 'limit', expected: 'an integer between 1 and 20' }
        });
    }

    const result = await ports.diagnose(message, { limit });

    return {
        request_id: requestId,
        message: result.text,
        will_resolve: result.willResolve,
        confidence_threshold: result.threshold,
        candidates: result.candidates.map((candidate) => ({
            scenario_id: candidate.scenarioId,
            label: candidate.label?.ar ?? candidate.scenarioId,
            label_en: candidate.label?.en ?? null,
            category: candidate.category,
            confidence: candidate.confidence
        })),
        // الكلمات الدالة اللي المحرك شافها — من غيرها المطوّر بيخمّن
        // ليه الترتيب طلع كده.
        signals: result.tokens
    };
}

/**
 * GET /v1/scenarios — الكتالوج المنشور.
 *
 * الأسماء والأقسام بس، من غير نصوص الحلول: العميل محتاج يعرف SIE
 * بيفهم إيه عشان يربطه بأنظمته، مش محتاج نسخة من قاعدة المعرفة.
 */
export async function handleScenarios({ ports, url }) {
    const scenarios = await ports.listScenarios();

    const category = url.searchParams.get('category');
    const limit = clampInt(url.searchParams.get('limit'), 100, 1, 500);
    const offset = clampInt(url.searchParams.get('offset'), 0, 0, 100000);

    const filtered = category
        ? scenarios.filter((scenario) => scenario.category === category)
        : scenarios;

    return {
        total: filtered.length,
        limit,
        offset,
        data: filtered.slice(offset, offset + limit).map((scenario) => ({
            id: scenario.id,
            label: scenario.label?.ar ?? scenario.id,
            label_en: scenario.label?.en ?? null,
            category: scenario.category,
            resolves_automatically: Boolean(scenario.resolution?.hasAutoResolution),
            opens_ticket_if_unresolved: Boolean(scenario.requiresTicketIfUnresolved)
        }))
    };
}

// ── مساعدات ────────────────────────────────────────────────

function clampInt(raw, fallback, min, max) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(Math.max(Math.trunc(value), min), max);
}

/**
 * `metadata` بيعدي زي ما هو للتكامل، بس بحدود: كائن مسطّح، ٢٠ مفتاح،
 * والقيم نصوص/أرقام/منطقية. الحدود دي مش تشدد — الحقل ده بيتخزن
 * ويترجع، وكائن متداخل من غير حد هو طريقة مضمونة لتحويله لمكب.
 */
function readMetadata(body) {
    const value = body?.metadata;
    if (value === undefined || value === null) return null;

    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new ApiError('invalid_request', { details: { field: 'metadata', expected: 'an object' } });
    }

    const entries = Object.entries(value);
    if (entries.length > 20) {
        throw new ApiError('unprocessable_entity', { details: { field: 'metadata', max_keys: 20 } });
    }
    for (const [key, item] of entries) {
        const type = typeof item;
        if (item !== null && type !== 'string' && type !== 'number' && type !== 'boolean') {
            throw new ApiError('invalid_request', {
                details: { field: `metadata.${key}`, expected: 'a string, number, boolean or null' }
            });
        }
        if (type === 'string' && item.length > 500) {
            throw new ApiError('unprocessable_entity', {
                details: { field: `metadata.${key}`, max_length: 500 }
            });
        }
    }
    return value;
}
