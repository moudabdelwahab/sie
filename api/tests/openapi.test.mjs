/**
 * openapi.test.mjs — العقد يطابق الكود
 * ============================================================
 * توثيق بيوصف API تاني غير الموجود أسوأ من مفيش توثيق: المطوّر بيبني
 * على وعد مش موجود ويكتشف ده في الإنتاج. الاختبارات دي بتربط الاتنين:
 *
 *   - كل مسار في الراوتر متوثّق، وكل مسار متوثّق موجود في الراوتر.
 *   - كل كود خطأ في القاموس موصوف في المستند.
 *   - أمثلة الردود مطابقة **بالمفاتيح** لرد حقيقي من الراوتر.
 *   - المستند نفسه صالح كـOpenAPI 3.1 من ناحية البنية.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenApiDocument, DEFAULT_BASE_URL } from '../openapi.js';
import { ROUTES, SUPPORTED_VERSIONS } from '../v1/router.js';
import { ERRORS } from '../v1/errors.js';
import { renderDocsPage } from '../docs.js';
import { createApiRouter } from '../v1/router.js';

const spec = buildOpenApiDocument();

// ── البنية ──────────────────────────────────────────────────────────
test('مستند صالح البنية', () => {
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.info.title && spec.info.version);
    assert.ok(spec.info.description.includes('Authorization: Bearer'));
    assert.equal(spec.servers[0].url, `${DEFAULT_BASE_URL}/api/v1`);
    assert.equal(spec.components.securitySchemes.ApiKeyAuth.scheme, 'bearer');
    assert.deepEqual(spec.security, [{ ApiKeyAuth: [] }]);
});

test('العنوان الأساسي هو /api/v1 مش /v1/api ولا /api', () => {
    assert.match(spec.servers[0].url, /\/api\/v1$/);
    assert.ok(SUPPORTED_VERSIONS.includes('v1'));
});

test('عنوان السيرفر بيتغير مع مكان النشر', () => {
    const staging = buildOpenApiDocument({ baseUrl: 'https://staging.example.com' });
    assert.equal(staging.servers[0].url, 'https://staging.example.com/api/v1');
});

// ── المسارات ────────────────────────────────────────────────────────
test('كل مسار في الراوتر متوثّق بنفس الطريقة', () => {
    for (const route of ROUTES) {
        const operation = spec.paths[route.path]?.[route.method.toLowerCase()];
        assert.ok(operation, `المسار ${route.method} ${route.path} مش متوثّق`);
        assert.equal(operation.operationId, route.operationId);
        assert.ok(operation.summary, `${route.operationId} مالوش عنوان`);
        assert.ok(operation.responses[200], `${route.operationId} مالوش رد ناجح`);
    }
});

test('مفيش مسار متوثّق مش موجود في الراوتر', () => {
    for (const [path, methods] of Object.entries(spec.paths)) {
        for (const method of Object.keys(methods)) {
            const exists = ROUTES.some(
                (route) => route.path === path && route.method.toLowerCase() === method
            );
            assert.ok(exists, `المستند بيوثّق ${method.toUpperCase()} ${path} وهو مش موجود`);
        }
    }
});

test('المسارات اللي محتاجة مفتاح بتورّث الأمان، والمفتوح بيعلن إنه مفتوح', () => {
    for (const route of ROUTES) {
        const operation = spec.paths[route.path][route.method.toLowerCase()];
        if (route.auth) {
            assert.equal(operation.security, undefined, `${route.operationId} المفروض يورّث الأمان العام`);
            assert.ok(operation.responses[401], `${route.operationId} مالوش رد 401`);
        } else {
            assert.deepEqual(operation.security, [], `${route.operationId} المفروض معلن إنه مفتوح`);
        }
    }
});

test('كل مسار محمي بيوثّق 429', () => {
    for (const route of ROUTES.filter((candidate) => candidate.auth)) {
        const operation = spec.paths[route.path][route.method.toLowerCase()];
        assert.ok(operation.responses[429], `${route.operationId} مالوش رد 429`);
    }
});

// ── الأخطاء ─────────────────────────────────────────────────────────
test('قائمة أكواد الأخطاء في المستند = القاموس بالظبط', () => {
    const documented = spec.components.schemas.Error.properties.error.properties.code.enum;
    assert.deepEqual([...documented].sort(), Object.keys(ERRORS).sort());
});

test('أمثلة الأخطاء بتستخدم نفس الرسائل والحالات الحقيقية', () => {
    for (const response of Object.values(spec.components.responses)) {
        const examples = response.content['application/json'].examples ?? {};
        for (const [code, example] of Object.entries(examples)) {
            assert.ok(ERRORS[code], `المستند فيه كود مش موجود: ${code}`);
            assert.equal(example.value.error.code, code);
            assert.equal(example.value.error.message, ERRORS[code].message);
            assert.equal(example.value.error.message_ar, ERRORS[code].messageAr);
            assert.ok(example.value.error.request_id, `${code} مثاله من غير request_id`);
        }
    }
});

// ── الأمثلة تطابق الردود الحقيقية ───────────────────────────────────

/** راوتر بمنافذ ثابتة، عشان نقارن مفاتيح الرد بمفاتيح المثال. */
function router() {
    const ports = {
        async verifyApiKey() {
            return { valid: true, userId: 'u1', keyId: 'k1', environment: 'live', prefix: 'sie_live_abcdef' };
        },
        async checkRateLimit() {
            return { allowed: true, enabled: true, limit: 100, remaining: 99, resetSeconds: 30, retryAfter: 0 };
        },
        async logRequest() {},
        async getAccount() {
            return {
                access: { access_mode: 'quota', message_quota: 500, messages_used: 128, expires_at: null },
                entitlement: { available: true, statusLabel: 'مفعّل' },
                usage: { messages_used: 128, message_quota: 500, remaining: 372 }
            };
        },
        async chat() {
            return {
                sessionId: 's1', reply: 'رد', options: [], ticketNumber: null,
                usage: { messages_used: 129, message_quota: 500, remaining: 371 }
            };
        },
        async diagnose(message) {
            return {
                text: message, willResolve: true, threshold: 0.6,
                tokens: [{ token: 'entity_whatsapp', source: 'glossary' }],
                candidates: [{
                    scenarioId: 'whatsapp_not_linked',
                    label: { ar: 'رقم الواتساب مش مربوط', en: 'WhatsApp number not linked' },
                    category: 'whatsapp',
                    confidence: 0.82
                }]
            };
        },
        async listScenarios() {
            return [{
                id: 'whatsapp_not_linked',
                label: { ar: 'رقم الواتساب مش مربوط', en: 'WhatsApp number not linked' },
                category: 'whatsapp',
                resolution: { hasAutoResolution: true },
                requiresTicketIfUnresolved: true
            }];
        },
        async engineHealth() { return { loaded: true, catalog_size: 650 }; }
    };
    return createApiRouter({ ports });
}

/** المفاتيح، بشكل متداخل، عشان المقارنة تبقى على الشكل مش القيم. */
function shape(value) {
    if (Array.isArray(value)) return value.length ? [shape(value[0])] : [];
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]));
    }
    return typeof value;
}

const cases = [
    { method: 'GET', path: '/health', url: '/api/v1/health' },
    { method: 'GET', path: '/me', url: '/api/v1/me' },
    { method: 'POST', path: '/chat', url: '/api/v1/chat', body: { message: 'أهلاً' } },
    { method: 'POST', path: '/diagnose', url: '/api/v1/diagnose', body: { message: 'الواتساب مش مربوط' } },
    { method: 'GET', path: '/scenarios', url: '/api/v1/scenarios' }
];

for (const testCase of cases) {
    test(`مثال ${testCase.method} ${testCase.path} مطابق للرد الحقيقي`, async () => {
        const api = router();
        const init = { method: testCase.method, headers: { authorization: 'Bearer sie_live_x' } };
        if (testCase.body) {
            init.body = JSON.stringify(testCase.body);
            init.headers['content-type'] = 'application/json';
        }

        const response = await api.handle(new Request(`https://sie.mad3oom.com${testCase.url}`, init));
        assert.equal(response.status, 200, `${testCase.path} رجّع ${response.status}`);

        const actual = await response.json();
        const documented = spec.paths[testCase.path][testCase.method.toLowerCase()]
            .responses[200].content['application/json'].example;

        assert.deepEqual(shape(actual), shape(documented),
            `شكل المثال في التوثيق مختلف عن الرد الحقيقي لـ${testCase.path}`);
    });
}

test('أمثلة الطلبات بتعدي على الـAPI الحقيقي', async () => {
    const api = router();

    for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, operation] of Object.entries(methods)) {
            const content = operation.requestBody?.content?.['application/json'];
            if (!content) continue;

            const examples = content.examples
                ? Object.values(content.examples).map((example) => example.value)
                : [content.example];

            for (const example of examples) {
                const response = await api.handle(new Request(`https://sie.mad3oom.com/api/v1${path}`, {
                    method: method.toUpperCase(),
                    headers: { authorization: 'Bearer sie_live_x', 'content-type': 'application/json' },
                    body: JSON.stringify(example)
                }));
                assert.equal(response.status, 200,
                    `مثال طلب على ${path} رجّع ${response.status}: ${JSON.stringify(example)}`);
            }
        }
    }
});

// ── صفحة التوثيق ────────────────────────────────────────────────────
test('الصفحة بتتبني من نفس المستند وفيها كل مسار', () => {
    const html = renderDocsPage();

    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /dir="rtl"/);
    for (const route of ROUTES) {
        assert.ok(html.includes(route.path), `صفحة التوثيق مافيهاش ${route.path}`);
    }
    for (const code of Object.keys(ERRORS)) {
        assert.ok(html.includes(code), `صفحة التوثيق مافيهاش الكود ${code}`);
    }
    assert.ok(html.includes('https://sie.mad3oom.com/api/v1'), 'العنوان الأساسي مش في الصفحة');
});

test('الصفحة مافيهاش أي اعتماد على سكربت خارجي', () => {
    const html = renderDocsPage();
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(scripts, [], `الصفحة بتحمّل سكربت خارجي: ${scripts.join(', ')}`);
});

test('الصفحة مابتكتبش أي مفتاح ولا بتخزنه', () => {
    const html = renderDocsPage();
    assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(html),
        'صفحة التوثيق بتخزّن المفتاح في المتصفح');
});
