/**
 * edition-catalog.local.js
 * ------------------------------------------------------------
 * Default pack loaders: the same module-relative fetch the core catalog and
 * glossary use, so packs deploy exactly the way the core does (jsDelivr at a
 * pinned commit in production, the filesystem-backed providers in tests).
 */
import { scenarioCatalogProvider } from '../scenarios/scenario-catalog.local.js';
import { createEditionCatalogs } from './edition-catalog.js';

async function fetchJson(relative) {
    const response = await fetch(new URL(relative, import.meta.url));
    if (!response.ok) throw new Error(`Failed to load ${relative}: ${response.status}`);
    return response.json();
}

export const editionCatalogs = createEditionCatalogs({
    coreScenarios: () => scenarioCatalogProvider.getAllScenarios(),
    async pack(name) {
        if (!/^[a-z]+$/.test(name)) throw new Error(`invalid pack name: ${name}`);
        const [catalog, glossary] = await Promise.all([
            fetchJson(`../scenarios/scenario-catalog.data/pack-${name}.json`),
            fetchJson(`../language/data/glossary-pack-${name}.json`)
        ]);
        return { scenarios: catalog.scenarios || [], glossary: glossary.entries || [], genericTokens: catalog.genericTokens || [] };
    }
});
