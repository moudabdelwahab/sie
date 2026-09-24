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

// ── held-out paraphrases: the honest robustness number ──────────────────
// 51 of the 195 phrasings share ≥ 75% of their words with the scenario's own
// label (34 are identical), so "195/195" partly measures the author's own
// wording. pro_heldout rephrases each of those 51 AVOIDING the label. The
// pack is never tuned against them. Measured 2026-09-24: 15/51 land. This is
// a floor (a change that loses one fails here) and a report, not a target.
// Measured 2026-09-24. Floors, not targets.
const HELDOUT_FLOOR = { pro: 15, max: 12 };

for (const pack of ['pro', 'max']) {
    test(`${pack} held-out paraphrases: landing rate never drops below what was measured`, async () => {
        const { results, misses } = await checkPhrasings(`${pack}_heldout`, { edition: pack });
        assert.equal(results.length, readPhrasings(`${pack}_heldout`).length);
        const landed = results.length - misses;
        assert.ok(landed >= HELDOUT_FLOOR[pack], `held-out landing ${landed}/${results.length} < measured ${HELDOUT_FLOOR[pack]}`);
        if (landed > HELDOUT_FLOOR[pack]) console.log(`# ${pack} held-out landing ${landed}/${results.length} (floor ${HELDOUT_FLOOR[pack]})`);
    });

    test(`${pack} held-out paraphrases: never more effectful than Free on them`, async () => {
        const eds = { free: await nodeEdition('free', SIE_DEFAULT_SETTINGS), [pack]: await nodeEdition(pack, SIE_DEFAULT_SETTINGS) };
        const run = (n, text) => runTurn({ text, catalog: eds[n].scenarios, settings: SIE_DEFAULT_SETTINGS, variant: 'retrieval_only',
            providers: { glossaryProvider: eds[n].providers.glossaryProvider, arabiziProvider: eds[n].providers.arabiziProvider }, edition: eds[n] });
        const E = new Set(['CREATE_TICKET', 'ESCALATE_TO_HUMAN']);
        const worse = [];
        for (const [id, text] of readPhrasings(`${pack}_heldout`)) {
            const f = await run('free', text), p = await run(pack, text);
            if (E.has(p.decision.action) && !E.has(f.decision.action)) worse.push(`${id} «${text}»`);
        }
        assert.deepEqual(worse, []);
    });
}
