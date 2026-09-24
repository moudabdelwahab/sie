/**
 * audit-rules.test.mjs — the audit's gates, each shown to FIRE.
 *
 * catalog-uniqueness.test.mjs asserts the shipped catalogs have zero
 * findings. That test cannot tell a clean catalog from a deleted rule: both
 * pass. So every gate that guards the non-negotiables (no duplicates, no new
 * stand-offs, no hijacked vocabulary) is fed a small pack that violates it,
 * over the REAL core, and must report the violation by kind.
 *
 * @no-legitimate-corpus — deliberately defective scenarios.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditEditions } from '../edition-audit.js';
import { readCore, readBaseGlossary } from './helpers/node-editions.js';
import { createRealArabiziProvider } from '../../language/tests/helpers/node-providers.js';

const core = readCore();
const byId = new Map(core.map((s) => [s.id, s]));

function sc(id, sig, ar, extra = {}) {
    return {
        id, intent: `test/${id}`, label: { ar: id, en: id }, category: 'other',
        evidenceSignature: sig.map(([token, weight]) => ({ token, weight, source: 'text' })),
        discriminatingQuestions: [], resolution: { hasAutoResolution: true, text: { ar, en: `answer ${id}` } },
        requiresTicketIfUnresolved: false, ...extra
    };
}
const own = (n) => ({ canonical: `entity_zz_${n}`, labels: { ar: n, en: n }, patterns: [`زززز${n}`] });

async function audit(scenarios, glossary = []) {
    const { findings } = await auditEditions({
        core, baseGlossary: readBaseGlossary(), packs: { pro: { scenarios, glossary } },
        providers: { arabiziProvider: createRealArabiziProvider() }
    });
    return findings;
}
const kinds = (findings) => new Set(findings.map((f) => f.kind));

test('a copy of a core scenario under a new id is caught as a duplicate on every axis', async () => {
    const victim = byId.get('subscription_status_inquiry');
    const copy = { ...victim, id: 'zz_copy', intent: 'test/zz_copy' };
    const k = kinds(await audit([copy]));
    // Caught on every axis: the signature vector, the meaning, the answer.
    for (const kind of ['identical_vector', 'semantic_duplicate', 'same_answer']) assert.ok(k.has(kind), `${kind} missing: ${[...k]}`);
});

test('the same answer under different words is flagged', async () => {
    const victim = core.find((s) => (s.resolution?.text?.ar || '').length > 80);
    const f = await audit([sc('zz_same_answer', [['entity_zz_a', 3], ['entity_zz_b', 1]], victim.resolution.text.ar)], [own('a'), own('b')]);
    assert.ok(kinds(f).has('same_answer'), [...kinds(f)].join(','));
});

test('a pack reusing a core id is flagged', async () => {
    const f = await audit([sc(core[0].id, [['entity_zz_a', 1]], 'x')], [own('a')]);
    assert.ok(kinds(f).has('duplicate_id'));
});

test('one core word: a pack reading 0.105 under the core best is a stand-off at dialect presence', async () => {
    // symptom_login_failed («مش عارف ادخل»): core readings 0.50 and 0.33, so
    // Free is decisive at every presence. A pack reading at 0.395 is 0.105
    // under the best — outside the margin at 1.0, inside it at 0.8. This is
    // the exact shape of the bug the attack-parity test found.
    const t = 'symptom_login_failed';
    const p = 0.395;
    const f = await audit([sc('zz_near', [[t, p], ['entity_zz_a', 1 - p]], 'x')], [own('a')]);
    const hit = f.find((x) => x.kind === 'single_token_competition' && x.id === 'zz_near');
    assert.ok(hit, 'the presence-aware single-word rule must fire');
    assert.equal(hit.coreBest, 0.5);
    assert.ok(hit.atPresence < 1, 'and it must be the presence that finds it');
});

test('a set of core words: a pack reading tying the core reading of the set is a stand-off', async () => {
    // Same core words, same weights, one extra private word at a small share:
    // on the core words alone the pack reading is 0.91 vs the core's 1.0.
    const victim = byId.get('subscription_status_inquiry');
    const sig = victim.evidenceSignature.map((e) => [e.token, e.weight]);
    const f = await audit([sc('zz_set', [...sig, ['entity_zz_a', 0.5]], 'x')], [own('a')]);
    assert.ok(f.some((x) => x.kind === 'word_set_competition'), [...kinds(f)].join(','));
});

test('a layer cannot redefine a base token', async () => {
    const f = await audit([sc('zz_layer', [['entity_zz_a', 1]], 'x')], [own('a'), { canonical: 'entity_ticket', labels: { ar: 'x', en: 'x' }, patterns: ['ززززتذكره'] }]);
    assert.ok(kinds(f).has('layer_redefines_base'));
});
