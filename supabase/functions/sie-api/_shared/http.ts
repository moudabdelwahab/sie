/**
 * http.ts
 * ------------------------------------------------------------
 * One place that shapes every response as JSON with the right
 * Content-Type and the CORS headers already computed for this request,
 * so no handler can return one that is missing them.
 */
export function json(body: unknown, status: number, cors: HeadersInit): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' }
    });
}
