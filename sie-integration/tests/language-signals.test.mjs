/**
 * language-signals.test.mjs — G-L1-6 end to end.
 *
 * Layer 1 is the only place a message is classified, and it classifies what
 * it actually read. Before WP3 the bridge ran its detectors on the raw text
 * it was handed while diagnosis ran on the truncated text normalize() kept,
 * so words past the input cap — words the engine never "read" — could still
 * route the turn to a human.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeWorld, converse } from './helpers/runtime-world.mjs';
import { TEXT } from './helpers/golden-runner.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('[G-L1-6] text past the input cap is not classified: it cannot escalate the turn, and the trace says the message was truncated', async () => {
    const world = makeWorld({ profile: 'production' });
    const text = `الواتساب مش بيبعت رسايل ${'تفاصيل '.repeat(1200)}هرفع عليكم قضية`;
    assert.ok(text.length > 8000, 'the threat sits past the 8,000-character cap');
    const [turn] = await converse(world, 'a', [{ say: text }]);
    assert.ok(!String(turn.reply).includes(TEXT.ESCALATION), `escalated on unread text: "${String(turn.reply).slice(0, 60)}"`);
    assert.equal(world.handoffs.length, 0);
    const language = turn.trace?.normalized_tokens?.language;
    assert.equal(language?.truncated, true, 'the trace records that Layer 1 read only part of the message');
    assert.equal(language?.receivedChars, text.length);
});

test('[G-L1-6] the same threat inside the cap is still read', async () => {
    const world = makeWorld({ profile: 'production' });
    const [turn] = await converse(world, 'a', [{ say: 'الواتساب مش بيبعت رسايل وهرفع عليكم قضية' }]);
    assert.ok(String(turn.reply).includes(TEXT.ESCALATION), 'control: within the cap, anger escalates as configured');
    assert.equal(turn.trace?.normalized_tokens?.language?.truncated, false);
});

test('[G-L1-6] no consumer classifies raw text: the bridge and the vNext interpretation read Layer-1 signals only', () => {
    const DETECTORS = /\b(detectSmallTalk|detectEmotion|detectResolutionSignal|detectMemoryIntent|classifyTicketConfirmationReply)\s*\(/g;
    for (const file of ['sie-integration/sie-chat-bridge.js', 'sie/pipeline/interpretation.js']) {
        const calls = [...read(file).matchAll(DETECTORS)].map((m) => m[1]);
        assert.deepEqual(calls, [], `${file} calls a detector directly`);
    }
    // And the signals are computed from what normalize() kept.
    assert.match(read('sie-integration/sie-chat-bridge.js'), /analyzeSignals\(\{\s*text:\s*language\.rawText/);
    assert.match(read('sie/pipeline/pipeline.js'), /analyzeSignals\(\{\s*text:\s*normalized\.rawText/);
});
