/**
 * sie-scenario-editor.js  —  INTERNAL TO SIE
 * ------------------------------------------------------------
 * ⚠️ Not a public surface. Mad3oom must import sie-runtime.js instead;
 * everything here is re-exposed there under a stable contract.
 *
 * Backs the "Scenarios" tab of the settings console (sie-admin/
 * settings.js): reading the currently published catalog the live engine
 * diagnoses against, reading every stored draft/published version for
 * staff review, validating a proposed scenario against the engine's own
 * schema before it's saved, and saving a new draft version.
 *
 * Deliberately narrow and additive: nothing here can publish a
 * scenario. A draft only ever reaches the running engine through the
 * separate, gated Validation Lab publish flow (see
 * sie/observability/publish-gate.js and action-layer.js's
 * publishScenarioVersion) — never from this file.
 *
 * Same "every export is total, never throws" posture as
 * sie-entitlement.js and sie-chat-bridge.js: a failure here degrades to
 * an empty list / a structured validation result / a structured error,
 * never takes down the settings console.
 */
import { scenarioCatalogProvider } from '../sie/scenarios/scenario-catalog.local.js';
import { validateScenario } from '../sie/scenarios/scenario-types.js';
import { saveScenarioDraft as saveScenarioDraftAction } from '../sie/action/action-layer.js';
import { createRealSupabasePort } from '../sie/action/supabase-port.supabase.js';

/**
 * The currently published Scenario catalog — exactly what the live
 * engine diagnoses against right now, not a draft or proposed edit.
 *
 * @returns {Promise<import('../sie/scenarios/scenario-types.js').Scenario[]>}
 */
export async function listActiveScenarios() {
    try {
        return await scenarioCatalogProvider.getAllScenarios();
    } catch (err) {
        console.warn('[sie] listActiveScenarios failed:', err?.message || err);
        return [];
    }
}

/**
 * Every stored version (draft/validated/published/rejected/archived) of
 * every scenario, newest first — for the settings console's "Saved
 * drafts" panel. Staff-only by RLS ("staff can read all scenario rows"
 * on chat_engine_scenarios); a non-staff caller simply gets an empty
 * list back rather than a thrown RLS error.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<Array<{scenario_key: string, version: number, status: string, notes: string|null, created_at: string}>>}
 */
export async function listStoredScenarioVersions(supabase) {
    try {
        const { data, error } = await supabase
            .from('chat_engine_scenarios')
            .select('scenario_key, version, status, notes, created_at')
            .order('created_at', { ascending: false });
        if (error) {
            console.warn('[sie] listStoredScenarioVersions failed:', error.message);
            return [];
        }
        return data || [];
    } catch (err) {
        console.warn('[sie] listStoredScenarioVersions threw:', err?.message || err);
        return [];
    }
}

/**
 * Validates a proposed scenario against the EXACT schema the running
 * engine's catalog provider enforces (scenario-types.js's
 * validateScenario) — so the editor surfaces the same errors the engine
 * would raise on load, not a hand-rolled approximation of them.
 *
 * @param {*} scenario
 * @returns {Promise<{valid: boolean, errors: string[]}>}
 */
export async function validateScenarioDraft(scenario) {
    return validateScenario(scenario);
}

/**
 * Saves a proposed scenario as a new draft version. Never publishes —
 * the live engine keeps running on the current published version until
 * a separate, gated publish step (Validation Lab) promotes this draft.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{key: string, definition: *, authorNote?: string|null}} params
 * @returns {Promise<{success: boolean, error: string|null, draftVersion: number|null}>}
 */
export async function saveScenarioDraft(supabase, { key, definition, authorNote = null }) {
    try {
        const port = createRealSupabasePort(supabase);
        const result = await saveScenarioDraftAction({ key, definition, authorNote, port });
        return {
            success: result.success,
            error: result.success ? null : (result.steps?.[0]?.error ?? 'unknown error'),
            draftVersion: result.draftVersion ?? null
        };
    } catch (err) {
        console.warn('[sie] saveScenarioDraft threw:', err?.message || err);
        return { success: false, error: err?.message || String(err), draftVersion: null };
    }
}
