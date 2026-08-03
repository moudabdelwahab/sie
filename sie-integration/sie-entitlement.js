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
 * Also home to isCurrentUserEngineStaff() / isCurrentUserSieAdmin() — the
 * two authorization checks used by sie-admin (login, settings console,
 * Review Center). Both are answered by the database (is_chat_engine_
 * staff() / is_sie_admin()), never by inspecting a role or email in
 * JavaScript. This file never hardcodes the admin address or the staff
 * role list; the RPCs are the one place either check is defined.
 */
import {
    SIE_DEFAULT_SETTINGS as SIE_DEFAULTS,
    mergeStoredSettings,
    validateSetting
} from '../sie/config/settings-schema.js';

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
 * Is the current session allowed to read/edit the Scenario & Knowledge
 * catalog (Review Center, Validation Lab, settings console)? Answered
 * by is_chat_engine_staff() — a broader group than isCurrentUserSieAdmin
 * (any 'admin'/'support'/'super_user' profile), since catalog editing is
 * a team role while SIE entitlement is a single accountable address.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<boolean>}
 */
export async function isCurrentUserEngineStaff(supabase) {
    try {
        const { data, error } = await supabase.rpc('is_chat_engine_staff');
        if (error) {
            console.warn('[sie] is_chat_engine_staff() RPC failed:', error.message);
            return false;
        }
        return data === true;
    } catch (err) {
        console.warn('[sie] is_chat_engine_staff() RPC threw:', err?.message || err);
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

// ===================================================================
// Engine settings
// ===================================================================

/**
 * The defaults and the schema both live in sie/config/settings-schema.js so
 * the console and the engine cannot describe a switch differently. This file
 * only handles reading and writing them.
 */
export { SIE_DEFAULT_SETTINGS } from '../sie/config/settings-schema.js';

let settingsCache = null;
let settingsCachedAt = 0;

/**
 * How long a cached settings read stays good.
 *
 * A page load is short-lived, so caching for the life of the module was
 * fine when the browser was the only caller. A channel webhook is not: an
 * Edge Function instance stays warm for hours, and an operator who
 * switched the engine off would have gone on answering Telegram customers
 * until it recycled — with no way to tell how long that would take.
 *
 * A minute bounds that staleness without putting a round trip on every
 * customer message. saveSieSetting() still clears the cache outright, so
 * the admin's own tab is immediate as before.
 */
export const SETTINGS_CACHE_TTL_MS = 60 * 1000;

/**
 * Current settings, merged over the defaults.
 *
 * Cached because these are read on every customer turn and a round trip
 * per message would add latency to every reply for values that change
 * perhaps monthly — but only for SETTINGS_CACHE_TTL_MS, so a change
 * reaches every caller within a minute whether or not it restarts.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{fresh?: boolean}} [options] - fresh:true bypasses the cache
 * @returns {Promise<Object>}
 */
export async function getSieSettings(supabase, { fresh = false } = {}) {
    const expired = Date.now() - settingsCachedAt > SETTINGS_CACHE_TTL_MS;
    if (settingsCache && !fresh && !expired) return settingsCache;
    try {
        const { data, error } = await supabase.from('sie_settings').select('key, value');
        if (error) {
            console.warn('[sie] sie_settings read failed, using defaults:', error.message);
            return { ...SIE_DEFAULTS };
        }
        settingsCache = mergeStoredSettings(data || []);
        settingsCachedAt = Date.now();
        return settingsCache;
    } catch (err) {
        // Defaults rather than a throw: a settings outage must never stop the
        // engine answering customers.
        console.warn('[sie] sie_settings read threw, using defaults:', err?.message || err);
        return { ...SIE_DEFAULTS };
    }
}

/**
 * Saves one setting. Staff-only, enforced by RLS on the table.
 *
 * Validated here as well as in the console because the console is not the
 * only possible caller, and a value the schema rejects would otherwise sit
 * in the table being silently ignored on every turn.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} key
 * @param {*} value
 * @returns {Promise<{error: Error|null}>}
 */
export async function saveSieSetting(supabase, key, value) {
    const check = validateSetting(key, value);
    if (!check.ok) return { error: new Error(check.error) };

    try {
        const { error } = await supabase
            .from('sie_settings')
            .upsert({ key, value: check.value }, { onConflict: 'key' });
        if (error) return { error: new Error(error.message) };
        settingsCache = null; // next read reflects the change
        settingsCachedAt = 0;
        return { error: null };
    } catch (err) {
        return { error: err instanceof Error ? err : new Error(String(err)) };
    }
}
