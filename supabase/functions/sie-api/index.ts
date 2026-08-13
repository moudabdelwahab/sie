/**
 * index.ts — sie-api Edge Function
 * ------------------------------------------------------------
 * الحد الوحيد بين منصة مدعوم وبين SIE. مدعوم مابيستوردش كود SIE — ده
 * قرار معماري مكتوب عندهم في assets/js/sie-client.js — فكل حاجة بتعدي
 * من هنا.
 *
 * One Edge Function rather than several, so every route lives under the
 * same /v1/* namespace and a future v2 is one new branch here.
 *
 * ------------------------------------------------------------
 * MOUNT PREFIXES, AND THE BUG THEY HID
 *
 * Supabase always serves this at
 *   https://<ref>.supabase.co/functions/v1/sie-api/<path>
 * That "/functions/v1/" is Supabase's own routing prefix, unrelated to
 * our "/v1/" API version and not removable from inside the function.
 *
 * Mad3oom's client calls paths that literally begin "/api/v1/...", and
 * the original stripMountPrefix() only knew about the two Supabase
 * shapes. So `/api/v1/admin/is-admin` matched no route and returned 404
 * — for EVERY endpoint, not just the unimplemented one. The route table
 * and the client had never agreed.
 *
 * Both are accepted now, and the four routes whose shapes differed carry
 * an alias each, so nothing that already works can break.
 */
import { corsHeaders, handleOptions } from './_shared/cors.ts';
import { json } from './_shared/http.ts';
import { buildUserClient } from './_shared/supabase-client.ts';
import { publicApi, isPublicApiRequest, servePublicDoc } from './_shared/public-api.ts';
import { checkRateLimit, rateLimitHeaders, tooManyRequestsBody } from './_shared/rate-limit.ts';
import { handleIsAdmin } from './handlers/is-admin.ts';
import { handleAccessStatus } from './handlers/access-status.ts';
import { handleAccessSet } from './handlers/access-set.ts';
import { handleAccessReset } from './handlers/access-reset.ts';
import { handleChatReply } from './handlers/chat-reply.ts';
import { listActiveScenarios } from './_shared/engine.ts';

const MOUNT_PREFIXES = ['/functions/v1/sie-api', '/sie-api'];

/**
 * Reduces whatever the caller sent to a bare "/v1/..." route.
 *
 * The `/api` strip is separate and runs after, because it can appear
 * with or without a Supabase mount prefix depending on whether the call
 * arrives direct or through a rewrite at sie.mad3oom.com.
 */
function normalizePath(pathname: string): string {
    let path = stripMount(pathname);
    if (path === '/api') return '/';
    if (path.startsWith('/api/')) path = path.slice('/api'.length);
    return path || '/';
}

/**
 * بادئة Supabase بس، من غير ما نلمس `/api`.
 *
 * الـAPI العام محتاج يشوف `/api/v1/...` كامل عشان يفرّق بين مساراته هو
 * ومسارات المنصة القديمة اللي بتتنده بنفس البادئة (`/api/v1/chat/reply`).
 * normalizePath فوق بتشيل `/api` عشان الجدول القديم مكتوب من غيرها.
 */
function stripMount(pathname: string): string {
    for (const prefix of MOUNT_PREFIXES) {
        if (pathname.startsWith(prefix)) return pathname.slice(prefix.length) || '/';
    }
    return pathname || '/';
}

/** `/v1/access/<uuid>` — the client's shape for reading one customer's row. */
const ACCESS_BY_ID = /^\/v1\/access\/([^/]+)$/;

/** Sub-paths of /v1/access that name an action, so can never be a user id. */
const ACCESS_RESERVED = new Set(['status', 'set', 'reset']);

Deno.serve(async (req: Request) => {
    const origin = req.headers.get('origin');
    const cors = corsHeaders(origin);
    const url = new URL(req.url);

    // ------------------------------------------------------------
    // الـAPI العام — أول حاجة، وقبل أي حاجة تانية.
    //
    // قبل preflight القديم: الـCORS بتاعه بيسمح لأي أصل، والـAPI العام
    // سياسته أضيق (قائمة صريحة، ومن غير اعتمادات). لو الـpreflight
    // القديم رد الأول، المتصفح كان هياخد سياسة مش بتاعة المسار ده.
    //
    // وقبل حد المعدل القديم: ده بيصرف تذكرة بدلو الـIP للنداء اللي
    // مالوش توكن — يعني كل نداء API كان هيتحاسب مرتين، مرة على IP
    // مشترك مع عملاء تانيين ومرة على حساب صاحب المفتاح.
    //
    // الشرط ضيق (isPublicApiRequest): مسارات المنصة القديمة زي
    // /api/v1/chat/reply مش من ضمنه، فمسارها مااتغيرش ولا حرف.
    const mountPath = stripMount(url.pathname);
    if (isPublicApiRequest(mountPath)) {
        if (req.method === 'GET') {
            const document = servePublicDoc(mountPath);
            if (document) return document;
        }
        return await publicApi.handle(req);
    }

    // OPTIONS before anything else — before auth, before routing.
    const preflight = handleOptions(req);
    if (preflight) return preflight;

    const path = normalizePath(url.pathname);

    // ------------------------------------------------------------
    // WHY THIS FUNCTION IS verify_jwt = false
    //
    // Answered before the client is built, and deliberately reachable
    // without a token — `checkSieHealth()` in sie-client.js sends none,
    // and a check that needs a valid session cannot tell "SIE is down"
    // from "my token expired", which is the one thing it exists to say.
    // With the gateway gate on, this route answered 401 and the check
    // would trip its own circuit breaker.
    //
    // Dropping the gateway gate is safe HERE because every other route
    // is identity-bound in the database, not by this function — verified
    // against the live catalog, not assumed:
    //
    //   is_sie_admin, sie_admin_set_access, sie_admin_reset_usage and
    //   sie_consume_message are all SECURITY DEFINER and all resolve the
    //   caller from auth.uid(). With no token, auth.uid() is NULL:
    //   is_sie_admin() returns false, the two admin RPCs raise "access
    //   denied", and the two customer routes fail on auth.getUser().
    //
    // Confirmed live on the deployed function: an unauthenticated
    // /v1/chat/reply returns 401 and /v1/admin/is-admin returns
    // {isAdmin:false}. Nothing leaks. Adding a route that reads data
    // WITHOUT an identity check would break that reasoning — don't.
    //
    // The engine is loaded here too, because "the function is up" and
    // "the engine's 580 KB of data resolved from the CDN" are different
    // questions and only the second one has ever failed.
    if ((path === '/v1/health' || path === '/health') && req.method === 'GET') {
        let engine: Record<string, unknown>;
        try {
            const scenarios = await listActiveScenarios();
            engine = { loaded: true, catalogSize: scenarios.length };
        } catch (err) {
            engine = { loaded: false, error: err instanceof Error ? err.message : String(err) };
        }
        return json({ status: 'ok', service: 'sie-api', version: 'v1', engine }, 200, cors);
    }

    try {
        // Scoped to the caller's own token. An unauthenticated request
        // reaches here (see the note above), and every route below either
        // checks the identity itself or calls an RPC that does.
        const supabase = buildUserClient(req);

        // ------------------------------------------------------------
        // RATE LIMIT — after health, before every real route.
        //
        // After health on purpose: the health check is what tells an
        // operator whether SIE is up, and a limiter that can hide an
        // outage behind a 429 is worse than no limiter. It also costs
        // nothing to serve.
        //
        // Before routing, so one token is spent per request rather than
        // per handler, and so a route added later cannot forget to
        // participate. The decision's headers ride on EVERY response
        // below, not just the 429, because a client can only slow down
        // ahead of the wall if it is told how close it is.
        const rate = await checkRateLimit(supabase, req);
        const limitHeaders = rateLimitHeaders(rate);
        const headers = { ...cors, ...limitHeaders };

        if (!rate.allowed) {
            return json(tooManyRequestsBody(rate), 429, headers);
        }

        if (path === '/v1/admin/is-admin' && req.method === 'GET') {
            return await handleIsAdmin(supabase, headers);
        }

        if (path === '/v1/access/status' && req.method === 'GET') {
            return await handleAccessStatus(supabase, url.searchParams.get('userId'), headers);
        }
        // The client's shape. Listed after /status so the literal word
        // "status" can never be read as a user id.
        const byId = path.match(ACCESS_BY_ID);
        if (byId && !ACCESS_RESERVED.has(byId[1]) && req.method === 'GET') {
            return await handleAccessStatus(supabase, decodeURIComponent(byId[1]), headers);
        }

        if ((path === '/v1/access/set' || path === '/v1/admin/access') && req.method === 'POST') {
            return await handleAccessSet(supabase, req, headers);
        }

        if ((path === '/v1/access/reset' || path === '/v1/admin/access/reset-usage') && req.method === 'POST') {
            return await handleAccessReset(supabase, req, headers);
        }

        if (path === '/v1/chat/reply' && req.method === 'POST') {
            return await handleChatReply(supabase, req, headers);
        }

        return json({ error: 'not_found', path }, 404, headers);
    } catch (err) {
        console.error('[sie-api] unhandled error:', err instanceof Error ? err.message : err);
        return json({ error: 'internal_error' }, 500, cors);
    }
});
