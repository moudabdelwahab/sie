/**
 * rate-limit.ts
 * ------------------------------------------------------------
 * حد معدل الطلبات — القرار بيتاخد في قاعدة البيانات، مش هنا.
 *
 * This module deliberately holds NO state. Every decision is one call to
 * sie_rate_limit_hit(), which spends a token atomically in Postgres. The
 * reason is the deployment model, not purity: Supabase runs an arbitrary
 * number of instances of this function and recycles them without notice,
 * so a counter in module scope would be N independent limits that reset
 * at random — loosening precisely when traffic (and therefore instance
 * count) rises.
 *
 * ------------------------------------------------------------
 * FAIL OPEN, AND WHY
 *
 * If the RPC itself fails — database blip, timeout — the request is
 * ALLOWED. A rate limiter is a protection against excess, not an
 * authorization control; nothing behind it depends on it for safety,
 * because every route is already identity-bound in the database. Failing
 * closed would convert a transient database problem into a total outage
 * for every customer, which is a strictly worse failure than briefly not
 * enforcing a ceiling. The failure is logged so it is visible.
 *
 * ------------------------------------------------------------
 * HEADERS
 *
 * Follows the IETF draft naming (RateLimit-Limit / -Remaining / -Reset)
 * plus Retry-After on a 429, which is the one every HTTP client already
 * understands.
 *
 * These are useless unless the browser is allowed to READ them: a
 * cross-origin response only exposes a handful of headers to JavaScript
 * by default, so anything not listed in Access-Control-Expose-Headers is
 * invisible to fetch() even though it arrived. Mad3oom's chat client
 * reads RateLimit-Remaining to warn before the wall, so the expose list
 * in cors.ts is load-bearing, not decorative.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export interface RateLimitDecision {
    allowed: boolean;
    enabled: boolean;
    limit: number;
    remaining: number;
    resetSeconds: number;
    retryAfter: number;
}

/** Best-effort client IP, used only to bucket callers with no identity. */
function clientIp(req: Request): string | null {
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip');
}

/**
 * Spends one token for this caller. The identity is resolved inside the
 * database from auth.uid() — the IP is only consulted for callers who
 * have none, and is never allowed to override a real identity.
 */
export async function checkRateLimit(
    supabase: SupabaseClient,
    req: Request
): Promise<RateLimitDecision> {
    try {
        const { data, error } = await supabase.rpc('sie_rate_limit_hit', {
            p_client_ip: clientIp(req)
        });
        if (error) {
            console.error('[sie-api] rate limit RPC failed, allowing:', error.message);
            return { allowed: true, enabled: false, limit: 0, remaining: 0, resetSeconds: 0, retryAfter: 0 };
        }
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) {
            console.error('[sie-api] rate limit RPC returned no row, allowing');
            return { allowed: true, enabled: false, limit: 0, remaining: 0, resetSeconds: 0, retryAfter: 0 };
        }
        return {
            allowed: row.allowed === true,
            enabled: row.enabled === true,
            limit: Number(row.limit_per_min ?? 0),
            remaining: Number(row.remaining ?? 0),
            resetSeconds: Number(row.reset_seconds ?? 0),
            retryAfter: Number(row.retry_after ?? 0)
        };
    } catch (err) {
        console.error('[sie-api] rate limit threw, allowing:', err instanceof Error ? err.message : err);
        return { allowed: true, enabled: false, limit: 0, remaining: 0, resetSeconds: 0, retryAfter: 0 };
    }
}

/**
 * The RateLimit-* headers for a decision. Returns nothing when the
 * limiter is off, so a disabled limiter does not advertise a ceiling
 * that is not being enforced.
 */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
    if (!decision.enabled) return {};
    const headers: Record<string, string> = {
        'RateLimit-Limit': String(decision.limit),
        'RateLimit-Remaining': String(decision.remaining),
        'RateLimit-Reset': String(decision.resetSeconds),
        // The pre-draft spelling, still what most SDKs and dashboards read.
        'X-RateLimit-Limit': String(decision.limit),
        'X-RateLimit-Remaining': String(decision.remaining),
        'X-RateLimit-Reset': String(decision.resetSeconds)
    };
    if (!decision.allowed) headers['Retry-After'] = String(Math.max(decision.retryAfter, 1));
    return headers;
}

/**
 * The 429 body. Arabic first because every customer-facing surface on
 * this platform is Arabic, with a machine-readable `error` for clients.
 */
export function tooManyRequestsBody(decision: RateLimitDecision) {
    return {
        error: 'rate_limited',
        message: `وصلت للحد المسموح من الطلبات (${decision.limit} في الدقيقة). استنى ${Math.max(decision.retryAfter, 1)} ثانية وجرّب تاني.`,
        messageEn: `Rate limit reached (${decision.limit} requests per minute). Retry in ${Math.max(decision.retryAfter, 1)}s.`,
        limit: decision.limit,
        remaining: 0,
        retryAfter: Math.max(decision.retryAfter, 1)
    };
}
