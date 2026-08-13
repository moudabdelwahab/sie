/**
 * test-server.mjs — سيرفر HTTP حقيقي بالراوتر الحقيقي
 * ============================================================
 * بيوصّل `node:http` بالراوتر: الطلب الداخل بيتحوّل لـ`Request` قياسي،
 * والـ`Response` الراجع بيتكتب على السلك.
 *
 * ── ليه ده مهم ──────────────────────────────────────────────
 * اختبار بينده `router.handle()` مباشرة بيثبت المنطق. اختبار بيعدي على
 * HTTP حقيقي بيثبت كمان: الهيدرز اللي بتعدي فعلاً، وأجسام JSON
 * بترميزها الصح، والحالات زي ٤٢٩ وهي راجعة من سيرفر مش من دالة،
 * والعميل (SDK) وهو بيتكلم كأنه في الإنتاج.
 *
 * الجسر ده حاجة اختبارية بحتة — في الإنتاج Deno بيدي الراوتر
 * `Request` جاهز.
 */
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApiRouter } from '../../v1/router.js';

/**
 * @param {Object} router - نتيجة createApiRouter
 * @returns {Promise<{url: string, close: () => Promise<void>, requests: Array}>}
 */
export async function startRouterServer(router) {
    const requests = [];

    const server = createServer(async (incoming, outgoing) => {
        const url = `http://${incoming.headers.host ?? 'localhost'}${incoming.url}`;

        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const body = chunks.length ? Buffer.concat(chunks) : undefined;

        const request = new Request(url, {
            method: incoming.method,
            headers: incoming.headers,
            body: ['GET', 'HEAD'].includes(incoming.method) ? undefined : body
        });

        requests.push({ method: incoming.method, url: incoming.url, headers: incoming.headers });

        const response = await router.handle(request);
        const payload = Buffer.from(await response.arrayBuffer());

        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(payload);
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();

    return {
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((resolve) => server.close(resolve))
    };
}

/**
 * منافذ ثابتة — نفس الأشكال اللي المنافذ الحقيقية بترجّعها.
 * القيم متحكم فيها عشان الاختبار يقدر يوصل الـSDK لكل حالة خطأ.
 */
export function createTestPorts(overrides = {}) {
    const state = {
        rateLimit: { allowed: true, enabled: true, limit: 100, remaining: 98, resetSeconds: 42, retryAfter: 0 },
        keys: new Map([
            ['sie_live_' + 'A'.repeat(43), { userId: 'tenant-a', keyId: 'key-a', environment: 'live' }],
            ['sie_live_' + 'B'.repeat(43), { userId: 'tenant-b', keyId: 'key-b', environment: 'live' }],
            ['sie_test_' + 'T'.repeat(43), { userId: 'tenant-a', keyId: 'key-a-test', environment: 'test' }]
        ]),
        revoked: new Set(['sie_live_' + 'R'.repeat(43)]),
        expired: new Set(['sie_live_' + 'E'.repeat(43)]),
        log: [],
        // كل مستأجر وبياناته — عشان اختبار العزل يبقى له معنى.
        tenants: {
            'tenant-a': { name: 'Acme', quota: 500, used: 128 },
            'tenant-b': { name: 'Globex', quota: 50, used: 50 }
        }
    };

    const ports = {
        state,

        async verifyApiKey(apiKey) {
            const prefix = String(apiKey).slice(0, 16);
            if (state.revoked.has(apiKey)) return { valid: false, reason: 'revoked', prefix };
            if (state.expired.has(apiKey)) return { valid: false, reason: 'expired', prefix };

            const found = state.keys.get(apiKey);
            if (!found) return { valid: false, reason: 'invalid', prefix };
            return { valid: true, ...found, prefix };
        },

        async checkRateLimit() { return state.rateLimit; },

        async logRequest(entry) { state.log.push(entry); },

        async getAccount(userId) {
            const tenant = state.tenants[userId];
            return {
                access: { access_mode: 'quota', message_quota: tenant.quota, messages_used: tenant.used, expires_at: null },
                entitlement: { available: tenant.used < tenant.quota, statusLabel: 'مفعّل', reason: null },
                usage: {
                    messages_used: tenant.used,
                    message_quota: tenant.quota,
                    remaining: Math.max(tenant.quota - tenant.used, 0)
                }
            };
        },

        async chat({ userId, message, sessionId }) {
            const tenant = state.tenants[userId];
            if (tenant.used >= tenant.quota) {
                const { ApiError } = await import('../../v1/errors.js');
                throw new ApiError('quota_exhausted');
            }
            tenant.used += 1;
            return {
                sessionId: sessionId ?? `sess-${userId}`,
                reply: `[${tenant.name}] ${message}`,
                options: [],
                ticketNumber: null,
                usage: {
                    messages_used: tenant.used,
                    message_quota: tenant.quota,
                    remaining: Math.max(tenant.quota - tenant.used, 0)
                }
            };
        },

        async diagnose(message, { limit = 5 } = {}) {
            return {
                text: message,
                willResolve: true,
                threshold: 0.6,
                tokens: [{ token: 'entity_subscription', source: 'glossary' }],
                candidates: [{
                    scenarioId: 'subscription_expired',
                    label: { ar: 'الاشتراك منتهي', en: 'Subscription expired' },
                    category: 'subscription',
                    confidence: 0.83
                }].slice(0, limit)
            };
        },

        async listScenarios() {
            return [{
                id: 'subscription_expired',
                label: { ar: 'الاشتراك منتهي', en: 'Subscription expired' },
                category: 'subscription',
                resolution: { hasAutoResolution: true },
                requiresTicketIfUnresolved: true
            }];
        },

        async engineHealth() { return { loaded: true, catalog_size: 650, runtime_version: '2.4.0' }; },

        ...overrides
    };

    return ports;
}

/** سيرفر جاهز بمنافذ اختبارية. */
export async function startTestApi(overrides = {}, config = {}) {
    const ports = createTestPorts(overrides);
    const server = await startRouterServer(createApiRouter({ ports, config }));
    return { ...server, ports };
}

/**
 * Node مابيقراش `file://` بـfetch، والمحرك بيحمّل قاموسه كده.
 * الشيم ده بيخلي المحرك الحقيقي يشتغل في الاختبارات — نفس السبب اللي
 * موجود عشانه `sie/language/tests/helpers/node-providers.js`.
 */
export function enableFileFetch() {
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input?.url ?? String(input);
        if (url.startsWith('file://')) {
            const { readFile } = await import('node:fs/promises');
            const { fileURLToPath } = await import('node:url');
            const data = await readFile(fileURLToPath(url), 'utf8');
            return new Response(data, { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return original(input, init);
    };
    return () => { globalThis.fetch = original; };
}
