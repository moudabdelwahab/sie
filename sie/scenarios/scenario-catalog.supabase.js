/**
 * scenario-catalog.supabase.js  —  SUPERSEDED FOR THE RUNTIME PATH
 * ------------------------------------------------------------
 * ⚠️ Nothing in the running engine imports this any more. The overlay
 * read moved into sie/scenarios/scenario-catalog.resolver.js, which is
 * now the ONLY answer to "which catalog does the engine diagnose
 * against" for the runtime, the console, the health checks and the
 * tests alike.
 *
 * It is kept because it is a correct, tested implementation of the
 * provider contract and a useful reference for a future storage swap —
 * but do NOT wire it into a code path directly. Using it on its own is
 * precisely the bug the resolver exists to prevent: it returns ONLY the
 * published rows, so a caller that treats its output as "the catalog"
 * silently discards the entire shipped catalog. In production that was
 * 650 scenarios replaced by 7.
 */

/**
 * scenario-catalog.supabase.js
 * ------------------------------------------------------------
 * Supabase-backed implementation of the scenario catalog provider.
 *
 * This is the storage-backend swap promised since Module 2: it reuses
 * createScenarioCatalogProvider() from scenario-catalog.provider.js
 * completely unchanged — the same factory, the same validation, the
 * same caching, the same getAllScenarios/getScenarioById/
 * getEvidenceVocabulary/getLoadWarnings interface every other module
 * already depends on. Only the loadFn (where the raw rows come from)
 * is new. Diagnostic, Ranking, Decision, Dialogue, and Knowledge remain
 * completely unaware this file exists — they only ever call the
 * provider interface, never touch Supabase.
 *
 * Reads only the latest PUBLISHED version of each scenario_key from
 * chat_engine_scenarios (see migration
 * add_chat_engine_observability_and_review_center). Draft and archived
 * rows are never surfaced to the running engine — only the Review
 * Center / Validation Lab reads those, for editing and simulation.
 *
 * scenario-catalog.local.js is untouched and remains the default;
 * this file is opt-in, used wherever a Supabase-backed catalog is
 * explicitly wanted (e.g. production, once wired in).
 */
import { createScenarioCatalogProvider } from './scenario-catalog.provider.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 * @returns {ReturnType<typeof createScenarioCatalogProvider>}
 */
export function createScenarioCatalogSupabaseProvider(supabaseClient) {
    return createScenarioCatalogProvider(async () => {
        const { data, error } = await supabaseClient
            .from('chat_engine_scenarios')
            .select('scenario_key, version, definition')
            .eq('status', 'published')
            .order('version', { ascending: false });

        if (error) {
            throw new Error(`Failed to load scenarios from Supabase: ${error.message}`);
        }

        // Rows are ordered by version descending, so the first row seen
        // for a given scenario_key is its latest published version.
        const seenKeys = new Set();
        const scenarios = [];
        for (const row of data || []) {
            if (seenKeys.has(row.scenario_key)) continue;
            seenKeys.add(row.scenario_key);
            scenarios.push(row.definition);
        }
        return scenarios;
    });
}
