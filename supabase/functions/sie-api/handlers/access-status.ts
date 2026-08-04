/**
 * handlers/access-status.ts
 * ------------------------------------------------------------
 * GET /v1/access/status?userId=<uuid>   (and /v1/access/<uuid>)
 *
 * Reads customer_sie_access directly — no RPC needed, because the live
 * RLS policy already reads "self, or is_sie_admin()". Defaults to the
 * caller's own row when no id is given, so "am I enabled?" needs no
 * parameter.
 *
 * Response (200): { access: {...} | null }
 *
 * Deliberately does not distinguish "row exists but RLS hid it" from
 * "row genuinely does not exist" — both come back as access: null, so
 * this endpoint never confirms another user's existence to a non-admin.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { json } from '../_shared/http.ts';

export async function handleAccessStatus(
    supabase: SupabaseClient,
    requestedUserId: string | null,
    cors: HeadersInit
): Promise<Response> {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
        return json({ error: 'unauthorized' }, 401, cors);
    }

    const targetUserId = requestedUserId || userData.user.id;

    const { data, error } = await supabase
        .from('customer_sie_access')
        .select('*')
        .eq('user_id', targetUserId)
        .maybeSingle();

    if (error) {
        console.error('[sie-api] customer_sie_access read failed:', error.message);
        return json({ error: 'internal_error' }, 500, cors);
    }

    return json({ access: data ?? null }, 200, cors);
}
