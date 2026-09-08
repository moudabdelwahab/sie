import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * ------------------------------------------------------------
 * The limiter's ARITHMETIC is verified against the real database (a token
 * bucket in Postgres cannot be meaningfully tested against a mock of
 * itself). What this file guards is the part that lives in TypeScript and
 * has no database to check it: the wiring, the headers, and the failure
 * posture — each of which fails silently rather than loudly.
 *
 * Source-text assertions rather than imports, for the same reason
 * routes.test.mjs uses them: these are Deno modules with remote imports
 * that Node cannot resolve.
 */
const read = (name) => readFile(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

test('the limit is spent once, before routing, and after health', async () => {
    const index = await read('index.ts');

    const healthAt = index.indexOf("path === '/v1/health'");
    const checkAt = index.indexOf('await checkRateLimit(');
    const firstRouteAt = index.indexOf("path === '/v1/admin/is-admin'");

    assert.ok(healthAt > -1 && checkAt > -1 && firstRouteAt > -1, 'expected landmarks are missing');
    // Health must not consume a token: it is how an operator distinguishes
    // "SIE is down" from "SIE is throttling me", and a limiter that can
    // hide an outage behind a 429 defeats the check entirely.
    assert.ok(healthAt < checkAt, 'the health route must be answered before the limiter runs');
    assert.ok(checkAt < firstRouteAt, 'the limiter must run before the first real route');

    // Exactly one call — a second would spend two tokens per request.
    assert.equal((index.match(/checkRateLimit\(/g) || []).length, 1);
});

test('every response carries the limit headers, not just the 429', async () => {
    const index = await read('index.ts');
    const body = index.slice(index.indexOf('const headers = {'));

    // A client can only slow down before the wall if the headers ride on
    // the successful responses too. Any handler still handed the bare
    // `cors` object would silently drop them.
    const handlerCalls = [...body.matchAll(/handle[A-Za-z]+\([^)]*\)/g)].map((m) => m[0]);
    assert.ok(handlerCalls.length >= 5, `expected the handler calls, found ${handlerCalls.length}`);
    for (const call of handlerCalls) {
        assert.ok(!/\bcors\b/.test(call), `${call} passes bare cors and loses the RateLimit headers`);
    }
    assert.match(body, /json\(tooManyRequestsBody\(rate\), 429, headers\)/);
});

test('the RateLimit headers are exposed through CORS', async () => {
    const cors = await read('_shared/cors.ts');
    // Without this, fetch() cannot read them cross-origin even though they
    // arrive — the warning UI would be permanently blind.
    assert.match(cors, /Access-Control-Expose-Headers/);
    for (const header of ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After']) {
        assert.ok(cors.includes(header), `${header} is not exposed to the browser`);
    }
});

test('a 429 sets Retry-After and a success does not', async () => {
    const mod = await read('_shared/rate-limit.ts');
    assert.match(mod, /if \(!decision\.allowed\) headers\['Retry-After'\]/);
    // Never below 1: "Retry-After: 0" tells a client to retry immediately,
    // which is exactly the behaviour the limit exists to stop.
    assert.match(mod, /Math\.max\(decision\.retryAfter, 1\)/);
});

test('a disabled limiter advertises no ceiling', async () => {
    const mod = await read('_shared/rate-limit.ts');
    assert.match(mod, /if \(!decision\.enabled\) return \{\}/);
});

test('the limiter fails open', async () => {
    const mod = await read('_shared/rate-limit.ts');
    // Three failure paths — RPC error, empty result, thrown exception —
    // and all three must allow. A rate limiter is not an authorization
    // control: every route behind it is identity-bound in the database,
    // so failing closed would turn a database blip into a full outage.
    const allowingReturns = mod.match(/return \{ allowed: true, enabled: false/g) || [];
    assert.equal(allowingReturns.length, 3, 'expected all three failure paths to allow');
    assert.doesNotMatch(mod, /return \{ allowed: false[^}]*\};\s*\n\s*\}\s*catch/);
});

test('the caller cannot choose its own bucket', async () => {
    const mod = await read('_shared/rate-limit.ts');
    const migration = await readFile(
        fileURLToPath(new URL('../../../../sie-integration/migrations/0008_add_api_rate_limiting.sql', import.meta.url)),
        'utf8'
    );
    // The only thing the function sends is a best-effort IP. Identity comes
    // from auth.uid() inside the database, so a client cannot spend someone
    // else's budget or mint a fresh bucket by claiming another id.
    assert.match(mod, /p_client_ip: clientIp\(req\)/);
    assert.ok(!/p_user_id/.test(mod), 'the function must not pass a user id — the database resolves it');
    assert.match(migration, /v_uid\s+uuid := auth\.uid\(\);/);
    assert.match(migration, /v_key := 'user:' \|\| v_uid::text;/);
});

test('the bucket is untouched while the limiter is off', async () => {
    const migration = await readFile(
        fileURLToPath(new URL('../../../../sie-integration/migrations/0008_add_api_rate_limiting.sql', import.meta.url)),
        'utf8'
    );
    const fn = migration.slice(migration.indexOf('function public.sie_rate_limit_hit'));
    const disabledBranch = fn.slice(fn.indexOf('if v_enabled is not true then'), fn.indexOf('v_capacity :='));
    // Turning the limiter off and on again must not hand out a surprise
    // full bucket in the middle of an incident.
    assert.ok(!/insert into/i.test(disabledBranch), 'the disabled branch must not write to the bucket');
    assert.match(disabledBranch, /return query select true, false/);
});

// ===================================================================
// THE ENVIRONMENT GATE
// ===================================================================
//
// These run the module instead of reading it. The limiter's whole risk
// is that it does something when nobody asked it to, and a source-text
// assertion cannot prove "no database call was made" — only executing it
// can. Node strips the one type-only import, so the module loads here.

/** Runs `fn` with SIE_RATE_LIMIT set to `value` (or unset when null). */
async function withRateLimitEnv(value, fn) {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'Deno');
    const previous = globalThis.Deno;
    globalThis.Deno = { env: { get: (k) => (k === 'SIE_RATE_LIMIT' && value !== null ? value : undefined) } };
    try {
        // Fresh module each time: the gate is read per call, but a cache-buster
        // keeps these independent of import order.
        const mod = await import(`../_shared/rate-limit.ts?env=${encodeURIComponent(String(value))}`);
        return await fn(mod);
    } finally {
        if (had) globalThis.Deno = previous;
        else delete globalThis.Deno;
    }
}

/** A Supabase client that fails the test if anything touches it. */
function forbiddenClient(t) {
    return {
        rpc: () => {
            t.diagnostic('rpc() was called while the limiter was off');
            throw new Error('the limiter called the database while switched off');
        }
    };
}

const REQUEST = new Request('https://example.test/v1/chat/reply', {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.9' }
});

test('OFF by default: with the variable unset the limiter does not run at all', async (t) => {
    await withRateLimitEnv(null, async ({ checkRateLimit, rateLimitHeaders }) => {
        let rpcCalls = 0;
        const supabase = { rpc: () => { rpcCalls += 1; return Promise.resolve({ data: null, error: null }); } };

        const decision = await checkRateLimit(supabase, REQUEST);

        // 1. no sie_rate_limit_hit call -> 2. therefore no bucket row can be
        // created or updated, since that RPC is the only writer.
        assert.equal(rpcCalls, 0, 'a switched-off limiter must not reach the database');
        // 3. no rejection
        assert.equal(decision.allowed, true);
        assert.equal(decision.enabled, false);
        // 4. no RateLimit-* headers
        assert.deepEqual(rateLimitHeaders(decision), {});
    });
});

test('OFF by default: every ambiguous value means off', async () => {
    for (const value of [null, '', '   ', 'off', 'false', '0', 'no', 'disabled', 'ON_MAYBE', 'yes please']) {
        await withRateLimitEnv(value, async ({ checkRateLimit, rateLimitHeaders }) => {
            const decision = await checkRateLimit(forbiddenClient({ diagnostic() {} }), REQUEST);
            assert.equal(decision.enabled, false, `"${value}" must not switch the limiter on`);
            assert.equal(decision.allowed, true);
            assert.deepEqual(rateLimitHeaders(decision), {});
        });
    }
});

test('ON when asked explicitly: the limiter runs exactly as before', async () => {
    for (const value of ['on', 'true', '1', 'yes', 'enabled', 'ON', ' True ']) {
        await withRateLimitEnv(value, async ({ checkRateLimit, rateLimitHeaders }) => {
            let seenArgs = null;
            const supabase = {
                rpc: (name, args) => {
                    seenArgs = { name, args };
                    return Promise.resolve({
                        data: [{ allowed: true, enabled: true, limit_per_min: 100, remaining: 97, reset_seconds: 12, retry_after: 0 }],
                        error: null
                    });
                }
            };

            const decision = await checkRateLimit(supabase, REQUEST);

            assert.equal(seenArgs?.name, 'sie_rate_limit_hit', `"${value}" should switch the limiter on`);
            assert.equal(seenArgs?.args?.p_client_ip, '203.0.113.9');
            assert.equal(decision.enabled, true);
            assert.equal(decision.limit, 100);
            assert.equal(decision.remaining, 97);
            assert.deepEqual(rateLimitHeaders(decision), {
                'RateLimit-Limit': '100',
                'RateLimit-Remaining': '97',
                'RateLimit-Reset': '12',
                'X-RateLimit-Limit': '100',
                'X-RateLimit-Remaining': '97',
                'X-RateLimit-Reset': '12'
            });
        });
    }
});

test('ON when asked explicitly: a rejected caller still gets a 429 decision and Retry-After', async () => {
    await withRateLimitEnv('on', async ({ checkRateLimit, rateLimitHeaders }) => {
        const supabase = {
            rpc: () => Promise.resolve({
                data: [{ allowed: false, enabled: true, limit_per_min: 100, remaining: 0, reset_seconds: 30, retry_after: 5 }],
                error: null
            })
        };
        const decision = await checkRateLimit(supabase, REQUEST);
        assert.equal(decision.allowed, false);
        assert.equal(rateLimitHeaders(decision)['Retry-After'], '5');
    });
});

test('ON when asked explicitly: the fail-open posture is unchanged', async () => {
    await withRateLimitEnv('on', async ({ checkRateLimit }) => {
        const erroring = { rpc: () => Promise.resolve({ data: null, error: { message: 'boom' } }) };
        const throwing = { rpc: () => { throw new Error('connection reset'); } };
        const empty = { rpc: () => Promise.resolve({ data: [], error: null }) };
        for (const client of [erroring, throwing, empty]) {
            const decision = await checkRateLimit(client, REQUEST);
            assert.equal(decision.allowed, true, 'a limiter failure must never block a request');
            assert.equal(decision.enabled, false);
        }
    });
});
