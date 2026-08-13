/**
 * security.test.mjs — المراجعة الأمنية، مكتوبة كاختبارات
 * ============================================================
 * كل بند في المراجعة الأمنية للـAPI العام مكتوب هنا كتأكيد بيتنفّذ، مش
 * كسطر في قائمة. القائمة بتتنسى؛ الاختبار بيفشل.
 *
 * البنود اللي بتتغطى في ملفات تانية مذكورة هنا كمرجع:
 *   - المفتاح الخام مابيتخزنش، والإلغاء والانتهاء بيترفضوا
 *     → sie-integration/tests/public-api-sql.test.mjs
 *   - العزل بين المستأجرين من خلال HTTP حقيقي
 *     → sdk/js/tests/sdk.test.mjs
 *   - الرصيد والاستحقاق
 *     → public-api-sql (sie_consume_message) + router.test (403)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApiRouter } from '../v1/router.js';
import { startTestApi } from './helpers/test-server.mjs';
import { buildOpenApiDocument } from '../openapi.js';
import { renderDocsPage } from '../docs.js';
import { hashApiKey, looksLikeApiKey, apiKeyPrefix } from '../../sie-integration/sie-api-keys.js';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative) => readFile(`${REPO}/${relative}`, 'utf8');

const KEY = `sie_live_${'A'.repeat(43)}`;

// ── الأسرار ─────────────────────────────────────────────────────────
test('المفتاح مابيتسجّلش ولا بيتكتب في أي مصدر', async () => {
    const sources = [
        'api/v1/router.js', 'api/v1/handlers.js', 'api/v1/ports.js', 'api/v1/http.js',
        'sie-integration/sie-api-keys.js', 'sdk/js/src/index.js',
        'supabase/functions/sie-api/_shared/public-api.ts'
    ];

    for (const source of sources) {
        const code = await read(source);
        const logs = [...code.matchAll(/console\.(log|info|warn|error)\(([^\n]*)/g)].map((match) => match[2]);

        for (const line of logs) {
            assert.ok(!/\bapiKey\b|\brawKey\b|\bapi_key\b|\bkey\b\s*[,)]/.test(line),
                `${source}: سطر سجل ممكن يطبع مفتاح — ${line.slice(0, 80)}`);
        }
        // البادئة آمنة (مش سر) وهي اللي المفروض تتسجّل.
        assert.ok(!/console\.[a-z]+\([^)]*\bapiKey\b/.test(code), `${source}: المفتاح بيتطبع`);
    }
});

test('التحقق بياخد الهاش مش المفتاح — القيمة الخام مابتوصلش لقاعدة البيانات', async () => {
    const code = await read('sie-integration/sie-api-keys.js');
    assert.match(code, /p_key_hash:\s*await hashApiKey\(apiKey\)/,
        'التحقق بيبعت المفتاح نفسه لقاعدة البيانات');
    // ملاحظة: `p_api_key_id` معرّف المفتاح مش قيمته — ده مسموح.
    // اللي ممنوع هو تمرير القيمة الخام نفسها لأي معامل.
    assert.ok(!/p_[a-z_]*key[a-z_]*:\s*apiKey\b/.test(code),
        'فيه معامل بيبعت المفتاح الخام لقاعدة البيانات');
});

test('الهاش ثابت وطوله ٦٤ hex', async () => {
    const first = await hashApiKey(KEY);
    const second = await hashApiKey(KEY);
    assert.equal(first, second);
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.notEqual(first, await hashApiKey(`${KEY}x`));
});

test('فحص الشكل بيرفض قبل أي نداء على قاعدة البيانات', () => {
    assert.equal(looksLikeApiKey(KEY), true);
    assert.equal(looksLikeApiKey('sie_live_short'), false);
    assert.equal(looksLikeApiKey('bearer something'), false);
    assert.equal(looksLikeApiKey(''), false);
    // البادئة اللي بتتسجّل مابتحملش سر: ٩ حروف منها ثابتة للكل.
    assert.equal(apiKeyPrefix(KEY).length, 16);
});

test('المفتاح مابيرجعش في أي رد ولا بيتردد في الهيدرز', async () => {
    const api = await startTestApi();
    try {
        for (const path of ['/api/v1/me', '/api/v1/scenarios', '/api/v1/health']) {
            const response = await fetch(`${api.url}${path}`, {
                headers: { authorization: `Bearer ${KEY}` }
            });
            const body = await response.text();

            assert.ok(!body.includes(KEY), `${path}: المفتاح ظهر في الرد`);
            for (const [name, value] of response.headers) {
                assert.ok(!String(value).includes(KEY), `${path}: المفتاح ظهر في هيدر ${name}`);
            }
        }
    } finally {
        await api.close();
    }
});

test('المفتاح مابيظهرش في سجل الطلبات — البادئة بس هي اللي بتتخزن', async () => {
    const api = await startTestApi();
    try {
        await fetch(`${api.url}/api/v1/me`, { headers: { authorization: `Bearer ${KEY}` } });
        await fetch(`${api.url}/api/v1/me`, { headers: { authorization: 'Bearer sie_live_wrong' } });

        const dump = JSON.stringify(api.ports.state.log);
        assert.ok(!dump.includes(KEY), 'المفتاح الصالح اتسجّل');
        assert.ok(!dump.includes('sie_live_wrong'), 'المفتاح الغلط اتسجّل');
    } finally {
        await api.close();
    }
});

test('التوثيق والمستند مافيهمش أي مفتاح حقيقي', () => {
    const spec = JSON.stringify(buildOpenApiDocument());
    const docs = renderDocsPage();

    // الأمثلة فيها placeholder (`sie_live_xxxx…`) عن قصد — ده توثيق.
    // اللي ممنوع هو قيمة شكلها عشوائي فعلاً، يعني مفتاح حقيقي اتلزق.
    const candidates = [
        ...String(spec).matchAll(/sie_(?:live|test)_([A-Za-z0-9_-]{43})/g),
        ...String(docs).matchAll(/sie_(?:live|test)_([A-Za-z0-9_-]{43})/g)
    ].map((match) => match[1]);

    for (const secret of candidates) {
        const distinct = new Set(secret).size;
        assert.ok(distinct <= 2,
            `فيه قيمة شكلها مفتاح حقيقي في التوثيق: ${secret.slice(0, 8)}…`);
    }
});

// ── المصادقة ────────────────────────────────────────────────────────
test('كل صور المفتاح الغلط بترجع 401 من غير تفاصيل زيادة', async () => {
    const api = await startTestApi();
    try {
        const cases = [
            { name: 'ناقص', headers: {} },
            { name: 'مكسور', headers: { authorization: 'Bearer' } },
            { name: 'نوع تاني', headers: { authorization: 'Basic abc' } },
            { name: 'شكل غلط', headers: { authorization: 'Bearer not-a-key' } },
            { name: 'مش موجود', headers: { authorization: `Bearer sie_live_${'Z'.repeat(43)}` } },
            { name: 'ملغي', headers: { authorization: `Bearer sie_live_${'R'.repeat(43)}` } },
            { name: 'منتهي', headers: { authorization: `Bearer sie_live_${'E'.repeat(43)}` } }
        ];

        for (const testCase of cases) {
            const response = await fetch(`${api.url}/api/v1/me`, { headers: testCase.headers });
            assert.equal(response.status, 401, `${testCase.name}: الحالة ${response.status}`);

            const body = await response.json();
            assert.match(body.error.code, /^(missing_api_key|invalid_api_key|api_key_revoked|api_key_expired)$/);
            // مفيش تلميح عن وجود المفتاح من عدمه، ولا عن صاحبه.
            assert.ok(!/user|tenant|account|hash|row/i.test(JSON.stringify(body.error)),
                `${testCase.name}: الرد بيلمّح لتفاصيل داخلية`);
        }
    } finally {
        await api.close();
    }
});

// ── تسريب التفاصيل ──────────────────────────────────────────────────
test('الأخطاء الداخلية مابتكشفش قاعدة البيانات ولا أسماء الدوال', async () => {
    const leaks = [
        'relation "sie_api_keys" does not exist',
        'function public.sie_api_key_verify(text) does not exist',
        'JWT expired: eyJhbGciOiJIUzI1NiIs',
        'connect ECONNREFUSED 10.0.0.5:5432'
    ];

    for (const leak of leaks) {
        const api = await startTestApi({
            async getAccount() { throw new Error(leak); }
        });
        try {
            const response = await fetch(`${api.url}/api/v1/me`, {
                headers: { authorization: `Bearer ${KEY}` }
            });
            const body = await response.text();

            assert.equal(response.status, 500);
            assert.ok(!body.includes(leak), `الرسالة الداخلية اتسربت: ${leak}`);
            assert.ok(!/sie_api_keys|sie_consume_message|eyJhbGci|5432|ECONNREFUSED/.test(body),
                `الرد فيه تفاصيل داخلية: ${body.slice(0, 120)}`);
            assert.ok(!body.includes('at '), 'الرد فيه stack trace');
        } finally {
            await api.close();
        }
    }
});

test('مفيش اسم دالة قاعدة بيانات في أي رسالة خطأ معلنة', async () => {
    const { ERRORS } = await import('../v1/errors.js');
    for (const [code, spec] of Object.entries(ERRORS)) {
        const text = `${spec.message} ${spec.messageAr}`;
        assert.ok(!/sie_[a-z_]+\(|public\.|supabase|postgres|rpc/i.test(text),
            `${code}: الرسالة بتذكر تفاصيل داخلية`);
    }
});

// ── CORS ────────────────────────────────────────────────────────────
test('مفيش * ولا اعتمادات على مسارات الـAPI', async () => {
    const api = await startTestApi({}, { allowedOrigins: ['https://app.mad3oom.com'] });
    try {
        for (const origin of ['https://evil.example', 'null', 'http://localhost:3000']) {
            const response = await fetch(`${api.url}/api/v1/health`, { headers: { origin } });
            const allow = response.headers.get('access-control-allow-origin');
            assert.ok(allow === null || allow === 'https://app.mad3oom.com',
                `أصل ${origin} اتسمح له بـ${allow}`);
            assert.equal(response.headers.get('access-control-allow-credentials'), null);
        }
    } finally {
        await api.close();
    }
});

test('الإعداد الافتراضي مافيهوش أي أصل مسموح', async () => {
    const api = await startTestApi();   // من غير config
    try {
        const response = await fetch(`${api.url}/api/v1/health`, {
            headers: { origin: 'https://anything.example' }
        });
        assert.equal(response.headers.get('access-control-allow-origin'), null,
            'الافتراضي بيسمح لأصل من المتصفح');
    } finally {
        await api.close();
    }
});

// ── حدود الطلب ──────────────────────────────────────────────────────
test('حدود الحجم بتتنفّذ قبل أي شغل', async () => {
    let engineTouched = false;
    const api = await startTestApi({
        async chat() { engineTouched = true; return {}; }
    });
    try {
        const response = await fetch(`${api.url}/api/v1/chat`, {
            method: 'POST',
            headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
            body: JSON.stringify({ message: 'x'.repeat(50_000) })
        });
        assert.equal(response.status, 413);
        assert.equal(engineTouched, false, 'المحرك اشتغل على جسم أكبر من الحد');
    } finally {
        await api.close();
    }
});

// ── سطح الـAPI ──────────────────────────────────────────────────────
test('مفيش أي مسار بيدير مفاتيح', async () => {
    const { ROUTES } = await import('../v1/router.js');
    const spec = buildOpenApiDocument();

    for (const route of ROUTES) {
        assert.ok(!/key/i.test(route.path), `فيه مسار مفاتيح: ${route.path}`);
    }
    for (const path of Object.keys(spec.paths)) {
        assert.ok(!/key/i.test(path), `المستند بيوثّق مسار مفاتيح: ${path}`);
    }
});

test('عميل صلاحية الخدمة مابيتستخدمش في المسارات القديمة', async () => {
    const index = await read('supabase/functions/sie-api/index.ts');

    // المسارات القديمة كلها لازم تفضل على buildUserClient.
    assert.match(index, /const supabase = buildUserClient\(req\)/);
    assert.ok(!/buildServiceClient/.test(index),
        'index.ts بينده على عميل الخدمة — ده للـAPI العام بس، جوه public-api.ts');

    const publicApi = await read('supabase/functions/sie-api/_shared/public-api.ts');
    assert.match(publicApi, /buildServiceClient\(\)/);
});

test('الـAPI العام بيتوجّه قبل حد المعدل القديم', async () => {
    const index = await read('supabase/functions/sie-api/index.ts');
    const dispatchAt = index.indexOf('isPublicApiRequest(mountPath)');
    const legacyRateAt = index.indexOf('await checkRateLimit(');

    assert.ok(dispatchAt > 0 && legacyRateAt > 0);
    assert.ok(dispatchAt < legacyRateAt,
        'الـAPI العام بيعدي على حد المعدل القديم كمان — يعني بيتحاسب مرتين');
});

// ── الرصيد ──────────────────────────────────────────────────────────
test('الرصيد بيتفحص جوه المنفذ قبل ما المحرك يشتغل', async () => {
    const ports = await read('api/v1/ports.js');

    // الترتيب مهم: قراءة الاستحقاق، وبعدين رمي الخطأ، وبعدين المحرك.
    const entitlementAt = ports.indexOf('evaluateSieAccessRow(access)');
    const throwAt = ports.indexOf('entitlementCode(entitlement.reason)');
    const engineAt = ports.indexOf('runtime.getSieReply(');

    assert.ok(entitlementAt > 0 && throwAt > entitlementAt && engineAt > throwAt,
        'المحرك ممكن يشتغل قبل فحص الاستحقاق');

    // والصرف الحقيقي لسه في المحرك، مش هنا: الاسم مذكور في تعليق
    // بيشرح ده، فالتأكيد على النداء نفسه مش على ذكر الاسم.
    assert.ok(!/\.rpc\(\s*['"`]sie_consume_message/.test(ports),
        'المنفذ بيصرف الرصيد بنفسه بدل ما يسيبها للمحرك');
    assert.ok(!/\.rpc\(/.test(ports),
        'المنفذ بينده على قاعدة البيانات مباشرة بدل ما يعدي من الرَنتايم');
});
