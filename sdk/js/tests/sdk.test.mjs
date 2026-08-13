/**
 * sdk.test.mjs — الـSDK فوق HTTP حقيقي
 * ============================================================
 * كل اختبار هنا بيشغّل سيرفر HTTP حقيقي بالراوتر الحقيقي، والـSDK
 * بيتكلم معاه بـfetch عادي. مفيش أي محاكاة للـAPI نفسه.
 *
 * ── ليه مش mock ─────────────────────────────────────────────
 * SDK متختبر بـmock بيثبت إن الكود بينده الدالة اللي المبرمج متوقعها.
 * اللي بيهم فعلاً حاجة تانية: إن الهيدر بيوصل، وإن ٤٢٩ بيتحول لخطأ
 * فيه retryAfter، وإن رد مش JSON مابيرميش استثناء غامض. الحاجات دي
 * مابتظهرش غير على سلك حقيقي.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { SIE, SIEError, SIEConnectionError, DEFAULT_BASE_URL } from '../src/index.js';
import { startTestApi } from '../../../api/tests/helpers/test-server.mjs';

const KEY_A = `sie_live_${'A'.repeat(43)}`;
const KEY_B = `sie_live_${'B'.repeat(43)}`;
const KEY_REVOKED = `sie_live_${'R'.repeat(43)}`;
const KEY_EXPIRED = `sie_live_${'E'.repeat(43)}`;
const KEY_UNKNOWN = `sie_live_${'Z'.repeat(43)}`;

const servers = [];
after(async () => { for (const server of servers) await server.close(); });

/** سيرفر + عميل جاهزين. */
async function connect({ key = KEY_A, overrides = {}, options = {} } = {}) {
    const api = await startTestApi(overrides);
    servers.push(api);
    return {
        api,
        sie: new SIE({ apiKey: key, baseUrl: `${api.url}/api/v1`, ...options })
    };
}

// ── الإعداد ─────────────────────────────────────────────────────────
test('العنوان الافتراضي هو الـAPI الرسمي', () => {
    assert.equal(DEFAULT_BASE_URL, 'https://sie.mad3oom.com/api/v1');
    const sie = new SIE({ apiKey: KEY_A });
    assert.equal(sie.baseUrl, 'https://sie.mad3oom.com/api/v1');
});

test('من غير مفتاح مابيتبنيش', () => {
    assert.throws(() => new SIE({}), /apiKey is required/);
    assert.throws(() => new SIE({ apiKey: 'not-a-key' }), /does not look like a SIE key/);
});

test('العنوان بيتظبط لو فيه شرطة زايدة', async () => {
    const { api } = await connect();
    const sie = new SIE({ apiKey: KEY_A, baseUrl: `${api.url}/api/v1/` });
    assert.equal(sie.baseUrl, `${api.url}/api/v1`);
});

// ── نداءات ناجحة على السلك ──────────────────────────────────────────
test('chat() بيوصل للراوتر ويرجّع الرد', async () => {
    const { sie } = await connect();
    const result = await sie.chat({ message: 'مش عارف أدخل', endUserId: 'u-1' });

    assert.equal(result.reply.text, '[Acme] مش عارف أدخل');
    assert.ok(result.session_id);
    assert.equal(result.usage.remaining, 371);
    assert.match(result.requestId, /^req_/);
});

test('chat() بيبعت session_id لما يتاخد', async () => {
    const { sie } = await connect();
    const first = await sie.chat({ message: 'أهلاً' });
    const second = await sie.chat({ message: 'كمل', sessionId: first.session_id });
    assert.equal(second.session_id, first.session_id);
});

test('diagnose() بيرجّع الترتيب والإشارات', async () => {
    const { sie } = await connect();
    const result = await sie.diagnose({ message: 'اشتراكي خلص', limit: 1 });

    assert.equal(result.will_resolve, true);
    assert.equal(result.candidates[0].scenario_id, 'subscription_expired');
    assert.equal(result.signals[0].token, 'entity_subscription');
});

test('me() و scenarios() و health()', async () => {
    const { sie } = await connect();

    const me = await sie.me();
    assert.equal(me.account.sie_enabled, true);
    assert.equal(me.api_key.environment, 'live');
    assert.equal(me.rate_limit.limit_per_minute, 100);

    const scenarios = await sie.scenarios({ category: 'subscription' });
    assert.equal(scenarios.total, 1);
    assert.equal(scenarios.data[0].id, 'subscription_expired');

    const health = await sie.health();
    assert.equal(health.status, 'ok');
    assert.equal(health.engine.runtime_version, '2.4.0');
});

test('scenarios() بيبني الاستعلام صح', async () => {
    const { api, sie } = await connect();
    await sie.scenarios({ category: 'login', limit: 5, offset: 10 });

    const last = api.requests.at(-1);
    assert.match(last.url, /\/api\/v1\/scenarios\?category=login&limit=5&offset=10$/);
});

// ── المصادقة ────────────────────────────────────────────────────────
test('مفتاح مش معروف: SIEError بكود invalid_api_key', async () => {
    const { sie } = await connect({ key: KEY_UNKNOWN });

    await assert.rejects(() => sie.me(), (error) => {
        assert.ok(error instanceof SIEError);
        assert.equal(error.code, 'invalid_api_key');
        assert.equal(error.status, 401);
        assert.equal(error.retryable, false);
        assert.match(error.requestId, /^req_/);
        return true;
    });
});

test('مفتاح ملغي ومفتاح منتهي ليهم أكواد مختلفة', async () => {
    const revoked = await connect({ key: KEY_REVOKED });
    await assert.rejects(() => revoked.sie.me(), (error) => error.code === 'api_key_revoked');

    const expired = await connect({ key: KEY_EXPIRED });
    await assert.rejects(() => expired.sie.me(), (error) => error.code === 'api_key_expired');
});

test('المفتاح بيتبعت في الهيدر ومابيظهرش في المسار', async () => {
    const { api, sie } = await connect();
    await sie.me();

    const last = api.requests.at(-1);
    assert.equal(last.headers.authorization, `Bearer ${KEY_A}`);
    assert.ok(!last.url.includes('sie_live_'), 'المفتاح ظهر في المسار');
});

// ── العزل بين المستأجرين ────────────────────────────────────────────
test('كل مفتاح بيشوف حسابه هو بس', async () => {
    const api = await startTestApi();
    servers.push(api);

    const acme = new SIE({ apiKey: KEY_A, baseUrl: `${api.url}/api/v1` });
    const globex = new SIE({ apiKey: KEY_B, baseUrl: `${api.url}/api/v1` });

    const acmeMe = await acme.me();
    const globexMe = await globex.me();

    assert.equal(acmeMe.account.id, 'tenant-a');
    assert.equal(globexMe.account.id, 'tenant-b');
    assert.notEqual(acmeMe.usage.message_quota, globexMe.usage.message_quota);

    // ورد المحادثة بيتبني من بيانات المستأجر بتاع المفتاح، مش أي حد تاني.
    const reply = await acme.chat({ message: 'test' });
    assert.match(reply.reply.text, /^\[Acme\]/);
});

test('مفتاح مالوش رصيد مابيقدرش يستهلك — والتاني مابيتأثرش', async () => {
    const api = await startTestApi();
    servers.push(api);

    const globex = new SIE({ apiKey: KEY_B, baseUrl: `${api.url}/api/v1` });   // 50/50 مستهلكة
    const acme = new SIE({ apiKey: KEY_A, baseUrl: `${api.url}/api/v1` });

    await assert.rejects(() => globex.chat({ message: 'أهلاً' }), (error) => {
        assert.equal(error.code, 'quota_exhausted');
        assert.equal(error.status, 403);
        return true;
    });

    const ok = await acme.chat({ message: 'أهلاً' });
    assert.equal(ok.usage.remaining, 371);
});

// ── الأخطاء ─────────────────────────────────────────────────────────
test('طلب ناقص حقل: 400 مع اسم الحقل في details', async () => {
    const { sie } = await connect();

    await assert.rejects(() => sie.chat({}), (error) => {
        assert.ok(error instanceof SIEError);
        assert.equal(error.code, 'invalid_request');
        assert.equal(error.details.field, 'message');
        assert.ok(error.messageAr, 'الرسالة العربية مش موجودة');
        return true;
    });
});

test('429 بيوصل كخطأ قابل لإعادة المحاولة مع حالة الحد', async () => {
    const { api, sie } = await connect();
    api.ports.state.rateLimit = {
        allowed: false, enabled: true, limit: 10, remaining: 0, resetSeconds: 7, retryAfter: 7
    };

    await assert.rejects(() => sie.chat({ message: 'أهلاً' }), (error) => {
        assert.equal(error.code, 'rate_limited');
        assert.equal(error.status, 429);
        assert.equal(error.retryable, true);
        assert.equal(error.details.retry_after_seconds, 7);
        return true;
    });
});

test('٥xx بيتحسب قابل لإعادة المحاولة', async () => {
    const { sie } = await connect({
        overrides: { async getAccount() { throw new Error('boom'); } }
    });

    await assert.rejects(() => sie.me(), (error) => {
        assert.equal(error.status, 500);
        assert.equal(error.code, 'internal_error');
        assert.equal(error.retryable, true);
        // الرسالة الداخلية مالهاش مكان في العميل.
        assert.ok(!/boom/.test(error.message));
        return true;
    });
});

// ── الشبكة ──────────────────────────────────────────────────────────
test('سيرفر مقفول: SIEConnectionError مش SIEError', async () => {
    const api = await startTestApi();
    const url = api.url;
    await api.close();

    const sie = new SIE({ apiKey: KEY_A, baseUrl: `${url}/api/v1`, timeout: 2000 });
    await assert.rejects(() => sie.me(), (error) => {
        assert.ok(error instanceof SIEConnectionError);
        assert.equal(error.timeout, false);
        return true;
    });
});

test('المهلة بتقطع الطلب وبتقول إنها مهلة', async () => {
    // سيرفر بيسكت عن قصد.
    const slow = createServer(() => { /* مفيش رد */ });
    slow.listen(0, '127.0.0.1');
    await once(slow, 'listening');

    const sie = new SIE({
        apiKey: KEY_A,
        baseUrl: `http://127.0.0.1:${slow.address().port}/api/v1`,
        timeout: 250
    });

    await assert.rejects(() => sie.me(), (error) => {
        assert.ok(error instanceof SIEConnectionError);
        assert.equal(error.timeout, true);
        assert.match(error.message, /timed out after 250ms/);
        return true;
    });

    await new Promise((resolve) => slow.close(resolve));
});

test('المهلة تتظبط لكل نداء لوحده', async () => {
    const slow = createServer(() => {});
    slow.listen(0, '127.0.0.1');
    await once(slow, 'listening');

    const sie = new SIE({ apiKey: KEY_A, baseUrl: `http://127.0.0.1:${slow.address().port}/api/v1` });
    const started = Date.now();
    await assert.rejects(() => sie.me({ timeout: 200 }), (error) => error.timeout === true);
    assert.ok(Date.now() - started < 2000, 'المهلة المحلية مااتطبقتش');

    await new Promise((resolve) => slow.close(resolve));
});

test('إلغاء من المستخدم بـAbortSignal', async () => {
    const slow = createServer(() => {});
    slow.listen(0, '127.0.0.1');
    await once(slow, 'listening');

    const sie = new SIE({ apiKey: KEY_A, baseUrl: `http://127.0.0.1:${slow.address().port}/api/v1` });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60);

    await assert.rejects(() => sie.me({ signal: controller.signal }), (error) => {
        assert.ok(error instanceof SIEConnectionError);
        assert.equal(error.timeout, false, 'الإلغاء اتحسب مهلة');
        return true;
    });

    await new Promise((resolve) => slow.close(resolve));
});

test('رد مش JSON بيبقى خطأ اتصال واضح', async () => {
    const html = createServer((_, outgoing) => {
        outgoing.writeHead(502, { 'Content-Type': 'text/html' });
        outgoing.end('<html>gateway</html>');
    });
    html.listen(0, '127.0.0.1');
    await once(html, 'listening');

    const sie = new SIE({ apiKey: KEY_A, baseUrl: `http://127.0.0.1:${html.address().port}/api/v1` });
    await assert.rejects(() => sie.me(), (error) => {
        assert.ok(error instanceof SIEConnectionError);
        assert.match(error.message, /non-JSON/);
        return true;
    });

    await new Promise((resolve) => html.close(resolve));
});

// ── معرّفات الطلبات وحالة الحد ──────────────────────────────────────
test('معرّف الطلب بيتقرا من الرد', async () => {
    const { sie } = await connect();
    const result = await sie.me();
    assert.match(result.requestId, /^req_[0-9a-f]{32}$/);
});

test('معرّف العميل بيتبعت وبيرجع زي ما هو', async () => {
    const { api, sie } = await connect();
    const result = await sie.me({ requestId: 'crm-trace-4821' });

    assert.equal(api.requests.at(-1).headers['x-request-id'], 'crm-trace-4821');
    assert.equal(result.requestId, 'crm-trace-4821');
});

test('حالة الحد متاحة على الرد من غير ما تلوّث الـJSON', async () => {
    const { sie } = await connect();
    const result = await sie.me();

    assert.equal(result.rateLimit.limit, 100);
    assert.equal(result.rateLimit.remaining, 98);
    assert.equal(result.rateLimit.resetSeconds, 42);

    // JSON.stringify للرد لازم يفضل زي ما الـAPI بعته بالظبط.
    assert.ok(!JSON.stringify(result).includes('rateLimit'));
    assert.ok(!JSON.stringify(result).includes('requestId'));
});

// ── التوسع ──────────────────────────────────────────────────────────
test('request() الخام بيوصل لأي مسار', async () => {
    const { sie } = await connect();
    const health = await sie.request('GET', '/health');
    assert.equal(health.service, 'sie-api');
});

test('fetch مخصص بيتحترم', async () => {
    const { api } = await connect();
    let calls = 0;
    const sie = new SIE({
        apiKey: KEY_A,
        baseUrl: `${api.url}/api/v1`,
        fetch: (...args) => { calls += 1; return fetch(...args); }
    });

    await sie.health();
    assert.equal(calls, 1);
});
