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
        const ids = ranked.ranked.map((r) => r.hypothesis.scenarioId);
        if (!ids.includes(scenario.id)) {
            unreachable.push(`${scenario.id}: probe "${probe}" ranked [${ids.slice(0, 3).join(', ') || 'nothing'}]`);
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
