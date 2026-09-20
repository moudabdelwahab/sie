/**
 * catalog-reachability.test.mjs
 * ------------------------------------------------------------
 * A scenario can be perfectly well-formed and still be dead: the shape
 * validator only reads the entry, it never asks whether real Arabic text
 * can reach it. This file asks exactly that, by running the actual
 * pipeline — normalize -> diagnose -> rank — over the whole catalog.
 *
 * The probe for each scenario is built from that scenario's OWN glossary
 * vocabulary: the phrase listed for its strongest evidence token, joined
 * to the phrase for its next one. That is deliberately the friendliest
 * possible input. A scenario that cannot be ranked even by the words it
 * was written around is unreachable by any real customer, and the point
 * of the test is that this failure is otherwise completely silent.
 *
 * Being out-ranked by a NEIGHBOUR is not a failure. Adjacent scenarios
 * are supposed to compete — that competition is what the Decision
 * Engine's ambiguity rule reads before it asks a discriminating question.
 * What must never happen is a scenario the ranker cannot see at all.
 *
 * ------------------------------------------------------------
 * THIS TEST USED TO ASSERT NOTHING
 *
 * The original assertion was that the scenario's id appears in
 * `ranking.ranked`. It does — always. `rankHypotheses` returns the ENTIRE
 * catalog sorted, including every zero-confidence hypothesis, because the
 * diagnostic trail is supposed to record what was ruled out as well as what
 * was kept. So `ranked` had 650 entries with 649 of them at confidence 0, and
 * `ids.includes(scenario.id)` was true by construction. The test could not
 * fail, for any catalog, for any probe.
 *
 * It is worth being precise about why that survived: the test LOOKED like it
 * exercised the real pipeline, and it did — it normalised real Arabic, built
 * real evidence, and ranked a real catalog. All of that work was real. Only
 * the assertion at the end was empty, and an assertion is the only part of a
 * test that can be empty without anything appearing to go wrong.
 *
 * The assertions below are calibrated against what the catalog actually does
 * today, so they have room to fail:
 *
 *   own-probe confidence   > 0 for all 650
 *   own rank               p50=1, p90=2, p99=5, max=10
 *   all 650 within the top 20
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { rankDiagnosticState } from '../../ranking/ranking-engine.js';
import { diagnoseRealTurn, createRealScenarioCatalogProvider } from '../../ranking/tests/helpers/node-providers.js';

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (rel) => JSON.parse(readFileSync(join(here, rel), 'utf8'));

const { scenarios } = readJson('../scenario-catalog.data/scenarios.json');

/**
 * How far down its own best words may place a scenario before it counts as
 * unreachable. Measured over the shipped catalog: p50=1, p90=2, p99=5,
 * max=10. Twenty leaves room for the catalog to grow denser without this
 * becoming a tripwire, while still failing on a scenario that has genuinely
 * been buried.
 */
const OWN_RANK_LIMIT = 20;
const glossaryFile = readJson('../../language/data/technical-glossary.json');
const patternsOf = new Map((glossaryFile.entries || glossaryFile).map((e) => [e.canonical, e.patterns]));

/** The two phrases this scenario was written around, as one message. */
function probeFor(scenario) {
    return [...scenario.evidenceSignature]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 2)
        .map((entry) => (patternsOf.get(entry.token) || [])[0])
        .filter(Boolean)
        .join(' و');
}

test('every scenario can be reached by the words it was written around', async () => {
    const provider = createRealScenarioCatalogProvider();
    const unreachable = [];

    for (const scenario of scenarios) {
        const probe = probeFor(scenario);
        if (!probe) {
            unreachable.push(`${scenario.id}: no glossary phrase exists for any of its tokens`);
            continue;
        }
        const state = await diagnoseRealTurn(probe, 1);
        const ranked = await rankDiagnosticState(state, provider, { activationThreshold: 0 });

        // `ranked` is the WHOLE catalog sorted, zero-confidence entries and
        // all — so membership proves nothing. Position and confidence do.
        const position = ranked.ranked.findIndex((r) => r.hypothesis.scenarioId === scenario.id);
        const entry = position === -1 ? null : ranked.ranked[position];
        const top = ranked.ranked.slice(0, 3).map((r) => r.hypothesis.scenarioId).join(', ');

        if (!entry) {
            unreachable.push(`${scenario.id}: absent from the ranking entirely`);
        } else if (entry.hypothesis.confidence <= 0) {
            unreachable.push(`${scenario.id}: probe "${probe}" scores 0 — its own words produce no evidence for it`);
        } else if (position >= OWN_RANK_LIMIT) {
            unreachable.push(
                `${scenario.id}: probe "${probe}" ranks it #${position + 1} behind [${top}] — ` +
                `no customer reaches a scenario ${position + 1} places down`
            );
        }
    }

    assert.deepEqual(unreachable, []);
});

test('the catalog is not one big tie — most scenarios win on their own words', async () => {
    const provider = createRealScenarioCatalogProvider();
    let ownProbeWins = 0;

    for (const scenario of scenarios) {
        const probe = probeFor(scenario);
        if (!probe) continue;
        const state = await diagnoseRealTurn(probe, 1);
        const ranked = await rankDiagnosticState(state, provider, { activationThreshold: 0 });
        if (ranked.ranked[0]?.hypothesis.scenarioId === scenario.id) ownProbeWins += 1;
    }

    // Not 100%: neighbouring scenarios legitimately out-rank each other on
    // a two-phrase probe, and the discriminating questions exist precisely
    // for those. This guards the opposite failure — vocabulary so blunt
    // that everything collapses onto a handful of winners.
    const ratio = ownProbeWins / scenarios.length;
    assert.ok(ratio > 0.75, `only ${ownProbeWins}/${scenarios.length} scenarios win on their own words (${(ratio * 100).toFixed(1)}%)`);
});
