/**
 * catalog-uniqueness.test.mjs — the permanent duplicate gate.
 *
 * Every edition's catalog (Free = core, Pro = core + pro, Max = + max) is
 * audited with the engine's own scoring. The build fails on ANY finding:
 *
 *   duplicate_intent / intent_overlap     two scenarios claim the same job
 *   structural_duplicate                  same weighted signature (any signature)
 *   semantic_duplicate / same_answer      paraphrased label or answer
 *   synonym_token                         two tokens for one concept
 *   not_decisive / core_displaced         a scenario no message can reach
 *                                         alone, or a pack stealing a Free one
 *   layer_redefines_base / pattern_collision / dead_pattern
 *                                         vocabulary that is wrong or inert
 *   unused_token / unknown_token / oversized_signature / invalid / missing_intent
 *
 * A pair that looks similar but was reviewed and kept must be listed, with
 * its reason, in fixtures/reviewed-pairs.json — never silenced here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditEditions } from '../../editions/edition-audit.js';
import { readCore, readBaseGlossary, readPack, PACK_NAMES } from '../../editions/tests/helpers/node-editions.js';
import { createRealArabiziProvider } from '../../language/tests/helpers/node-providers.js';

const reviewedFile = new URL('./fixtures/reviewed-pairs.json', import.meta.url);
const reviewed = JSON.parse(fs.readFileSync(reviewedFile, 'utf8'));

test('every reviewed pair carries a reason', () => {
    for (const [pair, reason] of Object.entries(reviewed.pairs)) {
        assert.match(pair, /^[a-z0-9_]+\|[a-z0-9_]+$/, `malformed pair key ${pair}`);
        assert.ok(typeof reason === 'string' && reason.length >= 20, `${pair}: a reviewed pair needs a real reason`);
    }
});

test('no duplicate, overlapping, unreachable or dead content in any edition', async () => {
    const packs = Object.fromEntries(PACK_NAMES.map((n) => [n, readPack(n)]));
    const { findings, stats } = await auditEditions({
        core: readCore(), baseGlossary: readBaseGlossary(), packs,
        providers: { arabiziProvider: createRealArabiziProvider() }, reviewed: reviewed.pairs
    });
    const report = findings.slice(0, 15).map((f) => JSON.stringify(f)).join('\n');
    assert.equal(findings.length, 0, `${findings.length} audit findings:\n${report}`);
    for (const [edition, s] of Object.entries(stats.editions)) {
        assert.equal(s.reachability.decisive, s.size, `${edition}: every scenario must be decisively reachable`);
    }
    assert.equal(stats.editions.free.size, readCore().length, 'Free is exactly the core');
});

test('compiled pack files are in sync with their sources', () => {
    const script = fileURLToPath(new URL('../../../scripts/build-packs.mjs', import.meta.url));
    // Throws (non-zero exit) when any output is stale.
    execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' });
});
