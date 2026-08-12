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
