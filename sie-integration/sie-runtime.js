/**
 * sie-runtime.js
 * ============================================================
 * THE SINGLE PUBLIC GATEWAY BETWEEN MAD3OOM AND SIE.
 * ------------------------------------------------------------
 * SIE is the intelligence subsystem of the Mad3oom Platform — not a
 * standalone SaaS product. It lives in its own repository purely for
 * source-code organization; at runtime it behaves exactly as if it were
 * still inside Mad3oom: same origin, same Supabase project, same
 * session, direct ES imports, no network hop in between.
 *
 * ── THE RULE ────────────────────────────────────────────────
 * Mad3oom imports THIS FILE AND NOTHING ELSE from SIE.
 *
 *   chat-logic.js · chat-widget.js · admin/* · tickets · future modules
 *        ↓ import { ... } from '/sie-integration/sie-runtime.js'
 *   sie-runtime.js            ← the only public surface (this file)
 *        ↓
 *   sie-chat-bridge.js        ← INTERNAL: turn orchestration
 *   sie-entitlement.js        ← INTERNAL: customer_sie_access access
 *   sie-scenario-editor.js    ← INTERNAL: settings console's catalog editing
 *        ↓
 *   /sie/**                   ← INTERNAL: the nine engine modules
 *
 * Nothing above this line may reach past it. If Mad3oom needs a new
 * capability from SIE, it gets a new export HERE — never a deeper
 * import. That is what keeps every SIE module free to change shape
 * without any Mad3oom file knowing.
 *
 * ── WHAT THIS FILE DELIBERATELY IS NOT ──────────────────────
 * There is no HTTP client here, no base-URL resolution, no circuit
 * breaker, no retry policy, no token forwarding, no response-shape
 * revalidation. Those exist to survive a network boundary, and there is
 * no network boundary: this runs in the customer's own browser tab, in
 * the same origin, against the same Supabase session Mad3oom already
 * holds. The database itself proves the point — sie_consume_message()
 * rejects any call where p_user_id <> auth.uid(), so the caller MUST be
 * the customer's own session, never a remote service.
 *
 * ── ERROR POSTURE ───────────────────────────────────────────
 * Every export here is total: it never throws and never rejects. A
 * failure anywhere inside SIE degrades to a documented safe value
 * (null / false / { error }) so a bug in the engine can never take down
 * Mad3oom's chat widget, admin panel, or dashboard.
 *
 * ── OWNERSHIP ───────────────────────────────────────────────
 * Both systems share one Supabase project by design, but ownership is
 * not shared. SIE owns chat_engine_* / customer_sie_access and writes
 * them freely. Mad3oom owns chat_messages / chat_sessions / tickets;
 * SIE touches those ONLY through the two atomic RPCs Mad3oom exposes
 * for it (persist_bot_turn, create_ticket_with_message_and_session_update),
 * never with ad-hoc inserts.
 */

import { runSieTurn } from './sie-chat-bridge.js';
import {
    isCurrentUserSieAdmin as _isCurrentUserSieAdmin,
    isCurrentUserEngineStaff as _isCurrentUserEngineStaff,
    getSieAccessStatus as _getSieAccessStatus,
    adminSetAccess as _adminSetAccess,
    adminResetUsage as _adminResetUsage,
    evaluateSieAccessRow
} from './sie-entitlement.js';
import {
    listActiveScenarios as _listActiveScenarios,
    listStoredScenarioVersions as _listStoredScenarioVersions,
    validateScenarioDraft as _validateScenarioDraft,
    saveScenarioDraft as _saveScenarioDraft
} from './sie-scenario-editor.js';

/**
 * Bumped whenever the shape of anything exported here changes.
 * Mad3oom never needs to read this; it exists so a support engineer
 * looking at a console log can tell which runtime a tab is running.
 */
export const SIE_RUNTIME_VERSION = '2.1.0';

// ===================================================================
// Chat
// ===================================================================

/**
 * Produces SIE's reply for exactly one customer message.
 *
 * Drop-in compatible with the signature Mad3oom already calls, so
 * switching a call site over is a one-line import change.
 *
 * ⚠️ THE ONE THING CALLERS MUST HONOUR — `alreadyPersisted`
 * ---------------------------------------------------------------
 * When this resolves to an object, SIE's Action Layer has ALREADY
 * written the bot message, the session's bot_state, and (if this turn
 * opened one) the ticket — all inside a single database transaction via
 * persist_bot_turn / create_ticket_with_message_and_session_update.
 * That atomicity is the whole reason the write lives here: a ticket can
 * never exist without its message, and neither can exist without the
 * matching session state.
 *
 * So the caller MUST NOT insert into chat_messages itself:
 *
 *     const sieResult = await getSieReply({ ... });
 *     if (sieResult) {
 *         renderQuickOptions(sieResult.options);
 *         return;                       // ← skip the normal insert
 *     }
 *     // null → fall through to the traditional engine
 *
 * Skipping that `return` writes every bot message twice.
 *
 * @param {Object} params
 * @param {string} params.text - the customer's raw message
 * @param {import('@supabase/supabase-js').SupabaseClient} params.supabase
 * @param {string} params.sessionId - chat_sessions.id
 * @param {string} params.userId - the customer's auth.users.id
 * @param {Object} [params.botState] - the session's full bot_state blob.
 *   SIE reads and writes ONLY its own `botState.sie` namespace, so the
 *   traditional engine's keys survive untouched when a conversation
 *   moves between engines mid-session.
 * @returns {Promise<{
 *   reply: string,
 *   options: Array<{label: string, value: string}>,
 *   alreadyPersisted: true,
 *   ticketNumber: string|null,
 *   botState: Object
 * } | null>} null means "SIE did not handle this turn" — not entitled,
 *   quota exhausted, or an internal failure. The caller should fall back
 *   to the traditional engine. Nothing was written in that case.
 */
export async function getSieReply({ text, supabase, sessionId, userId, botState }) {
    if (!text || !supabase || !sessionId || !userId) return null;
    try {
        return await runSieTurn({ text, supabase, sessionId, userId, botState });
    } catch (err) {
        // runSieTurn already catches its own failures; this is the
        // last line of defence so a genuinely unexpected throw (an
        // import failure, an OOM) still degrades instead of bubbling
        // into Mad3oom's message-send handler.
        console.error('[sie-runtime] unexpected failure in getSieReply:', err?.message || err);
        return null;
    }
}

// ===================================================================
// Entitlement (read-only)
// ===================================================================

/**
 * The customer's raw `customer_sie_access` row, or null when they have
 * none / it isn't visible to the caller under RLS.
 *
 * Read-only: this never consumes quota. Use it to decide whether to
 * OFFER SIE (mode picker, admin panel display). Actually spending a
 * turn happens inside getSieReply().
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
export async function getSieAccessStatus(supabase, userId) {
    return _getSieAccessStatus(supabase, userId);
}

/**
 * "Can this customer use SIE right now?", already interpreted — so no
 * caller has to re-implement the enabled / expired / quota rules.
 *
 * This is the read-side twin of the `sie_consume_message()` gate: the
 * same three conditions, evaluated without spending anything. Keeping
 * both readings in SIE is what stops Mad3oom's UI and SIE's enforcement
 * from ever disagreeing about why access was denied.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<{
 *   available: boolean,
 *   reason: 'no_access_row'|'disabled'|'expired'|'quota_exceeded'|'lookup_failed'|null,
 *   statusLabel: string|null,
 *   remaining: number|null,
 *   row: Object|null
 * }>} `available: false` with `reason: null` is impossible — every
 *   denial names itself, so the UI can always explain it to the customer.
 */
export async function getSieAvailability(supabase, userId) {
    const row = await _getSieAccessStatus(supabase, userId);
    return evaluateSieAccessRow(row);
}

/**
 * The pure, synchronous half of getSieAvailability(): interprets a
 * `customer_sie_access` row the caller already has, without a round trip.
 *
 * Exists for the admin screens, which load every customer's row in one
 * bulk query and then need to label hundreds of them. Without this they
 * would each reimplement the enabled/expired/quota rules — which is
 * exactly the drift this runtime exists to prevent.
 *
 * @param {Object|null} row - a raw customer_sie_access row
 * @returns {ReturnType<typeof evaluateSieAccessRow>} same shape as getSieAvailability()
 */
export { evaluateSieAccessRow };

// ===================================================================
// Admin
// ===================================================================

/**
 * Is the CURRENT session an SIE admin? (entitlement grant/revoke —
 * customer_sie_access.)
 *
 * Answered by the database (`is_sie_admin()`), never by comparing an
 * email in JavaScript — the database is the single source of truth for
 * this, and a client-side copy would be both duplicated and trivially
 * bypassable.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<boolean>} false on any error (fail closed).
 */
export async function isCurrentUserSieAdmin(supabase) {
    return _isCurrentUserSieAdmin(supabase);
}

/**
 * Is the CURRENT session allowed to read/edit the Scenario & Knowledge
 * catalog (settings console, Review Center, Validation Lab)?
 *
 * Answered by the database (`is_chat_engine_staff()`) — a broader group
 * than isCurrentUserSieAdmin (any 'admin'/'support'/'super_user'
 * profile), since catalog editing is a team role while SIE entitlement
 * is a single accountable address. Never checked by inspecting a role
 * in JavaScript.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<boolean>} false on any error (fail closed).
 */
export async function isCurrentUserEngineStaff(supabase) {
    return _isCurrentUserEngineStaff(supabase);
}

/**
 * Grants / updates / revokes a customer's SIE access. Admin-only.
 *
 * Authorization is NOT checked here. `sie_admin_set_access()` calls
 * `is_sie_admin()` itself and raises for anyone else, so a non-admin
 * gets a real database-enforced rejection rather than a client-side
 * one that a devtools console could skip.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   userId: string,
 *   isEnabled: boolean,
 *   accessMode: 'unlimited'|'quota'|'expiration',
 *   messageQuota?: number|null,
 *   expiresAt?: string|null,
 *   notes?: string|null
 * }} params
 * @returns {Promise<{error: Error|null}>}
 */
export async function adminSetAccess(supabase, params) {
    return _adminSetAccess(supabase, params);
}

/**
 * Zeroes a customer's `messages_used` (e.g. a new billing period).
 * Admin-only, enforced inside `sie_admin_reset_usage()`.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<{error: Error|null}>}
 */
export async function adminResetUsage(supabase, userId) {
    return _adminResetUsage(supabase, userId);
}

// ===================================================================
// Scenario catalog editing (settings console's "Scenarios" tab)
// ===================================================================

/**
 * The currently published Scenario catalog — exactly what the live
 * engine diagnoses against right now.
 *
 * @returns {Promise<import('../sie/scenarios/scenario-types.js').Scenario[]>}
 */
export async function listActiveScenarios() {
    return _listActiveScenarios();
}

/**
 * Every stored version (draft/validated/published/rejected/archived) of
 * every scenario, newest first. Staff-only by RLS; degrades to an empty
 * list for a non-staff caller rather than throwing.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<Array<{scenario_key: string, version: number, status: string, notes: string|null, created_at: string}>>}
 */
export async function listStoredScenarioVersions(supabase) {
    return _listStoredScenarioVersions(supabase);
}

/**
 * Validates a proposed scenario against the exact schema the running
 * engine's catalog provider enforces.
 *
 * @param {*} scenario
 * @returns {Promise<{valid: boolean, errors: string[]}>}
 */
export async function validateScenarioDraft(scenario) {
    return _validateScenarioDraft(scenario);
}

/**
 * Saves a proposed scenario as a new draft version. Never publishes —
 * see sie/observability/publish-gate.js for the separate, gated publish
 * step that promotes a draft to what the live engine actually uses.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{key: string, definition: *, authorNote?: string|null}} params
 * @returns {Promise<{success: boolean, error: string|null, draftVersion: number|null}>}
 */
export async function saveScenarioDraft(supabase, params) {
    return _saveScenarioDraft(supabase, params);
}

// ===================================================================
// Health
// ===================================================================

/**
 * Whether the SIE runtime loaded successfully in this tab.
 *
 * Always true once this module has evaluated — if SIE were unreachable
 * the import itself would have failed, and Mad3oom would never have got
 * here. It exists because Mad3oom's mode picker calls a reachability
 * check, and because in-process code genuinely cannot be "temporarily
 * down" the honest answer is a constant, not a network probe.
 *
 * @returns {boolean}
 */
export function isSieAvailable() {
    return true;
}

/**
 * Backward-compatible alias for the name the retired HTTP client used.
 * @deprecated Prefer isSieAvailable().
 */
export const isSieLikelyAvailable = isSieAvailable;
