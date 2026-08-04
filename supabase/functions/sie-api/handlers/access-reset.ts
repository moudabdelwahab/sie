/**
 * handlers/access-reset.ts
 * ------------------------------------------------------------
 * POST /v1/access/reset   (and /v1/admin/access/reset-usage)
 * Body: { userId }
 *
 * Wraps sie_admin_reset_usage(p_user_id) — same posture as
 * access-set.ts: the RPC checks is_sie_admin() itself and raises its own
 * exception text, which this handler only translates into a status.
 *
 * Response (200): { success: true }
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { json } from '../_shared/http.ts';

export async function handleAccessReset(supabase: SupabaseClient, req: Request, cors: HeadersInit): Promise<Response> {
    let body: { userId?: string };
    try {
        body = await req.json();
    } catch {
        return json({ error: 'invalid_json' }, 400, cors);
    }

    if (!body.userId) {
        return json({ error: 'missing_required_fields', required: ['userId'] }, 400, cors);
    }

    const { error } = await supabase.rpc('sie_admin_reset_usage', { p_user_id: body.userId });

    if (error) {
        const message = error.message || '';
        if (message.includes('access denied')) return json({ error: 'forbidden', message }, 403, cors);
        if (message.includes('no sie access row found')) return json({ error: 'not_found', message }, 404, cors);
        console.error('[sie-api] sie_admin_reset_usage failed:', message);
        return json({ error: 'internal_error' }, 500, cors);
    }

    return json({ success: true }, 200, cors);
}
