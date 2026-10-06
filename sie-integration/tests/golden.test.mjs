/**
 * golden.test.mjs — the golden conversations, run through the real runtime.
 * ------------------------------------------------------------
 * One test per (conversation × settings profile). Green runs must pass; red
 * runs must fail on exactly their declared expectations (see
 * helpers/golden-runner.mjs). Titles carry the guarantee and P0 tags the
 * guarantee registry (docs/SIE-GUARANTEES.md) is checked against.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runGolden, assertRunStatus, loadGoldens } from './helpers/golden-runner.mjs';
import { SETTINGS_PROFILES } from './helpers/runtime-world.mjs';

const GOLDENS = loadGoldens();
const CATEGORIES = new Set(['E2E', 'MT', 'MS', 'PS', 'ADV']);

test('golden files are well formed', () => {
    const ids = new Set();
    for (const g of GOLDENS) {
        assert.ok(g.id && !ids.has(g.id), `duplicate or missing id: ${g.id}`);
        ids.add(g.id);
        assert.ok(Array.isArray(g.chats) && g.chats.length, `${g.id}: no chats`);
        assert.ok(Array.isArray(g.runs) && g.runs.length, `${g.id}: no runs`);
        for (const c of g.categories || []) assert.ok(CATEGORIES.has(c), `${g.id}: unknown category ${c}`);
        for (const run of g.runs) {
            assert.ok(SETTINGS_PROFILES.includes(run.profile), `${g.id}: unknown profile ${run.profile}`);
            assert.ok(['red', 'green'].includes(run.status), `${g.id}: bad status ${run.status}`);
        }
    }
});

test('[T-4] every golden conversation runs under a production settings profile', () => {
    for (const g of GOLDENS) {
        assert.ok(g.runs.some((r) => r.profile.startsWith('production')), `${g.id} never runs under production settings`);
    }
});

for (const g of GOLDENS) {
    const tags = [...(g.guarantees || []).map((x) => `[${x}]`), ...(g.p0 || []).map((n) => `[P0-${n}]`)].join('');
    for (const run of g.runs) {
        test(`golden ${g.id} [${run.profile}] ${run.status} ${tags}`, async () => {
            const { failures } = await runGolden(g, run.profile);
            assert.doesNotThrow(() => assertRunStatus(g, run, failures));
        });
    }
}
