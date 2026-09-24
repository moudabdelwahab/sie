/**
 * Filesystem-backed edition loaders for Node tests and scripts — the same
 * split the other modules' node-providers.js helpers make, because Node's
 * fetch cannot read file: URLs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEditionCatalogs } from '../../edition-catalog.js';
import { createRealArabiziProvider } from '../../../language/tests/helpers/node-providers.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

export const PACK_NAMES = ['pro', 'max'];

export function readCore() { return read('sie/scenarios/scenario-catalog.data/scenarios.json').scenarios; }
export function readBaseGlossary() { return read('sie/language/data/technical-glossary.json').entries; }
export function readPack(name) {
    const catalog = path.join(ROOT, `sie/scenarios/scenario-catalog.data/pack-${name}.json`);
    const glossary = path.join(ROOT, `sie/language/data/glossary-pack-${name}.json`);
    if (!fs.existsSync(catalog)) return { scenarios: [], glossary: [], genericTokens: [] };
    const data = JSON.parse(fs.readFileSync(catalog, 'utf8'));
    return {
        scenarios: data.scenarios,
        genericTokens: data.genericTokens || [],
        glossary: fs.existsSync(glossary) ? JSON.parse(fs.readFileSync(glossary, 'utf8')).entries : []
    };
}

export function createNodeEditionCatalogs() {
    return createEditionCatalogs({
        coreScenarios: async () => readCore(),
        pack: async (name) => readPack(name)
    });
}

/** Everything a Node caller needs to run an edition through normalize/pipeline. */
export async function nodeEdition(edition, settings = {}) {
    const catalogs = createNodeEditionCatalogs();
    const assembly = await catalogs.forEdition(edition, settings);
    const base = readBaseGlossary();
    return {
        ...assembly,
        providers: {
            glossaryProvider: { getEntries: async () => base },
            arabiziProvider: createRealArabiziProvider(),
            glossaryLayers: assembly.glossaryLayers,
            maxInputChars: assembly.profile.maxMessageChars
        },
        baseGlossary: base
    };
}
