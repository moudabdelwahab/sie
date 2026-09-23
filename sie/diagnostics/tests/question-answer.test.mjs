/**
 * question-answer.test.mjs
 * ------------------------------------------------------------
 * A tapped discriminating-question option must become the evidence it
 * declares. Before this existed, `impliesEvidence` on every option of every
 * question in the catalog was read by nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evidenceFromQuestionAnswer } from '../question-answer.js';
import { runConversation } from '../../pipeline/pipeline.js';
import { createRealGlossaryProvider, createRealArabiziProvider } from '../../language/tests/helpers/node-providers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'sie/scenarios/scenario-catalog.data/scenarios.json'), 'utf8')).scenarios;
const providers = { glossaryProvider: createRealGlossaryProvider(), arabiziProvider: createRealArabiziProvider() };
const lookup = (id) => CATALOG.find((s) => s.id === id) || null;
const pending = { pendingQuestion: { scenarioId: 'subscription_payment_not_reflected', questionId: 'payment_confirmation_received' } };

test('an option VALUE yields exactly the tokens that option declares', async () => {
    const r = await evidenceFromQuestionAnswer({ text: 'debited_only', decisionState: pending, lookup, turn: 2 });
    assert.equal(r.optionValue, 'debited_only');
    assert.deepEqual(r.evidence.map((e) => e.token).sort(), ['entity_payment', 'symptom_not_received']);
    assert.ok(r.evidence.every((e) => e.turn === 2 && e.polarity === 'supports'));
});

test('an option LABEL, in either language and with icon markup, is the same answer', async () => {
    for (const text of ['الفلوس اتخصمت بس مفيش تأكيد', 'Money was taken but no confirmation', '  الفلوس اتخصمت بس مفيش تأكيد  ']) {
        const r = await evidenceFromQuestionAnswer({ text, decisionState: pending, lookup, turn: 2 });
        assert.equal(r?.optionValue, 'debited_only', text);
    }
});

test('nothing is implied without a pending question, for free text, or for another question\'s option', async () => {
    assert.equal(await evidenceFromQuestionAnswer({ text: 'debited_only', decisionState: {}, lookup, turn: 2 }), null);
    assert.equal(await evidenceFromQuestionAnswer({ text: 'debited_only', decisionState: null, lookup, turn: 2 }), null);
    assert.equal(await evidenceFromQuestionAnswer({ text: 'الفلوس اتخصمت وبعدين', decisionState: pending, lookup, turn: 2 }), null);
    assert.equal(await evidenceFromQuestionAnswer({ text: 'no_such_address', decisionState: pending, lookup, turn: 2 }), null);
});

test('a malformed pending question from a stored row is ignored, not thrown on', async () => {
    for (const bad of [{ pendingQuestion: 42 }, { pendingQuestion: { scenarioId: 7 } }, { pendingQuestion: { scenarioId: 'nope', questionId: 'x' } }]) {
        assert.equal(await evidenceFromQuestionAnswer({ text: 'debited_only', decisionState: bad, lookup, turn: 2 }), null);
    }
});

test('production trace 2026-09: tapping "debited_only" no longer ends in a subscription_expired ticket', async () => {
    const turns = await runConversation({ messages: ['عندي مشكله في الاشتراك', 'debited_only'], catalog: CATALOG, providers });
    const [first, second] = turns;
    // The engine asked the payment question on turn 1 …
    assert.equal(first.decision.action, 'ASK_CLARIFYING_QUESTION');
    assert.deepEqual(first.decisionState.pendingQuestion, pending.pendingQuestion);
    // … and on turn 2 the answer was read as the evidence it declares.
    assert.equal(second.questionAnswer?.option, 'debited_only');
    assert.ok(second.evidenceAdmitted >= 2, `only ${second.evidenceAdmitted} evidence admitted`);
    assert.notEqual(second.decision.scenarioId, 'subscription_expired',
        'the answer "money was taken" must not lead to the scenario it rules out');
    const payment = new Set(['subscription_payment_not_reflected', 'subscription_double_charged', 'billing_unexpected_charge']);
    assert.ok(payment.has(second.decision.scenarioId), `landed on ${second.decision.scenarioId}`);
});
