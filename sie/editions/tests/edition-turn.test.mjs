/**
 * edition-turn.test.mjs — an edition's per-turn resource bounds, in the
 * pipeline itself (the bridge is tested separately in editions-bridge).
 * Written because scripts/mutation-check.mjs showed both bounds could be
 * removed from the pipeline with every test still green (M8, M9).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { capEvidenceTokens } from '../edition-turn.js';
import { resolveEditionProfile } from '../editions.js';
import { runTurn } from '../../pipeline/pipeline.js';
import { SIE_DEFAULT_SETTINGS } from '../../config/settings-schema.js';
import { nodeEdition, readPack } from './helpers/node-editions.js';

const pro = await nodeEdition('pro', SIE_DEFAULT_SETTINGS);
const turn = (text, settings) => {
    const profile = resolveEditionProfile('pro', { ...SIE_DEFAULT_SETTINGS, ...settings });
    return runTurn({ text, catalog: pro.scenarios, settings: SIE_DEFAULT_SETTINGS, variant: 'retrieval_only',
        providers: { glossaryProvider: pro.providers.glossaryProvider, arabiziProvider: pro.providers.arabiziProvider },
        edition: { ...pro, profile } });
};

test('capEvidenceTokens keeps the first N distinct tokens, every entry of each, and counts the rest', () => {
    const ev = ['a', 'b', 'a', 'c', 'd', 'b', 'e'].map((token, i) => ({ token, weight: 1, turn: 1, i }));
    const { evidence, dropped } = capEvidenceTokens(ev, 3);
    assert.deepEqual(evidence.map((e) => e.token), ['a', 'b', 'a', 'c', 'b']);
    assert.equal(dropped, 2);
    assert.deepEqual(capEvidenceTokens(ev, Infinity).evidence, ev, 'no bound, no change');
});

test("the pipeline applies the edition's distinct-token bound", async () => {
    const flood = readPack('pro').glossary.map((e) => e.patterns[0]).slice(0, 60).join(' ');
    const bounded = await turn(flood, { edition_pro_max_evidence_tokens: 16 });
    assert.ok(bounded.evidenceCapped > 0, 'a 60-word flood under a 16-token bound must drop evidence');
    const distinct = new Set(bounded.diagnosticState.accumulator.entries.map((e) => e.token));
    assert.ok(distinct.size <= 16, `accumulated ${distinct.size} distinct tokens`);
});

test("the pipeline applies the edition's message bound before anything reads the text", async () => {
    const filler = 'كلام '.repeat(60); // 300 chars, no vocabulary
    const text = `${filler}عايز ارفع اثبات التحويل`;
    const whole = await turn(text, { edition_pro_max_message_chars: 8000 });
    assert.equal(whole.decision.scenarioId, 'billing_upload_transfer_proof', 'the keyword is read when it fits');
    const cut = await turn(text, { edition_pro_max_message_chars: 200 });
    assert.notEqual(cut.decision.scenarioId, 'billing_upload_transfer_proof', 'past the bound it is never read');
});
