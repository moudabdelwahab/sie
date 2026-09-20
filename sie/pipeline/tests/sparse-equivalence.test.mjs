/**
 * sparse-equivalence.test.mjs
 * ------------------------------------------------------------
 * Proves the sparse session state produces the same BEHAVIOUR, not just
 * smaller bytes — over conversations long enough for a divergence to appear.
 *
 * `sie/diagnostics/tests/sparse-state.test.mjs` already proves
 * `expand(compress(state))` is field-exact. This file asks the question that
 * one cannot: does a conversation DRIVEN through the sparse state reach the
 * same decisions, turn after turn, as one driven through the full state?
 *
 * They are different claims. A state can round-trip perfectly and still
 * diverge once it is fed back into a pipeline that reads it differently —
 * which is exactly what hysteresis, the decision state and the referenced-
 * scenario scope all do.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runConversation, runTurn } from '../pipeline.js';
import { toSparseState, expandHypotheses, isSparseState } from '../../diagnostics/sparse-state.js';
import { createRealGlossaryProvider, createRealArabiziProvider } from '../../language/tests/helpers/node-providers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'sie/scenarios/scenario-catalog.data/scenarios.json'), 'utf8')).scenarios;
const providers = { glossaryProvider: createRealGlossaryProvider(), arabiziProvider: createRealArabiziProvider() };

/** A conversation of `n` turns that keeps producing new evidence. */
function conversation(n) {
    const pool = [
        'نسيت كلمة السر', 'الايميل مجاني', 'مش شغال خلاص', 'الفاتوره مش واصله',
        'الاشتراك خلص', 'الـ API بيرجع 500', 'الواتساب مش متصل', 'التقارير غلط',
        'عايز فاتورة ضريبية', 'ازاي اضيف موظف', 'الداشبورد مش بيحدث', 'التذكرة اختفت'
    ];
    return Array.from({ length: n }, (_, i) => pool[i % pool.length]);
}

/** What a turn is compared on. */
const observable = (r) => ({
    kind: r.interpretation?.kind ?? null,
    action: r.decision?.action ?? null,
    scenarioId: r.decision?.scenarioId ?? null,
    confidence: r.ranking?.topHypothesis?.hypothesis.confidence ?? null,
    ambiguous: r.ranking?.isAmbiguous ?? null,
    answered: [...(r.decisionState?.answeredScenarioIds || [])].sort(),
    questionsAsked: r.decisionState?.questionsAskedCount ?? null,
    ticketed: r.decisionState?.ticketAlreadyCreated ?? null
});

// ------------------------------------------------------------
// THE LENGTHS THE BRIEF ASKED FOR.

for (const turns of [1, 2, 3, 10, 50, 100]) {
    test(`sparse state: ${turns}-turn conversation produces identical behaviour on every turn`, async () => {
        const messages = conversation(turns);
        const full = await runConversation({ messages, catalog: CATALOG, variant: 'retrieval_only', providers });
        const sparse = await runConversation({ messages, catalog: CATALOG, variant: 'vnext', providers });

        assert.equal(full.length, sparse.length);
        for (let i = 0; i < full.length; i++) {
            assert.deepEqual(observable(sparse[i]), observable(full[i]),
                `turn ${i + 1} of ${turns} diverged`);
        }
    });
}

test('sparse state: the saving holds over a long conversation, and is reported honestly', async () => {
    const messages = conversation(100);
    const full = await runConversation({ messages, catalog: CATALOG, variant: 'retrieval_only', providers });
    const sparse = await runConversation({ messages, catalog: CATALOG, variant: 'vnext', providers });

    const fullBytes = JSON.stringify(full[99].diagnosticState).length;
    const sparseBytes = JSON.stringify(sparse[99].diagnosticState).length;
    assert.ok(isSparseState(sparse[99].diagnosticState));
    assert.ok(sparseBytes < fullBytes, `sparse ${sparseBytes}B is not smaller than full ${fullBytes}B`);

    // The tracked set grows with the conversation's breadth — it is a bound,
    // not a constant, and 100 turns is where that shows. The assertion is
    // deliberately loose: what must hold is that it stays bounded by BREADTH
    // rather than by catalog size.
    assert.ok(sparse[99].diagnosticState.tracked.length < CATALOG.length / 2,
        `100 turns tracked ${sparse[99].diagnosticState.tracked.length} of ${CATALOG.length} scenarios`);
});

// ------------------------------------------------------------
// WHAT HAS TO SURVIVE THE ROUND TRIP.

test('sparse state: session continuation from a stored state matches an unbroken run', async () => {
    const messages = conversation(6);
    const unbroken = await runConversation({ messages, catalog: CATALOG, variant: 'vnext', providers });

    // Break the session after turn 3 and resume from what was persisted —
    // which is what actually happens between two webhook invocations.
    const firstHalf = await runConversation({ messages: messages.slice(0, 3), catalog: CATALOG, variant: 'vnext', providers });
    const stored = JSON.parse(JSON.stringify({
        diagnosticState: firstHalf[2].diagnosticState,
        decisionState: firstHalf[2].decisionState,
        turnCount: 3,
        language: firstHalf[2].responseLanguage,
        lastCustomerText: messages[2]
    }));

    let previous = stored;
    for (let i = 3; i < messages.length; i++) {
        const r = await runTurn({ text: messages[i], catalog: CATALOG, previous, variant: 'vnext', providers });
        assert.deepEqual(observable(r), observable(unbroken[i]), `turn ${i + 1} diverged after resuming from storage`);
        previous = {
            diagnosticState: r.diagnosticState, decisionState: r.decisionState,
            turnCount: r.turn, language: r.responseLanguage, lastCustomerText: messages[i]
        };
    }
});

test('sparse state: survives a JSON round trip, which is how it is actually stored', async () => {
    const messages = conversation(5);
    const direct = await runConversation({ messages, catalog: CATALOG, variant: 'vnext', providers });

    let previous = null;
    for (let i = 0; i < messages.length; i++) {
        const r = await runTurn({ text: messages[i], catalog: CATALOG, previous, variant: 'vnext', providers });
        assert.deepEqual(observable(r), observable(direct[i]), `turn ${i + 1} diverged through JSON`);
        // Serialise and parse between every turn, as the database does.
        previous = JSON.parse(JSON.stringify({
            diagnosticState: r.diagnosticState, decisionState: r.decisionState,
            turnCount: r.turn, language: r.responseLanguage, lastCustomerText: messages[i]
        }));
    }
});

test('sparse state: hypotheses and the hysteresis flag survive a long conversation', async () => {
    const messages = conversation(12);
    const full = await runConversation({ messages, catalog: CATALOG, variant: 'retrieval_only', providers });
    const sparse = await runConversation({ messages, catalog: CATALOG, variant: 'vnext', providers });

    const expanded = expandHypotheses(sparse[11].diagnosticState, CATALOG, 12);
    const byId = new Map(expanded.map((h) => [h.scenarioId, h]));

    let checkedActive = 0;
    for (const h of full[11].diagnosticState.hypotheses) {
        const mine = byId.get(h.scenarioId);
        assert.ok(mine, `${h.scenarioId} vanished from the sparse state`);
        assert.equal(mine.status, h.status, `${h.scenarioId}: status differs`);
        assert.equal(mine.hasEverBeenActive, h.hasEverBeenActive, `${h.scenarioId}: hysteresis flag differs`);
        assert.ok(Math.abs(mine.confidence - h.confidence) < 1e-12, `${h.scenarioId}: confidence differs`);
        if (h.status === 'active') checkedActive += 1;
    }
    assert.ok(checkedActive > 0, 'nothing was active, so this proves nothing');
});

test('REJECTION IS UNREACHABLE FROM TEXT — a finding, asserted so it stays visible', async () => {
    // This assertion looks backwards on purpose. It pins a DEFECT.
    //
    // `status: 'rejected'` is supposed to mean "this was considered and ruled
    // out", and the whole hysteresis mechanism — REJECTION_THRESHOLD,
    // hasEverBeenActive — exists to produce it. It cannot fire, because
    // confidence can only ever RISE within a session:
    //
    //   - `extractTextEvidence` hard-codes polarity 'supports'
    //   - `extractDiscriminatingAnswerEvidence` CAN emit 'contradicts' and is
    //     called by nothing outside its own unit test
    //   - there is no decay: the accumulator is append-only noisy-OR
    //
    // So no customer message can ever lower a scenario's confidence, and
    // nothing reaches 'rejected'. This is the root of T1 in
    // SIE-ARCHITECTURE.md, and it is also why R6B_ALREADY_ANSWERED and
    // closeConversation exist: both are decision-layer treatments for an
    // inference-layer disease.
    //
    // When the contradicts path is wired, this test will fail — and that
    // failure is the signal to delete it and restore the rejection assertion
    // in the test above.
    const messages = conversation(20);
    const results = await runConversation({ messages, catalog: CATALOG, variant: 'vnext', providers });
    const expanded = expandHypotheses(results[19].diagnosticState, CATALOG, 20);
    const rejected = expanded.filter((h) => h.status === 'rejected');
    assert.deepEqual(rejected, [], 'rejection became reachable — wire the assertion above back in and delete this test');
});

test('sparse state: rejection DOES round-trip correctly once contradicting evidence exists', async () => {
    // The mechanism is dead in production but not broken, and the sparse
    // state must handle it for the day the contradicts path is wired.
    // Injected directly, because no pipeline input can produce it.
    const { updateSparseState } = await import('../../diagnostics/sparse-state.js');
    const { updateHypotheses } = await import('../../diagnostics/hypothesis-tracker.js');
    const { mergeEvidence, getAllTokenPresences } = await import('../../diagnostics/evidence-accumulator.js');

    const token = CATALOG[0].evidenceSignature[0].token;
    const supports = [{ token, source: 'text', polarity: 'supports', weight: 1, turn: 1 }];
    const contradicts = [{ token, source: 'text', polarity: 'contradicts', weight: 1, turn: 2 }];

    // Full path.
    let acc = mergeEvidence({ entries: [] }, supports, 1);
    let hyps = updateHypotheses(CATALOG, getAllTokenPresences(acc), [], 1);
    acc = mergeEvidence(acc, contradicts, 2);
    hyps = updateHypotheses(CATALOG, getAllTokenPresences(acc), hyps, 2);

    // Sparse path.
    let sparse = updateSparseState({ scenarios: CATALOG, previous: null, newEvidence: supports, turn: 1 });
    sparse = updateSparseState({ scenarios: CATALOG, previous: sparse, newEvidence: contradicts, turn: 2 });
    const expanded = expandHypotheses(sparse, CATALOG, 2);

    const fullRejected = hyps.filter((h) => h.status === 'rejected').map((h) => h.scenarioId).sort();
    const sparseRejected = expanded.filter((h) => h.status === 'rejected').map((h) => h.scenarioId).sort();
    assert.ok(fullRejected.length > 0, 'the fixture failed to drive anything into rejection');
    assert.deepEqual(sparseRejected, fullRejected, 'rejection did not survive the sparse round trip');
});

test('sparse state: a mid-conversation SHAPE SWITCH works in both directions', async () => {
    // The rollback case. Turn 1-2 sparse, turn 3 full, turn 4 sparse again —
    // a deployment toggling the flag under a live conversation.
    const messages = conversation(4);
    const reference = await runConversation({ messages, catalog: CATALOG, variant: 'vnext', providers });

    let previous = null;
    const variants = ['vnext', 'vnext', 'retrieval_only', 'vnext'];
    for (let i = 0; i < messages.length; i++) {
        const r = await runTurn({ text: messages[i], catalog: CATALOG, previous, variant: variants[i], providers });
        assert.deepEqual(observable(r), observable(reference[i]),
            `turn ${i + 1} diverged when the state shape changed mid-conversation`);
        previous = {
            diagnosticState: r.diagnosticState, decisionState: r.decisionState,
            turnCount: r.turn, language: r.responseLanguage, lastCustomerText: messages[i]
        };
    }
});

test('sparse state: a corrupt or truncated stored state degrades safely, it does not throw', async () => {
    const good = await runTurn({ text: 'نسيت كلمة السر', catalog: CATALOG, variant: 'vnext', providers });
    const broken = [
        { ...good.diagnosticState, tracked: null },
        { ...good.diagnosticState, accumulator: null },
        { ...good.diagnosticState, schemaVersion: 99 },
        { schemaVersion: 2, tracked: [], accumulator: { entries: [] } },
        {}, null
    ];
    for (const state of broken) {
        const r = await runTurn({
            text: 'مش شغال', catalog: CATALOG,
            previous: { diagnosticState: state, turnCount: 1 },
            variant: 'vnext', providers
        });
        assert.ok(r.decision, `a ${JSON.stringify(state).slice(0, 40)} state produced no decision`);
        assert.ok(typeof r.decision.action === 'string');
    }
});

test('sparse state: an interrupted turn leaves the previous state usable', async () => {
    // The turn before the interruption is what is on disk. Resuming from it
    // must behave as though the interrupted turn never happened.
    const first = await runTurn({ text: 'نسيت كلمة السر', catalog: CATALOG, variant: 'vnext', providers });
    const stored = { diagnosticState: first.diagnosticState, decisionState: first.decisionState, turnCount: 1 };

    const a = await runTurn({ text: 'مش شغال', catalog: CATALOG, previous: stored, variant: 'vnext', providers });
    const b = await runTurn({ text: 'مش شغال', catalog: CATALOG, previous: stored, variant: 'vnext', providers });
    assert.deepEqual(observable(a), observable(b), 'replaying the same turn from the same state is not deterministic');
});
