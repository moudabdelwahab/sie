/**
 * scenario-catalog.resolver.js
 * ------------------------------------------------------------
 * المكان الوحيد اللي بيجاوب على السؤال: «المحرك بيشخّص بأي كتالوج؟»
 *
 * ------------------------------------------------------------
 * THE BUG THIS EXISTS TO MAKE IMPOSSIBLE
 *
 * The question had two answers living in two places, and they disagreed
 * in production without anyone being able to see it:
 *
 *   sie-chat-bridge.js  →  settings.use_published_scenarios
 *                            ? Supabase published rows   (7 rows)
 *                            : the shipped file          (383 / 650)
 *   sie-scenario-editor →  ALWAYS the shipped file
 *                          (and that is what /health and the admin
 *                           console report)
 *
 * With the flag on — which is how production is configured — the engine
 * diagnosed against 7 rows while every operator-facing surface reported
 * the full shipped catalog. A catalog the team had grown to 650 was
 * inert, and nothing anywhere said so.
 *
 * ------------------------------------------------------------
 * THE MODEL: BASE + OVERLAY, NEVER REPLACEMENT
 *
 * The shipped `scenarios.json` is the SOURCE OF TRUTH. It is the
 * reviewed catalog: version-controlled, covered by catalog-integrity and
 * catalog-reachability tests, and grown deliberately (383 → 500 → 650).
 *
 * `chat_engine_scenarios` is an OVERLAY on top of it, not a replacement.
 * Published rows are merged over the base BY ID:
 *
 *   - a row whose id is not in the base  →  ADDS a scenario
 *   - a row whose id IS in the base      →  OVERRIDES that one scenario
 *
 * That is what the console's publish feature was always meant to do —
 * "let an edit take effect without a deploy" — and it is why the live
 * rows are worth keeping rather than discarding: the seven in production
 * are five category routers that exist nowhere in the file, plus two
 * genuinely richer signatures (16 and 20 evidence tokens against the
 * file's 2).
 *
 * The invariant this buys, and which the tests enforce:
 *
 *   THE EFFECTIVE CATALOG CAN NEVER BE SMALLER THAN THE BASE CATALOG.
 *
 * Turning the flag on can add scenarios or sharpen them. It can no
 * longer silently delete 643 of them.
 *
 * ------------------------------------------------------------
 * WHY THE BASE IS NOT RE-VALIDATED HERE
 *
 * The base provider already validated and cached its scenarios, and it
 * is a module singleton. Re-running validateCatalog() over 650 entries
 * on every conversation turn would be a real cost for no answer that
 * changed. So only the overlay — a handful of rows — is validated here,
 * and the merged result is served through a thin provider that satisfies
 * the same interface without a second validation pass.
 *
 * ------------------------------------------------------------
 * FAILURE POSTURE
 *
 * An overlay that cannot be read is not an outage. Every failure path
 * degrades to the base catalog and records WHY in the resolution, so a
 * database blip narrows the catalog to the reviewed one rather than
 * breaking the turn — and the reason is visible instead of inferred.
 */
import { validateCatalog } from './scenario-types.js';
import { scenarioCatalogProvider } from './scenario-catalog.local.js';

/**
 * Why the effective catalog looks the way it does. Returned alongside
 * every resolution so `/health`, the admin console and a support
 * engineer reading a log all get the same answer the engine used.
 *
 * @typedef {Object} CatalogResolution
 * @property {number} baseCount        scenarios from the shipped file
 * @property {number} overlayCount     published rows that validated
 * @property {number} overlayInvalid   published rows rejected by the schema
 * @property {number} effectiveCount   what the engine actually diagnoses against
 * @property {string[]} addedIds       overlay ids not present in the base
 * @property {string[]} overriddenIds  base ids replaced by an overlay row
 * @property {'applied'|'disabled'|'unavailable'|'empty'} overlayStatus
 * @property {string|null} overlayError
 */

/** @returns {CatalogResolution} */
function emptyResolution(baseCount, overlayStatus, overlayError = null) {
    return {
        baseCount,
        overlayCount: 0,
        overlayInvalid: 0,
        effectiveCount: baseCount,
        addedIds: [],
        overriddenIds: [],
        overlayStatus,
        overlayError
    };
}

/**
 * Merges validated overlay scenarios over a validated base, by id.
 *
 * Pure and synchronous so the merge rule itself is testable without a
 * database, a file, or a clock.
 *
 * @param {import('./scenario-types.js').Scenario[]} baseScenarios
 * @param {import('./scenario-types.js').Scenario[]} overlayScenarios
 * @returns {{scenarios: import('./scenario-types.js').Scenario[], addedIds: string[], overriddenIds: string[]}}
 */
export function mergeScenarioCatalogs(baseScenarios, overlayScenarios) {
    const base = Array.isArray(baseScenarios) ? baseScenarios : [];
    const overlay = Array.isArray(overlayScenarios) ? overlayScenarios : [];

    // Insertion order is preserved for the base so a scenario's position
    // in the shipped file stays its position at runtime; overrides swap
    // in place rather than moving to the end.
    const merged = base.slice();
    const indexById = new Map(merged.map((scenario, index) => [scenario.id, index]));

    const addedIds = [];
    const overriddenIds = [];

    for (const scenario of overlay) {
        const existing = indexById.get(scenario.id);
        if (existing === undefined) {
            indexById.set(scenario.id, merged.length);
            merged.push(scenario);
            addedIds.push(scenario.id);
        } else {
            merged[existing] = scenario;
            overriddenIds.push(scenario.id);
        }
    }

    return { scenarios: merged, addedIds, overriddenIds };
}

/**
 * Reads the published rows of `chat_engine_scenarios`.
 *
 * Returns the RAW definitions; validation is the resolver's job, so a
 * malformed published row is reported as `overlayInvalid` rather than
 * silently vanishing or taking the whole read down with it.
 *
 * Latest published version wins per scenario_key, matching what
 * scenario-catalog.supabase.js has always done.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<Object[]>}
 */
export async function loadPublishedScenarioOverlay(supabase) {
    const { data, error } = await supabase
        .from('chat_engine_scenarios')
        .select('scenario_key, version, definition')
        .eq('status', 'published')
        .order('version', { ascending: false });

    if (error) {
        throw new Error(`Failed to load published scenarios: ${error.message}`);
    }

    const seen = new Set();
    const definitions = [];
    for (const row of data || []) {
        if (seen.has(row.scenario_key)) continue;
        seen.add(row.scenario_key);
        if (row.definition) definitions.push(row.definition);
    }
    return definitions;
}

/**
 * A provider over an already-validated array. Implements exactly the
 * interface createScenarioCatalogProvider() returns, so every consumer
 * (Diagnostic Engine, Ranking Engine, the console) is unaware that a
 * merge happened at all.
 *
 * @param {import('./scenario-types.js').Scenario[]} scenarios
 * @param {string[]} warnings
 */
function providerOver(scenarios, warnings) {
    return {
        async getAllScenarios() {
            return scenarios;
        },
        async getScenarioById(id) {
            return scenarios.find((s) => s.id === id) || null;
        },
        async getEvidenceVocabulary() {
            const tokens = new Set();
            for (const scenario of scenarios) {
                for (const entry of scenario.evidenceSignature) tokens.add(entry.token);
            }
            return Array.from(tokens);
        },
        async getLoadWarnings() {
            return warnings;
        }
    };
}

/**
 * THE one entry point. Runtime, admin, health and tests all call this,
 * which is the whole point: there is no second way to answer "which
 * catalog", so no second answer can drift away from the first.
 *
 * @param {Object} [options]
 * @param {import('@supabase/supabase-js').SupabaseClient} [options.supabase]
 *   omit it (a console with no session, a test) and the base catalog is
 *   returned with overlayStatus 'unavailable' — never a smaller catalog,
 *   and never a claim that the overlay was checked when it was not.
 * @param {Object} [options.settings] the SIE settings blob
 * @param {Object} [options.baseProvider] injectable for tests
 * @param {(supabase: Object) => Promise<Object[]>} [options.loadOverlay] injectable for tests
 * @returns {Promise<{provider: Object, resolution: CatalogResolution}>}
 */
export async function resolveScenarioCatalog({
    supabase = null,
    settings = null,
    baseProvider = scenarioCatalogProvider,
    loadOverlay = loadPublishedScenarioOverlay
} = {}) {
    const baseScenarios = await baseProvider.getAllScenarios();
    const baseWarnings = await baseProvider.getLoadWarnings();

    // The flag is read the same way the bridge always read it, so turning
    // the overlay off keeps costing exactly one cached call and no query.
    const overlayEnabled = settings?.use_published_scenarios === true;
    if (!overlayEnabled) {
        return {
            provider: baseProvider,
            resolution: emptyResolution(baseScenarios.length, 'disabled')
        };
    }

    if (!supabase) {
        return {
            provider: baseProvider,
            resolution: emptyResolution(baseScenarios.length, 'unavailable', 'no supabase client supplied')
        };
    }

    let rawOverlay;
    try {
        rawOverlay = await loadOverlay(supabase);
    } catch (err) {
        // Degrade to the reviewed catalog. Narrower than intended, but
        // correct — and the reason travels with the resolution.
        console.warn('[scenario-catalog] overlay unavailable, using the shipped catalog:', err?.message || err);
        return {
            provider: baseProvider,
            resolution: emptyResolution(baseScenarios.length, 'unavailable', String(err?.message || err))
        };
    }

    const { valid: overlayValid, invalid: overlayInvalid } = validateCatalog(rawOverlay);
    const overlayWarnings = overlayInvalid.map(
        ({ scenario, errors }) =>
            `Skipped invalid published scenario (id: ${scenario?.id ?? 'unknown'}): ${errors.join('; ')}`
    );
    for (const warning of overlayWarnings) {
        console.warn(`[scenario-catalog] ${warning}`);
    }

    if (overlayValid.length === 0) {
        return {
            provider: baseProvider,
            resolution: {
                ...emptyResolution(baseScenarios.length, 'empty'),
                overlayInvalid: overlayInvalid.length
            }
        };
    }

    const { scenarios, addedIds, overriddenIds } = mergeScenarioCatalogs(baseScenarios, overlayValid);

    return {
        provider: providerOver(scenarios, [...baseWarnings, ...overlayWarnings]),
        resolution: {
            baseCount: baseScenarios.length,
            overlayCount: overlayValid.length,
            overlayInvalid: overlayInvalid.length,
            effectiveCount: scenarios.length,
            addedIds,
            overriddenIds,
            overlayStatus: 'applied',
            overlayError: null
        }
    };
}
