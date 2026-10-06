/**
 * precision-corpus.test.mjs — G-L1-7.
 *
 * Real problem statements must reach diagnosis. On the synthetic corpus
 * (every core × every frame in fixtures/precision-corpus.json, plus every
 * problem label in the shipped catalog), Layer 1 must report none of the
 * signals that take a turn away from diagnosis:
 *   - whole-message small talk;
 *   - a request for a human, or bot-frustration (both escalate);
 *   - an escalating emotion (anger, sarcasm);
 *   - a positive resolution;
 *   - an explicit memory capture, or a self-introduction standing alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMessage } from './helpers/read-signals.js';
import { ESCALATING_EMOTIONS } from '../emotion-detector.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'precision-corpus.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'scenarios', 'scenario-catalog.data', 'scenarios.json'), 'utf8'));

export function precisionCorpus() {
    const synthetic = corpus.cores.flatMap((core) => corpus.frames.map((f) => f.replace('{core}', core)));
    const labels = (Array.isArray(catalog) ? catalog : catalog.scenarios)
        .filter((s) => !s.id.startsWith('convo_') && s.label?.ar)
        .map((s) => s.label.ar);
    return [...new Set([...synthetic, ...labels])];
}

function violations(signals) {
    const v = [];
    if (signals.smallTalk?.coversWholeMessage) v.push(`small talk (${signals.smallTalk.type})`);
    if (signals.smallTalk?.type === 'human_request' || signals.humanRequest) v.push('human request');
    if (signals.smallTalk?.type === 'frustration') v.push('bot frustration');
    if (signals.emotion && ESCALATING_EMOTIONS.includes(signals.emotion.emotion)) v.push(`emotion ${signals.emotion.emotion} (${signals.emotion.matched})`);
    if (signals.resolution === 'resolved') v.push('resolved');
    if (signals.memory?.explicit || signals.memory?.standalone) v.push(`memory ${signals.memory.kind}`);
    return v;
}

test('[G-L1-7] no real problem statement is taken away from diagnosis by a Layer-1 signal', async () => {
    const messages = precisionCorpus();
    assert.ok(messages.length >= 300, `the plan requires at least 300 statements; there are ${messages.length}`);
    const wrong = [];
    for (const m of messages) {
        const v = violations((await readMessage(m)).signals);
        if (v.length) wrong.push(`${m} → ${v.join(', ')}`);
    }
    assert.deepEqual(wrong, [], `${wrong.length} of ${messages.length} statements misread`);
});
