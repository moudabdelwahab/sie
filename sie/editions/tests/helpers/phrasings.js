/**
 * Runs the hand-written pack phrasings through their edition's pipeline.
 * Shared by scripts/check-phrasings.mjs and the edition phrasing test.
 */
import fs from 'node:fs';
import { runTurn } from '../../../pipeline/pipeline.js';
import { SIE_DEFAULT_SETTINGS } from '../../../config/settings-schema.js';
import { nodeEdition } from './node-editions.js';

const FIXTURE = new URL('../fixtures/pack-phrasings.json', import.meta.url);

export function readPhrasings(pack) {
    return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))[pack] || [];
}

export async function checkPhrasings(pack, { edition = pack } = {}) {
    const ed = await nodeEdition(edition, SIE_DEFAULT_SETTINGS);
    const providers = { glossaryProvider: ed.providers.glossaryProvider, arabiziProvider: ed.providers.arabiziProvider };
    const results = [];
    for (const [expect, text] of readPhrasings(pack)) {
        const r = await runTurn({ text, catalog: ed.scenarios, settings: SIE_DEFAULT_SETTINGS, variant: 'retrieval_only', providers, edition: { profile: ed.profile, glossaryLayers: ed.glossaryLayers } });
        const got = r.decision?.scenarioId ?? null;
        const ambiguous = Boolean(r.ranking?.isAmbiguous);
        results.push({
            expect, text, got, ambiguous, action: r.decision?.action ?? null,
            ok: got === expect && !ambiguous,
            top: r.ranking ? r.ranking.ranked.filter((e) => e.hypothesis.confidence > 0).slice(0, 3).map((e) => `${e.hypothesis.scenarioId}(${e.hypothesis.confidence.toFixed(2)})`).join(' ') : ''
        });
    }
    return { results, misses: results.filter((r) => !r.ok).length };
}
