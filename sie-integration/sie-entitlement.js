/**
 * sie-entitlement.js  —  INTERNAL TO SIE
 * ------------------------------------------------------------
 * ⚠️ Not a public surface. Mad3oom must import sie-runtime.js instead;
 * everything here is re-exposed there under a stable contract. Reaching
 * past the runtime to this file couples Mad3oom to an implementation
 * detail that is free to change.
 *
 * The one place that answers "is this customer allowed to use SIE right
 * now?" — in both readings:
 *
 *   - evaluateSieAccessRow()  — read-only interpretation, spends nothing.
 *     Used to decide whether to OFFER SIE (mode picker, admin display).
 *   - tryConsumeSieMessage()  — the enforcing read, spends one message.
 *     Used to decide whether to ACTUALLY ANSWER a turn.
 *
 * The two sit side by side on purpose: they encode the same three rules
 * (enabled / not expired / quota remaining), so keeping them in one file
 * is what stops the UI's explanation and the engine's enforcement from
 * drifting apart. The authoritative version is the database one —
 * evaluateSieAccessRow mirrors `sie_consume_message()`'s branch order
 * exactly, including which condition is reported when more than one
 * would fail.
 *
 * Authorization for the admin-only calls is NOT re-checked in JavaScript.
 * It lives entirely inside `is_sie_admin()` within the RPCs (and in RLS
 * on direct reads). This file never hardcodes the admin address;
 * `isCurrentUserSieAdmin()` asks the database, which is the one place
 * that check is defined.
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<boolean>}
 */
export async function isCurrentUserSieAdmin(supabase) {
    try {
        const { data, error } = await supabase.rpc('is_sie_admin');
        if (error) {
            console.warn('[sie] is_sie_admin() RPC failed:', error.message);
            return false;
        }
        return data === true;
    } catch (err) {
        console.warn('[sie] is_sie_admin() RPC threw:', err?.message || err);
        return false;
    }
}

/**
 * Attempts to consume one SIE turn for a customer. This is the ONLY
 * place usage is incremented — atomically on the database side (the row
 * is locked with FOR UPDATE, checked, and incremented in one statement),
 * so concurrent tabs or rapid-fire messages cannot double-spend the same
 * quota unit.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<{allowed: boolean, reason: string|null, remaining: number|null}>}
 */
export async function tryConsumeSieMessage(supabase, userId) {
    if (!userId) return { allowed: false, reason: 'no_user', remaining: null };
    try {
        const { data, error } = await supabase.rpc('sie_consume_message', { p_user_id: userId });
        if (error) {
            console.warn('[sie] sie_consume_message() RPC failed:', error.message);
            return { allowed: false, reason: 'rpc_error', remaining: null };
        }
        const row = Array.isArray(data) ? data[0] : data;
        return {
            allowed: row?.allowed === true,
            reason: row?.reason ?? null,
            remaining: row?.remaining ?? null
        };
    } catch (err) {
        console.warn('[sie] sie_consume_message() RPC threw:', err?.message || err);
        return { allowed: false, reason: 'rpc_exception', remaining: null };
    }
}

/**
 * Read-only status for display. Relies on the SELECT RLS policy (admin
 * sees any row, customer sees only their own) rather than a bespoke RPC.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
export async function getSieAccessStatus(supabase, userId) {
    if (!userId) return null;
    try {
        const { data, error } = await supabase
            .from('customer_sie_access')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();
        if (error) {
            console.warn('[sie] customer_sie_access read failed:', error.message);
            return null;
        }
        return data;
    } catch (err) {
        console.warn('[sie] customer_sie_access read threw:', err?.message || err);
        return null;
    }
}

/**
 * Interprets a raw `customer_sie_access` row into "can they use SIE
 * right now, and if not, why".
 *
 * Branch order mirrors `sie_consume_message()` exactly — disabled before
 * expired before quota — so when two conditions would both fail, the UI
 * names the same one the engine would.
 *
 * `statusLabel` keeps the exact Arabic strings Mad3oom's chat widget
 * already switches on when it explains a mid-conversation revocation to
 * the customer; changing them would silently break that message.
 *
 * @param {Object|null} row
 * @returns {{
 *   available: boolean,
 *   reason: 'no_access_row'|'disabled'|'expired'|'quota_exceeded'|null,
 *   statusLabel: string|null,
 *   remaining: number|null,
 *   row: Object|null
 * }}
 */
export function evaluateSieAccessRow(row) {
    if (!row) {
        return { available: false, reason: 'no_access_row', statusLabel: 'غير مفعّل', remaining: null, row: null };
    }

    if (!row.is_enabled) {
        return { available: false, reason: 'disabled', statusLabel: 'غير مفعّل', remaining: null, row };
    }

    if (row.access_mode === 'expiration' && row.expires_at) {
        if (new Date(row.expires_at).getTime() <= Date.now()) {
            return { available: false, reason: 'expired', statusLabel: 'انتهت الصلاحية', remaining: null, row };
        }
    }

    if (row.access_mode === 'quota') {
        const used = row.messages_used ?? 0;
        const quota = row.message_quota ?? 0;
        if (quota > 0 && used >= quota) {
            return { available: false, reason: 'quota_exceeded', statusLabel: 'انتهت الكوتة', remaining: 0, row };
        }
        return { available: true, reason: null, statusLabel: 'مفعّل', remaining: Math.max(quota - used, 0), row };
    }

    return { available: true, reason: null, statusLabel: 'مفعّل', remaining: null, row };
}

/**
 * Admin-only: create/update a customer's SIE access. Authorization is
 * enforced inside sie_admin_set_access() via is_sie_admin() — this call
 * simply fails with an authorization error for anyone else, exactly as
 * the profiles-table admin actions already behave elsewhere.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{userId: string, isEnabled: boolean, accessMode: 'unlimited'|'quota'|'expiration', messageQuota?: number|null, expiresAt?: string|null, notes?: string|null}} params
 * @returns {Promise<{error: Error|null}>}
 */
export async function adminSetAccess(supabase, { userId, isEnabled, accessMode, messageQuota, expiresAt, notes }) {
    if (!userId) return { error: new Error('userId is required') };
    try {
        const { error } = await supabase.rpc('sie_admin_set_access', {
            p_user_id: userId,
            p_is_enabled: isEnabled,
            p_access_mode: accessMode,
            p_message_quota: messageQuota ?? null,
            p_expires_at: expiresAt ?? null,
            p_notes: notes ?? null
        });
        return { error: error ? new Error(error.message) : null };
    } catch (err) {
        return { error: err instanceof Error ? err : new Error(String(err)) };
    }
}

/**
 * Admin-only: zero out messages_used for a customer (e.g. a new billing
 * period). Authorization is enforced inside sie_admin_reset_usage().
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<{error: Error|null}>}
 */
export async function adminResetUsage(supabase, userId) {
    if (!userId) return { error: new Error('userId is required') };
    try {
        const { error } = await supabase.rpc('sie_admin_reset_usage', { p_user_id: userId });
        return { error: error ? new Error(error.message) : null };
    } catch (err) {
        return { error: err instanceof Error ? err : new Error(String(err)) };
    }
}
