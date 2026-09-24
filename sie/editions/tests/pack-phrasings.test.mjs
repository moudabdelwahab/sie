/**
 * Every pack scenario must be reached by at least one natural phrasing,
 * alone and unambiguously, in its edition.
 *
 * The reachability audit proves a SUBSET of a signature makes a scenario
 * win; it cannot prove that the words customers use produce that subset.
 * This test is the other half: hand-written phrasings (fixtures/
 * pack-phrasings.json) through the real edition pipeline. It found 38 of
 * the first 149 Pro scenarios unreachable by their natural wording.
 *
 * @no-legitimate-corpus
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkPhrasings, readPhrasings } from './helpers/phrasings.js';
import { readPack } from './helpers/node-editions.js';
import { runTurn } from '../../pipeline/pipeline.js';
import { SIE_DEFAULT_SETTINGS } from '../../config/settings-schema.js';
import { nodeEdition } from './helpers/node-editions.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/pack-phrasings.json', import.meta.url), 'utf8'));

for (const pack of ['pro', 'max']) {
    test(`${pack}: every scenario has a phrasing`, () => {
        const ids = new Set(readPhrasings(pack).map(([id]) => id));
        const missing = readPack(pack).scenarios.map((s) => s.id).filter((id) => !ids.has(id));
        assert.deepEqual(missing, [], `${missing.length} ${pack} scenarios have no phrasing`);
    });

    test(`${pack}: every phrasing lands on its scenario, unambiguously`, async () => {
        const { results } = await checkPhrasings(pack);
        const misses = results.filter((r) => !r.ok).map((r) => `${r.expect} ← «${r.text}» got ${r.got}${r.ambiguous ? ' (ambiguous)' : ''}`);
        assert.deepEqual(misses, []);
    });
}

test('known limits still behave as documented (fixing one means updating the fixture)', async () => {
    for (const lim of fixture.known_limits || []) {
        assert.ok(lim.why && lim.why.length > 40, `${lim.expect}: a known limit needs its reason`);
        const ed = await nodeEdition(lim.pack, SIE_DEFAULT_SETTINGS);
        const r = await runTurn({ text: lim.text, catalog: ed.scenarios, settings: SIE_DEFAULT_SETTINGS, variant: 'retrieval_only',
            providers: { glossaryProvider: ed.providers.glossaryProvider, arabiziProvider: ed.providers.arabiziProvider },
            edition: { profile: ed.profile, glossaryLayers: ed.glossaryLayers, packIds: ed.packIds, genericTokens: ed.genericTokens } });
        assert.equal(r.interpretation.kind, lim.actualKind, `«${lim.text}» no longer behaves as documented — move it back to the phrasings`);
    }
});
