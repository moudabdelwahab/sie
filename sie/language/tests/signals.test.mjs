/**
 * signals.test.mjs — G-L1-3 (no discarded content) and G-L1-8 (determinism
 * and totality), on the real glossary.
 *
 * The audit (F3, F4): «اهلا الواتساب واقف» was answered as a greeting and the
 * outage was never diagnosed; «انا المدير ومش قادر اضيف موظف» stored the
 * customer's name as «ال» and the problem was never diagnosed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readMessage } from './helpers/read-signals.js';

const corpus = JSON.parse(fs.readFileSync(new URL('./fixtures/precision-corpus.json', import.meta.url), 'utf8'));
const GREETINGS = ['اهلا', 'مرحبا', 'السلام عليكم', 'صباح الخير', 'هاي', 'ازيك', 'شكرا'];

test('[G-L1-3] a pleasantry followed by a problem keeps the problem: diagnostic content, not whole-message small talk', async () => {
    const r = await readMessage('اهلا الواتساب واقف');
    assert.equal(r.signals.diagnosticContent, true);
    assert.equal(r.signals.smallTalk?.type, 'greeting', 'the greeting is still seen');
    assert.equal(r.signals.smallTalk?.coversWholeMessage, false, 'but it does not cover the message');
    const wrong = [];
    for (const core of corpus.cores) {
        for (const g of GREETINGS) {
            const { signals } = await readMessage(`${g} ${core}`);
            if (signals.smallTalk?.coversWholeMessage) wrong.push(`${g} ${core}`);
        }
    }
    assert.deepEqual(wrong, []);
});

test('[G-L1-3] property: whenever a problem token is present, diagnosticContent is true', async () => {
    const wrong = [];
    for (const core of corpus.cores) {
        const { normalizedTokens, signals } = await readMessage(`اهلا ${core}`);
        const problem = normalizedTokens.some((t) => /^(entity|symptom|intent|http|qualifier|atom)_/.test(t.canonical));
        if (problem !== signals.diagnosticContent) wrong.push(core);
    }
    assert.deepEqual(wrong, []);
});

test('[G-L1-3] a pleasantry on its own covers the whole message', async () => {
    for (const text of ['اهلا', 'مرحبا يا باشا', 'شكرا جزيلا', 'صباح الخير', 'ازيك عامل ايه', 'معلش', 'انت مين؟', 'السلام عليكم ورحمة الله', 'شكرا يا فندم']) {
        const { signals } = await readMessage(text);
        assert.equal(signals.diagnosticContent, false, text);
        assert.equal(signals.smallTalk?.coversWholeMessage, true, text);
    }
});

test('[G-L1-3] a pleasantry plus words it does not explain is not whole-message small talk, even without a glossary token', async () => {
    const { signals } = await readMessage('شكرا، الحل ماشتغلش');
    assert.notEqual(signals.smallTalk?.coversWholeMessage, true);
});

test('[G-L1-3] "I am the manager and cannot add an employee" is a problem, not a self-introduction', async () => {
    const { signals } = await readMessage('انا المدير ومش قادر اضيف موظف');
    const memory = signals.memory;
    assert.ok(!memory || (!memory.explicit && !memory.standalone), `memory=${JSON.stringify(memory)}`);
    assert.ok(!(memory?.facts || []).some((f) => f.key === 'name'), 'no name is read out of «المدير»');
});

test('[G-L1-3] a self-introduction on its own is still one; an explicit save on its own is explicit', async () => {
    const intro = (await readMessage('انا احمد')).signals.memory;
    assert.equal(intro?.standalone, true);
    assert.equal(intro?.explicit, false);
    assert.deepEqual(intro.facts, [{ key: 'name', value: 'احمد' }]);
    const save = (await readMessage('احفظ ده', { previousText: 'اسمي سامي' })).signals.memory;
    assert.equal(save?.explicit, true);
    // A save request that carries a problem is the problem.
    const report = (await readMessage('سجل عندك ان الدفع اتخصم مرتين')).signals.memory;
    assert.ok(!report || (!report.explicit && !report.standalone), `memory=${JSON.stringify(report)}`);
});

test('[G-L1-8] Layer 1 is deterministic and total', async () => {
    const inputs = [null, undefined, '', '   ', 0, 42, true, {}, [], ['اهلا'], { text: 'x' }, '؟', '😡😡😡', '‏‎اهلا',
        'ﻻ', 'a'.repeat(20000), 'مش '.repeat(3000), '𐀀\ud800', 'اهلا\n\nالواتساب\tواقف', 'SELECT * FROM users; --',
        'انا '.repeat(100), 'و'.repeat(500), '١٢٣٤٥', 'eshtrak mesh sha3'];
    for (const input of inputs) {
        const a = await readMessage(input);
        const b = await readMessage(input);
        assert.deepEqual(a, b, `not deterministic for ${JSON.stringify(String(input)).slice(0, 40)}`);
        assert.equal(typeof a.signals.diagnosticContent, 'boolean');
        assert.ok(['yes', 'no', null].includes(a.signals.replyPolarity));
    }
});
