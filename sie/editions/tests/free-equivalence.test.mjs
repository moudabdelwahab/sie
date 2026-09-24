/**
 * Free through the edition path (scoped retrieval, top-K, evidence cap,
 * message bound) must decide exactly what today's full-scan engine decides.
 * This is the gate that lets the bridge enable `retrieval_scoped_diagnosis`
 * by default — see bench/edition-equivalence.mjs for the full-size run.
 *
 * @no-legitimate-corpus
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runEquivalence } from '../../../bench/edition-equivalence.mjs';

test('Free on the edition path = today\'s engine, turn by turn', async () => {
    const { summary, diffs } = await runEquivalence({ edition: 'free', conversations: 400, log: () => {} });
    assert.ok(summary.turns > 7000, `the corpus shrank: ${summary.turns} turns`);
    assert.deepEqual(diffs.slice(0, 5), [], `${diffs.length} turns differ`);
});
