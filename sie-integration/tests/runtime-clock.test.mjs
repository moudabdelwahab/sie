/**
 * runtime-clock.test.mjs — the turn's clock is injectable, and only that.
 * ------------------------------------------------------------
 * WP1 threads an optional `clock` (epoch ms) through getSieReply →
 * runSieTurn into the time-based decisions the bridge makes: context expiry,
 * the stamped lastTurnAt, the decision timestamp and the past-conversation
 * window. These prove that the injected time is what those decisions use,
 * and that omitting the clock keeps today's behaviour (real time).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeWorld, converse } from './helpers/runtime-world.mjs';
import { getSieReply } from '../sie-runtime.js';

test('[T-2] lastTurnAt and the decision timestamp are the injected clock', async () => {
    const world = makeWorld({ profile: 'production' });
    const [turn] = await converse(world, 'a', ['مش قادر ادخل على حسابي']);
    const at = new Date(world.now).toISOString();
    assert.equal(turn.state.sie.lastTurnAt, at);
    assert.equal(turn.trace.decision.timestamp, at);
});

test('[T-2] without a clock the runtime still uses real time (behaviour unchanged)', async () => {
    const world = makeWorld({ profile: 'defaults' });
    const before = Date.now();
    const result = await getSieReply({ text: 'مش قادر ادخل على حسابي', supabase: world.client, sessionId: 's', userId: 'u', botState: {} });
    const stamped = Date.parse(result.botState.sie.lastTurnAt);
    assert.ok(stamped >= before && stamped <= Date.now(), 'stamped with the real clock');
});

// production: memory_context_minutes = 245
for (const [minutes, expired] of [[244, false], [246, true]]) {
    test(`[T-2] context expiry is decided by the injected clock: ${minutes} min after the last turn → ${expired ? 'expired' : 'kept'}`, async () => {
        const world = makeWorld({ profile: 'production' });
        await converse(world, 'a', ['مش قادر ادخل على حسابي']);
        const [greeting] = await converse(world, 'a', [{ say: 'صباح الخير', advanceMinutes: minutes }]);
        // The last-issue question appears only once the context has expired.
        assert.equal(greeting.reply.includes('آخر مرة'), expired, greeting.reply);
    });
}

test('[T-2] the past-conversation window is measured on the injected clock', async () => {
    // The audited configuration imports the previous chat's evidence when it is
    // inside memory_context_minutes (245). Outside it, nothing is imported.
    const inside = makeWorld({ profile: 'production-audit-2026-10' });
    await converse(inside, 'first', ['لا مفيش حاجة تانية']);
    const [near] = await converse(inside, 'second', [{ say: 'مين صاحب المنصة', advanceMinutes: 30 }]);
    assert.ok(near.trace.hypotheses.some((h) => h.scenarioId === 'convo_goodbye_nothing_else'), 'imported inside the window');

    const outside = makeWorld({ profile: 'production-audit-2026-10' });
    await converse(outside, 'first', ['لا مفيش حاجة تانية']);
    const [far] = await converse(outside, 'second', [{ say: 'مين صاحب المنصة', advanceMinutes: 300 }]);
    assert.ok(!far.trace.hypotheses.some((h) => h.scenarioId === 'convo_goodbye_nothing_else'), 'not imported outside the window');
});
