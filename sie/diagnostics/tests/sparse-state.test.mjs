/**
 * sparse-state.test.mjs
 * ------------------------------------------------------------
 * Proves the sparse state reproduces the full one, and pins the single place
 * it deliberately does not.
 *
 * The comparison is against `updateHypotheses` itself — the production
 * implementation, driven over the same turn sequence — rather than against a
 * hand-written expectation. An equivalence test whose reference is a fixture
 * only proves the fixture was copied correctly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { updateHypotheses } from '../hypothesis-tracker.js';
import { mergeEvidence, getAllTokenPresences } from '../evidence-accumulator.js';
import { extractTextEvidence } from '../evidence-extractor.js';
import { normalize } from '../../language/normalizer.js';
import { createRealGlossaryProvider, createRealArabiziProvider } from '../../language/tests/helpers/node-providers.js';
import {
    DIAGNOSTIC_SCHEMA_VERSION, createEmptySparseState, isSparseState,
    toSparseState, migrateState, updateSparseState, expandHypotheses, stateSize
} from '../sparse-state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CATALOG = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'sie/scenarios/scenario-catalog.data/scenarios.json'), 'utf8')
).scenarios;
const providers = { glossaryProvider: createRealGlossaryProvider(), arabiziProvider: createRealArabiziProvider() };

const CONVERSATION = [
    'نسيت كلمة السر',
    'الايميل مجاني',
    'مش شغال خلاص',
    'عايز اتكلم مع حد',
    'الفاتوره مش واصله والاشتراك خلص'
];

/** Drives both implementations over the same turns and returns both states. */
async function runBoth(messages) {
    let fullAcc = { entries: [] };
    let fullHyps = [];
    let sparse = null;
    const perTurn = [];

    for (let i = 0; i < messages.length; i++) {
        const turn = i + 1;
        const normalized = await normalize(messages[i], providers);
        const evidence = extractTextEvidence(normalized.normalizedTokens, turn);

        fullAcc = mergeEvidence(fullAcc, evidence, turn);
        fullHyps = updateHypotheses(CATALOG, getAllTokenPresences(fullAcc), fullHyps, turn);

        sparse = updateSparseState({ scenarios: CATALOG, previous: sparse, newEvidence: evidence, turn });

        perTurn.push({ turn, full: fullHyps, sparse, expanded: expandHypotheses(sparse, CATALOG, turn) });
    }
    return perTurn;
}

// ------------------------------------------------------------

test('sparse state: every derivable field matches the full tracker, turn by turn', async () => {
    const turns = await runBoth(CONVERSATION);
    const DERIVABLE = ['scenarioId', 'status', 'confidence', 'supportingEvidenceTokens',
        'missingEvidenceTokens', 'hasEverBeenActive', 'firstSeenTurn', 'lastUpdatedTurn'];

    for (const { turn, full, expanded } of turns) {
        assert.equal(expanded.length, full.length, `turn ${turn}: hypothesis count differs`);
        for (let i = 0; i < full.length; i++) {
            for (const field of DERIVABLE) {
                assert.deepEqual(expanded[i][field], full[i][field],
                    `turn ${turn}, ${full[i].scenarioId}, field "${field}"`);
            }
        }
    }
});

test('sparse state: the diagnostic trail is preserved in full, for every scenario', async () => {
    const turns = await runBoth(CONVERSATION);
    for (const { turn, full, expanded } of turns) {
        let everActive = 0;
        for (let i = 0; i < full.length; i++) {
            if (full[i].hasEverBeenActive) everActive += 1;
            assert.deepEqual(expanded[i].history, full[i].history,
                `turn ${turn}, ${full[i].scenarioId}: trail differs`);
        }
        assert.ok(everActive > 0, `turn ${turn}: nothing was active, so this proves nothing`);
    }
});

test('sparse state: expansion is exact — NO field of NO scenario differs, at any turn', async () => {
    const turns = await runBoth(CONVERSATION);
    for (const { turn, full, expanded } of turns) {
        for (let i = 0; i < full.length; i++) {
            assert.deepEqual(expanded[i], full[i],
                `turn ${turn}, ${full[i].scenarioId}: expansion is not exact`);
        }
    }
});

test('sparse state: the tracked set grows with the conversation, and by how much', async () => {
    // The saving is real but it is a BOUND, not a constant: nothing removes a
    // tracked record, because hysteresis and the trail both need it to persist.
    // This pins the growth so a regression in it is visible.
    const long = [...CONVERSATION, 'ازاي اضيف موظف', 'التقارير غلط', 'الواتساب مش متصل',
        'عايز فاتورة ضريبية', 'الـ api بيرجع 500'];
    const turns = await runBoth(long);
    const counts = turns.map((t) => t.sparse.tracked.length);

    for (let i = 1; i < counts.length; i++) {
        assert.ok(counts[i] >= counts[i - 1], 'the tracked set must never shrink');
    }
    // Bounded by the conversation's breadth, not the catalog: ten turns must
    // not have tracked a meaningful share of 650 scenarios.
    assert.ok(counts[counts.length - 1] < CATALOG.length / 3,
        `10 turns tracked ${counts[counts.length - 1]} of ${CATALOG.length} scenarios — growth is not bounded by breadth`);
});

test('sparse state: hysteresis survives — a hypothesis that falls away becomes rejected, not unconsidered', async () => {
    // Activate something, then talk about something else entirely for long
    // enough that the first subject's confidence collapses.
    const turns = await runBoth(['نسيت كلمة السر', 'مش شغال', 'عايز اتكلم مع حد', 'ازاي اضيف موظف']);
    const last = turns[turns.length - 1];

    const rejected = last.expanded.filter((h) => h.status === 'rejected').map((h) => h.scenarioId);
    const fullRejected = last.full.filter((h) => h.status === 'rejected').map((h) => h.scenarioId);
    assert.deepEqual(rejected, fullRejected);

    // And the distinction that needs the stored flag: 'rejected' is not
    // 'unconsidered', and telling them apart is impossible from the ledger.
    for (const h of last.expanded) {
        if (h.status === 'rejected') assert.equal(h.hasEverBeenActive, true);
        if (h.status === 'unconsidered') assert.equal(h.hasEverBeenActive, false);
    }
});

test('sparse state: it is actually smaller, by the margin claimed', async () => {
    const turns = await runBoth(CONVERSATION);
    for (const { turn, sparse } of turns) {
        const { sparseBytes, fullBytes, ratio } = stateSize(sparse, CATALOG, turn);
        assert.ok(fullBytes > 180 * 1024, `turn ${turn}: the full state should be ~200KB, measured ${fullBytes}`);
        // Measured at 10.0x on turn 5 after the 2026-09 audit merged 15
        // duplicate scenarios (the full state shrank with the catalog; the
        // sparse state did not, because it tracks the conversation, not the
        // catalog). The bar is the order of magnitude, not the third digit.
        assert.ok(ratio > 8, `turn ${turn}: only a ${ratio.toFixed(1)}x reduction (${sparseBytes} vs ${fullBytes} bytes)`);
    }
});

// ------------------------------------------------------------
// Migration. Sessions already in the database carry the v1 shape.

test('migration: a v1 state is accepted, converted, and expands to the same hypotheses', async () => {
    const turns = await runBoth(CONVERSATION.slice(0, 3));
    const last = turns[turns.length - 1];

    const legacy = { accumulator: last.sparse.accumulator, hypotheses: last.full, turnCount: 3 };
    assert.equal(isSparseState(legacy), false);

    const migrated = migrateState(legacy);
    assert.equal(migrated.schemaVersion, DIAGNOSTIC_SCHEMA_VERSION);
    assert.equal(isSparseState(migrated), true);

    const expanded = expandHypotheses(migrated, CATALOG, 3);
    for (let i = 0; i < last.full.length; i++) {
        assert.equal(expanded[i].scenarioId, last.full[i].scenarioId);
        assert.equal(expanded[i].status, last.full[i].status);
        assert.equal(expanded[i].confidence, last.full[i].confidence);
        assert.equal(expanded[i].hasEverBeenActive, last.full[i].hasEverBeenActive);
        assert.deepEqual(expanded[i].history, last.full[i].history);
    }
});

test('migration: a v1 state can continue as a turn of the sparse pipeline', async () => {
    const turns = await runBoth(CONVERSATION.slice(0, 2));
    const legacy = { accumulator: turns[1].sparse.accumulator, hypotheses: turns[1].full, turnCount: 2 };

    const normalized = await normalize(CONVERSATION[2], providers);
    const continued = updateSparseState({
        scenarios: CATALOG, previous: legacy,
        newEvidence: extractTextEvidence(normalized.normalizedTokens, 3), turn: 3
    });
    assert.equal(continued.schemaVersion, DIAGNOSTIC_SCHEMA_VERSION);
    assert.ok(continued.tracked.length > 0);

    // And it matches what a pure-sparse run would have produced.
    const pure = await runBoth(CONVERSATION.slice(0, 3));
    assert.deepEqual(
        continued.tracked.map((t) => t.scenarioId),
        pure[2].sparse.tracked.map((t) => t.scenarioId)
    );
});

test('migration: an empty or absent state is handled without special-casing by callers', () => {
    assert.equal(isSparseState(createEmptySparseState()), true);
    assert.deepEqual(migrateState(null), createEmptySparseState());
    assert.deepEqual(toSparseState(null), createEmptySparseState());
    assert.deepEqual(toSparseState({}), createEmptySparseState());
    assert.deepEqual(expandHypotheses(createEmptySparseState(), [], 1), []);
});

test('sparse state: persisted form is byte-stable when nothing changes', async () => {
    const normalized = await normalize('نسيت كلمة السر', providers);
    const evidence = extractTextEvidence(normalized.normalizedTokens, 1);
    const first = updateSparseState({ scenarios: CATALOG, previous: null, newEvidence: evidence, turn: 1 });
    // A second turn adding no evidence must not reorder or churn the state's
    // tracked list, or every diff and every shadow comparison is noise.
    const second = updateSparseState({ scenarios: CATALOG, previous: first, newEvidence: [], turn: 2 });
    assert.deepEqual(second.tracked.map((t) => t.scenarioId), first.tracked.map((t) => t.scenarioId));
});
