/**
 * router.test.mjs — عقد SIE API v1
 * ============================================================
 * بيشغّل الراوتر الحقيقي بكائنات Request/Response حقيقية، فوق منافذ
 * مزيّفة. اللي بيتختبر هنا هو **العقد**: أي حالة HTTP بترجع، وأي كود
 * خطأ، وأي هيدرز — يعني بالظبط اللي العميل بيبني عليه.
 *
 * المنافذ مزيّفة عن قصد: الاختبار ده مالوش دعوة بالمحرك ولا بقاعدة
 * البيانات. المحرك الحقيقي بيتختبر في اختباراته، والـSQL في
 * sie-integration/tests/public-api-sql.test.mjs، والاتنين مع بعض
 * بيتوصلوا في api/tests/live-api.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiRouter, ROUTES, SUPPORTED_VERSIONS } from '../v1/router.js';
import { ERRORS } from '../v1/errors.js';

const BASE = 'https://sie.mad3oom.com';
const VALID_KEY = `sie_live_${'A'.repeat(43)}`;
const REVOKED_KEY = `sie_live_${'B'.repeat(43)}`;
const EXPIRED_KEY = `sie_live_${'C'.repeat(43)}`;
const UNKNOWN_KEY = `sie_live_${'D'.repeat(43)}`;
const USER = '11111111-2222-3333-4444-555555555555';

/** منافذ مزيّفة، مع مفاتيح للتحكم في السلوك من كل اختبار. */
function makePorts(overrides = {}) {
    const logged = [];
    const ports = {
        logged,
        rateLimit: { allowed: true, enabled: true, limit: 100, remaining: 99, resetSeconds: 30, retryAfter: 0 },

        async verifyApiKey(apiKey) {
            if (apiKey === VALID_KEY) {
                return { valid: true, userId: USER, keyId: 'key_1', environment: 'live', prefix: apiKey.slice(0, 16) };
            }
            if (apiKey === REVOKED_KEY) return { valid: false, reason: 'revoked', prefix: apiKey.slice(0, 16) };
            if (apiKey === EXPIRED_KEY) return { valid: false, reason: 'expired', prefix: apiKey.slice(0, 16) };
            return { valid: false, reason: 'invalid', prefix: apiKey.slice(0, 16) };
        },

        async checkRateLimit() { return ports.rateLimit; },

        async logRequest(entry) { logged.push(entry); },

        async getAccount() {
            return {
                access: { access_mode: 'quota', message_quota: 500, messages_used: 12, expires_at: null },
                entitlement: { available: true, statusLabel: 'مفعّل', reason: null },
                usage: { messages_used: 12, message_quota: 500, remaining: 488 }
            };
        },

        async chat({ message }) {
            return {
                sessionId: 'sess_1',
                reply: `رد على: ${message}`,
                options: [],
                ticketNumber: null,
                usage: { messages_used: 13, message_quota: 500, remaining: 487 }
            };
        },

        async diagnose(message, { limit }) {
            return {
                text: message,
                willResolve: true,
                threshold: 0.6,
                tokens: [{ token: 'entity_subscription', source: 'glossary' }],
                candidates: [
                    { scenarioId: 'subscription_expired', label: { ar: 'الاشتراك منتهي', en: 'Subscription expired' }, category: 'subscription', confidence: 0.83 },
                    { scenarioId: 'payment_failed', label: { ar: 'الدفع فشل', en: 'Payment failed' }, category: 'subscription', confidence: 0.4 }
                ].slice(0, limit)
            };
        },

        async listScenarios() {
            return [
                { id: 'a_case', label: { ar: 'حالة أ', en: 'Case A' }, category: 'whatsapp', resolution: { hasAutoResolution: true }, requiresTicketIfUnresolved: true },
                { id: 'b_case', label: { ar: 'حالة ب', en: 'Case B' }, category: 'login', resolution: { hasAutoResolution: false }, requiresTicketIfUnresolved: true }
            ];
        },

        async engineHealth() { return { loaded: true, catalog_size: 650 }; },

        ...overrides
    };
    return ports;
}

function makeRouter(overrides, config) {
    const ports = makePorts(overrides);
    return { ports, router: createApiRouter({ ports, config }) };
}

function call(router, path, { method = 'GET', key = VALID_KEY, body, headers = {} } = {}) {
    const init = { method, headers: { ...headers } };
    if (key) init.headers.authorization = `Bearer ${key}`;
    if (body !== undefined) {
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
        init.headers['content-type'] = init.headers['content-type'] ?? 'application/json';
    }
    return router.handle(new Request(`${BASE}${path}`, init));
}

const readJson = async (response) => JSON.parse(await response.text());

// ── المصادقة ────────────────────────────────────────────────────────
test('مفتاح صالح بيعدي', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/me');
    assert.equal(response.status, 200);

    const body = await readJson(response);
    assert.equal(body.account.id, USER);
    assert.equal(body.api_key.prefix, VALID_KEY.slice(0, 16));
    // المفتاح نفسه ماينفعش يبقى في أي رد.
    assert.ok(!JSON.stringify(body).includes(VALID_KEY), 'المفتاح الكامل ظهر في الرد');
});

test('من غير مفتاح: 401 missing_api_key', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/me', { key: null });
    assert.equal(response.status, 401);
    assert.equal((await readJson(response)).error.code, 'missing_api_key');
});

test('مفتاح مش موجود: 401 invalid_api_key', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/me', { key: UNKNOWN_KEY });
    assert.equal(response.status, 401);
    assert.equal((await readJson(response)).error.code, 'invalid_api_key');
});

test('مفتاح ملغي ومفتاح منتهي بياخدوا أكواد بتفرق', async () => {
    const { router } = makeRouter();

    const revoked = await call(router, '/api/v1/me', { key: REVOKED_KEY });
    assert.equal(revoked.status, 401);
    assert.equal((await readJson(revoked)).error.code, 'api_key_revoked');

    const expired = await call(router, '/api/v1/me', { key: EXPIRED_KEY });
    assert.equal(expired.status, 401);
    assert.equal((await readJson(expired)).error.code, 'api_key_expired');
});

test('هيدر Authorization مكسور بيترفض زي الناقص', async () => {
    const { router } = makeRouter();
    const response = await router.handle(new Request(`${BASE}/api/v1/me`, {
        headers: { authorization: 'Token abc' }
    }));
    assert.equal(response.status, 401);
    assert.equal((await readJson(response)).error.code, 'missing_api_key');
});

test('/health مفتوح من غير مفتاح', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/health', { key: null });
    assert.equal(response.status, 200);

    const body = await readJson(response);
    assert.equal(body.status, 'ok');
    assert.equal(body.engine.catalog_size, 650);
});

// ── الصلاحية والاستحقاق ─────────────────────────────────────────────
test('رصيد خلص: 403 quota_exhausted مش 200', async () => {
    const { ApiError } = await import('../v1/errors.js');
    const { router } = makeRouter({
        async chat() { throw new ApiError('quota_exhausted'); }
    });

    const response = await call(router, '/api/v1/chat', { method: 'POST', body: { message: 'أهلاً' } });
    assert.equal(response.status, 403);
    assert.equal((await readJson(response)).error.code, 'quota_exhausted');
});

test('جلسة بتاعة حساب تاني: 409', async () => {
    const { ApiError } = await import('../v1/errors.js');
    const { router } = makeRouter({
        async chat() { throw new ApiError('session_conflict'); }
    });

    const response = await call(router, '/api/v1/chat', {
        method: 'POST', body: { message: 'أهلاً', session_id: 'someone-elses' }
    });
    assert.equal(response.status, 409);
    assert.equal((await readJson(response)).error.code, 'session_conflict');
});

// ── التحقق من المدخلات ──────────────────────────────────────────────
test('رسالة ناقصة: 400 invalid_request مع اسم الحقل', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/chat', { method: 'POST', body: {} });
    assert.equal(response.status, 400);

    const body = await readJson(response);
    assert.equal(body.error.code, 'invalid_request');
    assert.equal(body.error.details.field, 'message');
});

test('JSON مكسور: 400 invalid_json', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/chat', { method: 'POST', body: '{"message":' });
    assert.equal(response.status, 400);
    assert.equal((await readJson(response)).error.code, 'invalid_json');
});

test('نوع محتوى غلط: 415', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/chat', {
        method: 'POST', body: 'message=hi', headers: { 'content-type': 'application/x-www-form-urlencoded' }
    });
    assert.equal(response.status, 415);
    assert.equal((await readJson(response)).error.code, 'unsupported_media_type');
});

test('جسم أكبر من الحد: 413', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/chat', {
        method: 'POST', body: { message: 'x'.repeat(40_000) }
    });
    assert.equal(response.status, 413);
    assert.equal((await readJson(response)).error.code, 'payload_too_large');
});

test('رسالة أطول من المسموح: 422 مش 400', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/chat', {
        method: 'POST', body: { message: 'ب'.repeat(4001) }
    });
    assert.equal(response.status, 422);

    const body = await readJson(response);
    assert.equal(body.error.code, 'unprocessable_entity');
    assert.equal(body.error.details.max_length, 4000);
});

test('metadata لازم تكون كائن مسطّح بحدود', async () => {
    const { router } = makeRouter();

    const notObject = await call(router, '/api/v1/chat', {
        method: 'POST', body: { message: 'hi', metadata: ['a'] }
    });
    assert.equal(notObject.status, 400);

    const nested = await call(router, '/api/v1/chat', {
        method: 'POST', body: { message: 'hi', metadata: { deep: { a: 1 } } }
    });
    assert.equal(nested.status, 400);

    const ok = await call(router, '/api/v1/chat', {
        method: 'POST', body: { message: 'hi', metadata: { ticket: 'T-1', priority: 2, urgent: true } }
    });
    assert.equal(ok.status, 200);
});

test('limit في diagnose بيتفحص', async () => {
    const { router } = makeRouter();
    const bad = await call(router, '/api/v1/diagnose', { method: 'POST', body: { message: 'hi', limit: 99 } });
    assert.equal(bad.status, 422);
    assert.equal((await readJson(bad)).error.details.field, 'limit');

    const ok = await call(router, '/api/v1/diagnose', { method: 'POST', body: { message: 'hi', limit: 1 } });
    assert.equal(ok.status, 200);
    assert.equal((await readJson(ok)).candidates.length, 1);
});

// ── حد المعدل ───────────────────────────────────────────────────────
test('تجاوز الحد: 429 مع Retry-After وهيدرز الحد', async () => {
    const { ports, router } = makeRouter();
    ports.rateLimit = { allowed: false, enabled: true, limit: 100, remaining: 0, resetSeconds: 12, retryAfter: 12 };

    const response = await call(router, '/api/v1/chat', { method: 'POST', body: { message: 'أهلاً' } });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '12');
    assert.equal(response.headers.get('RateLimit-Limit'), '100');
    assert.equal(response.headers.get('RateLimit-Remaining'), '0');

    const body = await readJson(response);
    assert.equal(body.error.code, 'rate_limited');
    assert.equal(body.error.details.retry_after_seconds, 12);
});

test('الطلب الناجح كمان بيشيل هيدرز الحد', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/me');
    assert.equal(response.headers.get('RateLimit-Remaining'), '99');
});

test('الحد المقفول مابيعلنش سقف مش بيتنفذ', async () => {
    const { ports, router } = makeRouter();
    ports.rateLimit = { allowed: true, enabled: false, limit: 0, remaining: 0, resetSeconds: 0, retryAfter: 0 };

    const response = await call(router, '/api/v1/me');
    assert.equal(response.headers.get('RateLimit-Limit'), null);
    assert.equal((await readJson(response)).rate_limit.enabled, false);
});

test('الحد بيتفحص قبل ما المحرك يشتغل', async () => {
    let called = false;
    const { ports, router } = makeRouter({ async chat() { called = true; return {}; } });
    ports.rateLimit = { allowed: false, enabled: true, limit: 5, remaining: 0, resetSeconds: 9, retryAfter: 9 };

    await call(router, '/api/v1/chat', { method: 'POST', body: { message: 'أهلاً' } });
    assert.equal(called, false, 'المحرك اشتغل رغم إن الحد اتجاوز');
});

// ── الإصدارات والتوجيه ──────────────────────────────────────────────
test('إصدار مش مدعوم: 404 unsupported_version مع قائمة المدعوم', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v2/chat', { method: 'POST', body: { message: 'hi' } });
    assert.equal(response.status, 404);

    const body = await readJson(response);
    assert.equal(body.error.code, 'unsupported_version');
    assert.deepEqual(body.error.details.supported, [...SUPPORTED_VERSIONS]);
});

test('مسار مش موجود: 404 not_found', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/nope');
    assert.equal(response.status, 404);
    assert.equal((await readJson(response)).error.code, 'not_found');
});

test('طريقة غلط: 405 مع المسموح', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/chat');
    assert.equal(response.status, 405);

    const body = await readJson(response);
    assert.equal(body.error.code, 'method_not_allowed');
    assert.deepEqual(body.error.details.allowed, ['POST']);
});

test('المسار بيتقبل بادئة Supabase وبادئة الدومين', async () => {
    const { router } = makeRouter();
    for (const path of ['/api/v1/health', '/functions/v1/sie-api/api/v1/health', '/api/v1/health/']) {
        const response = await call(router, path, { key: null });
        assert.equal(response.status, 200, `المسار ${path} مااتعرفش`);
    }
});

// ── معرّف الطلب ─────────────────────────────────────────────────────
test('كل رد فيه X-Request-Id، والخطأ فيه نفس المعرّف', async () => {
    const { router } = makeRouter();

    const ok = await call(router, '/api/v1/me');
    assert.match(ok.headers.get('X-Request-Id'), /^req_[0-9a-f]{32}$/);

    const bad = await call(router, '/api/v1/me', { key: UNKNOWN_KEY });
    const header = bad.headers.get('X-Request-Id');
    assert.equal((await readJson(bad)).error.request_id, header);
});

test('معرّف العميل بيتحترم بعد تنضيفه', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/me', { headers: { 'x-request-id': 'trace-abc-123' } });
    assert.equal(response.headers.get('X-Request-Id'), 'trace-abc-123');

    // المسافة والأقواس بتتشال، والحروف بتفضل — المهم إن اللي بيرجع في
    // الهيدر مايقدرش يحمل markup ولا يكسر سطر في السجل.
    const dirty = await call(router, '/api/v1/me', { headers: { 'x-request-id': 'bad id<script>' } });
    assert.equal(dirty.headers.get('X-Request-Id'), 'badidscript');

    // قصير أوي = مش معرّف حقيقي، فبنولّد واحد بدله.
    const tooShort = await call(router, '/api/v1/me', { headers: { 'x-request-id': 'abc' } });
    assert.match(tooShort.headers.get('X-Request-Id'), /^req_/);
});

// ── السجل ───────────────────────────────────────────────────────────
test('كل طلب بيتسجّل — الناجح والفاشل — من غير أي سر', async () => {
    const { ports, router } = makeRouter();

    await call(router, '/api/v1/me');
    await call(router, '/api/v1/me', { key: UNKNOWN_KEY });

    assert.equal(ports.logged.length, 2);
    const [ok, failed] = ports.logged;

    assert.equal(ok.status, 200);
    assert.equal(ok.userId, USER);
    assert.equal(ok.keyId, 'key_1');
    assert.ok(Number.isFinite(ok.durationMs));

    assert.equal(failed.status, 401);
    assert.equal(failed.errorCode, 'invalid_api_key');
    assert.equal(failed.userId, null, 'مفتاح مرفوض اتسجّل بهوية');

    const dump = JSON.stringify(ports.logged);
    assert.ok(!dump.includes(VALID_KEY) && !dump.includes(UNKNOWN_KEY), 'المفتاح الخام اتسجّل');
});

test('فشل السجل مابيوقعش الطلب', async () => {
    const { router } = makeRouter({
        async logRequest() { throw new Error('log store down'); }
    });
    const response = await call(router, '/api/v1/me');
    assert.equal(response.status, 200);
});

// ── الأخطاء الداخلية ────────────────────────────────────────────────
test('استثناء مش متوقع بيبقى 500 عام من غير تفاصيل داخلية', async () => {
    const { router } = makeRouter({
        async getAccount() { throw new Error('relation "sie_api_keys" does not exist'); }
    });

    const response = await call(router, '/api/v1/me');
    assert.equal(response.status, 500);

    const body = await readJson(response);
    assert.equal(body.error.code, 'internal_error');
    assert.ok(!JSON.stringify(body).includes('sie_api_keys'), 'تفاصيل قاعدة البيانات اتسربت في الرد');
});

// ── CORS ────────────────────────────────────────────────────────────
test('CORS: أصل مش مسموح مابياخدش هيدر سماح', async () => {
    const { router } = makeRouter({}, { allowedOrigins: ['https://app.mad3oom.com'] });

    const blocked = await router.handle(new Request(`${BASE}/api/v1/health`, {
        headers: { origin: 'https://evil.example' }
    }));
    assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), null);

    const allowed = await router.handle(new Request(`${BASE}/api/v1/health`, {
        headers: { origin: 'https://app.mad3oom.com' }
    }));
    assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://app.mad3oom.com');
});

test('CORS: مفيش * ومفيش سماح باعتمادات', async () => {
    const { router } = makeRouter({}, { allowedOrigins: ['https://app.mad3oom.com'] });
    const response = await router.handle(new Request(`${BASE}/api/v1/health`, {
        method: 'OPTIONS', headers: { origin: 'https://app.mad3oom.com' }
    }));

    assert.equal(response.status, 204);
    assert.notEqual(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
});

test('OPTIONS مابيستهلكش من الحد ولا بيطلب مفتاح', async () => {
    const { ports, router } = makeRouter();
    let checked = false;
    ports.checkRateLimit = async () => { checked = true; return ports.rateLimit; };

    const response = await router.handle(new Request(`${BASE}/api/v1/chat`, { method: 'OPTIONS' }));
    assert.equal(response.status, 204);
    assert.equal(checked, false);
});

// ── شكل الردود ──────────────────────────────────────────────────────
test('رد المحادثة بالشكل الموثّق', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/chat', {
        method: 'POST', body: { message: 'مش عارف أدخل', end_user_id: 'user-9' }
    });
    assert.equal(response.status, 200);

    const body = await readJson(response);
    assert.deepEqual(Object.keys(body).sort(), ['reply', 'request_id', 'session_id', 'ticket', 'usage']);
    assert.equal(body.session_id, 'sess_1');
    assert.equal(typeof body.reply.text, 'string');
    assert.deepEqual(body.usage, { messages_used: 13, message_quota: 500, remaining: 487 });
});

test('رد التشخيص فيه الترتيب والإشارات', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/diagnose', { method: 'POST', body: { message: 'اشتراكي خلص' } });

    const body = await readJson(response);
    assert.equal(body.will_resolve, true);
    assert.equal(body.confidence_threshold, 0.6);
    assert.equal(body.candidates[0].scenario_id, 'subscription_expired');
    assert.equal(body.candidates[0].confidence, 0.83);
    assert.equal(body.signals[0].token, 'entity_subscription');
});

test('السيناريوهات بترجع من غير نصوص الحلول', async () => {
    const { router } = makeRouter();
    const response = await call(router, '/api/v1/scenarios?category=login');

    const body = await readJson(response);
    assert.equal(body.total, 1);
    assert.equal(body.data[0].id, 'b_case');
    assert.equal(body.data[0].resolves_automatically, false);
    assert.ok(!('resolution' in body.data[0]), 'الرد فيه تفاصيل الحل');
});

// ── ثوابت العقد ─────────────────────────────────────────────────────
test('مفيش مسار لإدارة المفاتيح في الـAPI', async () => {
    // مفتاح يقدر يعمل مفاتيح = سرقة واحدة بتبقى دايمة.
    const keyRoutes = ROUTES.filter((route) => /key/i.test(route.path));
    assert.deepEqual(keyRoutes, []);
});

test('كل خطأ في القاموس ليه حالة HTTP منطقية', () => {
    for (const [code, spec] of Object.entries(ERRORS)) {
        assert.ok(spec.status >= 400 && spec.status <= 599, `${code} حالته ${spec.status}`);
        assert.ok(spec.message.length > 10, `${code} رسالته مختصرة أوي`);
        assert.ok(spec.messageAr.length > 5, `${code} مالوش رسالة عربية`);
    }
});
