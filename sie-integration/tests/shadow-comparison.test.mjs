/**
 * shadow-comparison.test.mjs — WP2: the shadow comparison can say "agreed".
 * ------------------------------------------------------------
 * Audit finding K2: every production shadow record said agreed:false, because
 * the live side passed `interpretation: null` while the shadow reported
 * kind:'diagnostic', and because the shadow ran with default settings while
 * the live engine ran with the deployment's. These prove both causes are gone
 * and that a real divergence is still reported — the fix must not make the
 * comparison blind.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeWorld, converse } from './helpers/runtime-world.mjs';
import { runShadowComparison } from '../sie-shadow.js';
import { runTurn } from '../../sie/pipeline/pipeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'sie/scenarios/scenario-catalog.data/scenarios.json'), 'utf8')).scenarios;

test('[G-L9-5] identical live and shadow decisions compare as agreed', async () => {
    const text = 'بكام الاشتراك؟ عايز اعرف الاسعار';
    const same = await runTurn({ text, catalog: CATALOG, variant: 'vnext' });
    const { record } = await runShadowComparison({ text, catalog: CATALOG, liveResult: same });
    assert.equal(record.status, 'ok');
    assert.deepEqual(record.diff, []);
    assert.equal(record.agreed, true);
});

test('[G-L9-5] a real divergence is still reported (the fix does not blind the comparison)', async () => {
    const text = 'بكام الاشتراك؟ عايز اعرف الاسعار';
    const live = await runTurn({ text, catalog: CATALOG, variant: 'vnext' });
    const diverged = { ...live, decision: { ...live.decision, action: 'CREATE_TICKET' } };
    const { record } = await runShadowComparison({ text, catalog: CATALOG, liveResult: diverged });
    assert.equal(record.agreed, false);
    assert.deepEqual(record.diff.map((d) => d.field), ['action']);
});

test('[G-L9-5] the live engine reports its route truthfully: the shadow runs only on diagnostic turns', async () => {
    const world = makeWorld({ profile: 'production-audit-2026-10' });
    const [t] = await converse(world, 'a', ['بكام الاشتراك؟ عايز اعرف الاسعار']);
    assert.equal(t.trace.ranking.route, 'diagnostic');
    assert.ok(!t.trace.ranking.shadow.diff.some((d) => d.field === 'kind'), 'kind no longer differs by construction');
    assert.equal(t.trace.ranking.shadow.agreed, true);
});

test('[G-L9-5] the shadow decides with the live settings: a threshold-sensitive turn still agrees', async () => {
    // Scores 0.64: under the audited answer_confidence (0.65) the live engine
    // asks; a shadow on default settings (0.60) would answer and disagree.
    const world = makeWorld({ profile: 'production-audit-2026-10' });
    const [t] = await converse(world, 'a', ['مش بقدر ابعت رسايل للجروبات']);
    assert.equal(t.trace.decision.action, 'ASK_CLARIFYING_QUESTION');
    assert.equal(t.trace.ranking.shadow.agreed, true, JSON.stringify(t.trace.ranking.shadow.diff));
});
