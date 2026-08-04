/**
 * handlers/is-admin.ts
 * ------------------------------------------------------------
 * GET /v1/admin/is-admin
 *
 * Wraps is_sie_admin() — verified live (SECURITY DEFINER, checks
 * auth.users.email against the one admin address). Never re-implemented
 * or hardcoded here: the database stays the single source of truth for
 * who counts as an admin.
 *
 * Response (200): { isAdmin: boolean }
 * A missing/invalid JWT never reaches this handler — verify_jwt is on,
 * so the platform rejected it with 401 before our code ran.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { json } from '../_shared/http.ts';

export async function handleIsAdmin(supabase: SupabaseClient, cors: HeadersInit): Promise<Response> {
    const { data, error } = await supabase.rpc('is_sie_admin');
    if (error) {
        console.error('[sie-api] is_sie_admin failed:', error.message);
        return json({ error: 'internal_error' }, 500, cors);
    }
    return json({ isAdmin: data === true }, 200, cors);
}
