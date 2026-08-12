/**
 * cors.ts
 * ------------------------------------------------------------
 * Preflight handling, in one place so no handler can forget it.
 *
 * Per Supabase's documented pattern, OPTIONS must be answered BEFORE
 * anything else in the request lifecycle, auth included — see index.ts,
 * where handleOptions() runs ahead of building the JWT-scoped client.
 */

const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS = 'authorization, apikey, x-client-info, content-type';

/**
 * A cross-origin response only lets JavaScript read a short safelist of
 * headers unless the server names the others here. The RateLimit-* set is
 * therefore not readable by fetch() without this line, even though it
 * arrives on the wire — the chat client would warn about nothing and the
 * headers would look like they were never sent.
 */
const EXPOSED_HEADERS = [
    'RateLimit-Limit',
    'RateLimit-Remaining',
    'RateLimit-Reset',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'Retry-After'
].join(', ');

export function corsHeaders(origin: string | null): HeadersInit {
    return {
        'Access-Control-Allow-Origin': origin ?? '*',
        'Access-Control-Allow-Methods': ALLOWED_METHODS,
        'Access-Control-Allow-Headers': ALLOWED_HEADERS,
        'Access-Control-Expose-Headers': EXPOSED_HEADERS,
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin'
    };
}

/** A 204 for an OPTIONS preflight, or null for any other method. */
export function handleOptions(req: Request): Response | null {
    if (req.method !== 'OPTIONS') return null;
    return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}
