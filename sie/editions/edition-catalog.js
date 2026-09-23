/**
 * edition-catalog.js
 * ------------------------------------------------------------
 * The catalog and vocabulary one edition runs with, assembled from packs.
 *
 *   core   the shipped catalog + base glossary (scenario-catalog.data/scenarios.json,
 *          language/data/technical-glossary.json) — what Free has always run
 *   pro    +support scenarios, + a glossary LAYER (never merged into the base)
 *   max    +general scenarios, + its own layer
 *
 * The assembled catalog is packs in order, truncated to the profile's
 * scenario limit from the END (packs are authored most-valuable-first).
 * Assembly is cached per (edition, limit) so the SAME array identity is
 * handed out every turn — the retrieval index and the glossary-layer index
 * are both cached on array identity, and a fresh array per turn would
 * rebuild them per turn.
 *
 * Loading is lazy and per pack: a Free turn never fetches the Pro or Max
 * files, so adding editions costs Free nothing at cold start.
 */
import { validateCatalog } from '../scenarios/scenario-types.js';
import { scenarioTokens } from '../scenarios/scenario-types.js';
import { EDITION_PACKS, resolveEditionProfile } from './editions.js';

/**
 * @param {Object} loaders
 * @param {() => Promise<Array>} loaders.coreScenarios
 * @param {(pack: string) => Promise<{scenarios: Array, glossary: Array}>} loaders.pack
 */
export function createEditionCatalogs(loaders) {
    const packCache = new Map();   // pack -> Promise<{scenarios, glossary, warnings}>
    const assembled = new Map();   // `${edition}:${limit}` -> Promise<assembly>

    function loadPack(name) {
        if (!packCache.has(name)) {
            const p = (async () => {
                if (name === 'core') {
                    const scenarios = await loaders.coreScenarios();
                    return { scenarios, glossary: null, warnings: [] };
                }
                const raw = await loaders.pack(name);
                const { valid, invalid } = validateCatalog(raw?.scenarios || []);
                const warnings = invalid.map(({ scenario, errors }) =>
                    `Skipped invalid ${name} scenario (id: ${scenario?.id ?? 'unknown'}): ${errors.join('; ')}`);
                return { scenarios: valid, glossary: Array.isArray(raw?.glossary) ? raw.glossary : [], warnings };
            })();
            // A failed load is not cached: the next turn retries instead of
            // serving a permanently degraded edition from one bad fetch.
            p.catch(() => packCache.delete(name));
            packCache.set(name, p);
        }
        return packCache.get(name);
    }

    /**
     * @param {Object} profile  from resolveEditionProfile()
     * @returns {Promise<{profile, scenarios: Array, glossaryLayers: Array<Array>, packCounts: Object, warnings: string[]}>}
     */
    function forProfile(profile) {
        const key = `${profile.edition}:${profile.maxScenarios}`;
        if (!assembled.has(key)) {
            const p = (async () => {
                const packs = await Promise.all(EDITION_PACKS[profile.edition].map(loadPack));
                const seen = new Set();
                const scenarios = [];
                const warnings = [];
                const packCounts = {};
                const glossaryLayers = [];
                EDITION_PACKS[profile.edition].forEach((name, i) => {
                    const pack = packs[i];
                    warnings.push(...pack.warnings);
                    let kept = 0;
                    for (const s of pack.scenarios) {
                        if (scenarios.length >= profile.maxScenarios) break;
                        // An id already taken by an earlier pack is skipped, not
                        // overridden: a pack can ADD scope, never replace what
                        // a smaller edition already answers.
                        if (seen.has(s.id)) { warnings.push(`Skipped ${name} scenario "${s.id}": id already defined by an earlier pack`); continue; }
                        seen.add(s.id);
                        scenarios.push(s);
                        kept += 1;
                    }
                    packCounts[name] = kept;
                    if (pack.glossary && pack.glossary.length) glossaryLayers.push(pack.glossary);
                });
                return Object.freeze({ profile, scenarios, glossaryLayers, packCounts, warnings });
            })();
            p.catch(() => assembled.delete(key));
            assembled.set(key, p);
        }
        return assembled.get(key);
    }

    return {
        forProfile,
        async forEdition(edition, settings) { return forProfile(resolveEditionProfile(edition, settings)); }
    };
}

/** A scenario-catalog provider over an assembled edition, for the resolver/bridge. */
export function providerForAssembly(assembly) {
    const { scenarios, warnings } = assembly;
    let byId = null;
    return {
        async getAllScenarios() { return scenarios; },
        async getScenarioById(id) {
            if (!byId) byId = new Map(scenarios.map((s) => [s.id, s]));
            return byId.get(id) || null;
        },
        async getEvidenceVocabulary() {
            const tokens = new Set();
            for (const s of scenarios) for (const t of scenarioTokens(s)) tokens.add(t);
            return [...tokens];
        },
        async getLoadWarnings() { return warnings; }
    };
}
