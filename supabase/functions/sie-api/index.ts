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
import { handleIsAdmin } from './handlers/is-admin.ts';
import { handleAccessStatus } from './handlers/access-status.ts';
import { handleAccessSet } from './handlers/access-set.ts';
import { handleAccessReset } from './handlers/access-reset.ts';
import { handleChatReply } from './handlers/chat-reply.ts';

const MOUNT_PREFIXES = ['/functions/v1/sie-api', '/sie-api'];

/**
 * Reduces whatever the caller sent to a bare "/v1/..." route.
 *
 * The `/api` strip is separate and runs after, because it can appear
 * with or without a Supabase mount prefix depending on whether the call
 * arrives direct or through a rewrite at sie.mad3oom.com.
 */
function normalizePath(pathname: string): string {
    let path = pathname;
    for (const prefix of MOUNT_PREFIXES) {
        if (path.startsWith(prefix)) {
            path = path.slice(prefix.length) || '/';
            break;
        }
    }
    if (path === '/api') return '/';
    if (path.startsWith('/api/')) path = path.slice('/api'.length);
    return path || '/';
}

/** `/v1/access/<uuid>` — the client's shape for reading one customer's row. */
const ACCESS_BY_ID = /^\/v1\/access\/([^/]+)$/;

/** Sub-paths of /v1/access that name an action, so can never be a user id. */
const ACCESS_RESERVED = new Set(['status', 'set', 'reset']);

Deno.serve(async (req: Request) => {
    const origin = req.headers.get('origin');
    const cors = corsHeaders(origin);

    // OPTIONS before anything else — before auth, before routing.
    const preflight = handleOptions(req);
    if (preflight) return preflight;

    const url = new URL(req.url);
    const path = normalizePath(url.pathname);

    // Reachability, answered before the client is built. A health check
    // that needs a valid session cannot tell "SIE is down" from "my token
    // expired", which is the one thing it exists to distinguish.
    if ((path === '/v1/health' || path === '/health') && req.method === 'GET') {
        return json({ status: 'ok', service: 'sie-api', version: 'v1' }, 200, cors);
    }

    try {
        // verify_jwt=true means a request only reaches here with a
        // platform-validated Authorization header already present.
        const supabase = buildUserClient(req);

        if (path === '/v1/admin/is-admin' && req.method === 'GET') {
            return await handleIsAdmin(supabase, cors);
        }

        if (path === '/v1/access/status' && req.method === 'GET') {
            return await handleAccessStatus(supabase, url.searchParams.get('userId'), cors);
        }
        // The client's shape. Listed after /status so the literal word
        // "status" can never be read as a user id.
        const byId = path.match(ACCESS_BY_ID);
        if (byId && !ACCESS_RESERVED.has(byId[1]) && req.method === 'GET') {
            return await handleAccessStatus(supabase, decodeURIComponent(byId[1]), cors);
        }

        if ((path === '/v1/access/set' || path === '/v1/admin/access') && req.method === 'POST') {
            return await handleAccessSet(supabase, req, cors);
        }

        if ((path === '/v1/access/reset' || path === '/v1/admin/access/reset-usage') && req.method === 'POST') {
            return await handleAccessReset(supabase, req, cors);
        }

        if (path === '/v1/chat/reply' && req.method === 'POST') {
            return await handleChatReply(supabase, req, cors);
        }

        return json({ error: 'not_found', path }, 404, cors);
    } catch (err) {
        console.error('[sie-api] unhandled error:', err instanceof Error ? err.message : err);
        return json({ error: 'internal_error' }, 500, cors);
    }
});
