/**
 * handlers/access-set.ts
 * ------------------------------------------------------------
 * POST /v1/access/set   (and /v1/admin/access)
 * Body: { userId, isEnabled, accessMode, messageQuota?, expiresAt?, notes? }
 *
 * Wraps sie_admin_set_access(...). Verified live: the RPC checks
 * is_sie_admin() itself and raises 'access denied: sie admin privileges
 * required' for anyone else. This handler does NOT re-implement that
 * check — it only translates the RPC's own exception text into an HTTP
 * status, so the authorization decision stays in one place.
 *
 * Response (200): { success: true }
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { json } from '../_shared/http.ts';

interface SetAccessBody {
    userId?: string;
    isEnabled?: boolean;
    accessMode?: 'unlimited' | 'quota' | 'expiration';
    messageQuota?: number | null;
    expiresAt?: string | null;
    notes?: string | null;
}

export async function handleAccessSet(supabase: SupabaseClient, req: Request, cors: HeadersInit): Promise<Response> {
    let body: SetAccessBody;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'invalid_json' }, 400, cors);
    }

    if (!body.userId || typeof body.isEnabled !== 'boolean' || !body.accessMode) {
        return json({ error: 'missing_required_fields', required: ['userId', 'isEnabled', 'accessMode'] }, 400, cors);
    }

    const { error } = await supabase.rpc('sie_admin_set_access', {
        p_user_id: body.userId,
        p_is_enabled: body.isEnabled,
        p_access_mode: body.accessMode,
        p_message_quota: body.messageQuota ?? null,
        p_expires_at: body.expiresAt ?? null,
        p_notes: body.notes ?? null
    });

    if (error) {
        const message = error.message || '';
        if (message.includes('access denied')) return json({ error: 'forbidden', message }, 403, cors);
        if (
            message.includes('invalid access_mode') ||
            message.includes('must be a positive integer') ||
            message.includes('is required when') ||
            message.includes('no profile found')
        ) {
            return json({ error: 'invalid_request', message }, 400, cors);
        }
        console.error('[sie-api] sie_admin_set_access failed:', message);
        return json({ error: 'internal_error' }, 500, cors);
    }

    return json({ success: true }, 200, cors);
}
