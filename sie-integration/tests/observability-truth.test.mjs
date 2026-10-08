/**
 * observability-truth.test.mjs — WP2: the trace tells the truth about every turn.
 * ------------------------------------------------------------
 * Drives the real runtime (helpers/runtime-world.mjs) through every route the
 * bridge has today, and checks the trace row each paid turn writes:
 *
 *   G-L9-1  one trace per paid turn, on every route
 *   G-L9-2  the trace's sent text is the reply actually returned
 *   G-L9-3  intent (decision) and executed outcome (action_result) are
 *           separate, and the outcome lists what really happened
 *   G-L9-4  with the trust boundary on, every trace carries its verdict —
 *           including "trusted" — or says it was not evaluated, and why
 *   G-L9-8  a failed trace write is surfaced, never silent
 *   G-L8-6  a failed commit is traced with committed:false
 *
 * All conversations are synthetic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeWorld, converse } from './helpers/runtime-world.mjs';

/** One conversation that walks every route (production settings). */
const EVERY_ROUTE = [
    'صباح الخير',                              // small talk
    'انا اسمي سامي',                           // memory (save)
    'مش قادر ادخل على حسابي',                  // diagnostic: evidence request
    'مش قادر ادخل على حسابي',                  // diagnostic: CREATE_TICKET → confirmation prompt
    'أيوه افتحلي تذكرة',                       // pending confirmation: accept
    'ازاي استخدم الـ API بتاعكم',               // diagnostic: ANSWER
    'تم الحل',                                 // resolution close
    'عايز اتكلم مع موظف',                      // escalation (asks before a ticket)
    'لأ مش دلوقتي'                             // pending confirmation: decline → hand-off (last: the chat is now a human's)
];

const routeOf = (t) => t.trace?.ranking?.route;

test('[G-L9-1] every paid turn writes exactly one trace, on every route', async () => {
    const world = makeWorld({ profile: 'production' });
    const turns = await converse(world, 'a', EVERY_ROUTE);
    assert.equal(world.quota, EVERY_ROUTE.length);
    assert.equal(world.traces.length, world.quota, 'traces == paid turns');
    for (const t of turns) assert.ok(t.trace, `no trace for "${t.say}"`);
    const routes = new Set(turns.map(routeOf));
    for (const r of ['small_talk', 'memory', 'escalation', 'pending_confirmation', 'diagnostic', 'resolution_close']) {
        assert.ok(routes.has(r), `route ${r} not traced (saw ${[...routes].join(', ')})`);
    }
});

test('[G-L9-2] the trace records the reply that was actually sent, on every route', async () => {
    const world = makeWorld({ profile: 'production' });
    const turns = await converse(world, 'a', EVERY_ROUTE);
    for (const t of turns) {
        assert.equal(t.trace.rendered.responseText, t.reply, `"${t.say}": trace text differs from the sent reply`);
        assert.deepEqual(t.trace.rendered.options, t.options, `"${t.say}": trace options differ from the sent options`);
    }
});

test('[G-L9-3] a proposed ticket is intent; only the confirmed one is an executed effect', async () => {
    const world = makeWorld({ profile: 'production' });
    const [, ask, yes] = await converse(world, 'a', ['مش قادر ادخل على حسابي', 'مش قادر ادخل على حسابي', 'أيوه افتحلي تذكرة']);

    // The decision proposed a ticket; what executed was a persisted question.
    assert.equal(ask.trace.decision.action, 'CREATE_TICKET');
    assert.equal(ask.trace.action_result.committed, true);
    assert.deepEqual(ask.trace.action_result.effects.map((e) => e.type), ['persist_reply']);
    assert.ok(ask.trace.rendered.intendedText && ask.trace.rendered.intendedText !== ask.reply,
        'the text the decision rendered is kept separately from the text sent');

    // The accept turn is the one where a ticket really exists.
    const created = yes.trace.action_result.effects.find((e) => e.type === 'create_ticket');
    assert.ok(created && created.ok === true && created.ticketNumber, 'the accepted ticket is an executed effect with its number');
    assert.equal(world.ticketsCreated.length, 1);
});

test('[G-L9-3] effects outside the turn commit are recorded too: review queue and hand-off', async () => {
    const world = makeWorld({ profile: 'production' });
    const [, decline] = await converse(world, 'a', ['عايز اتكلم مع موظف', 'لأ مش دلوقتي']);
    const types = decline.trace.action_result.effects.map((e) => `${e.type}:${e.ok}`);
    assert.deepEqual(types, ['queue_review:true', 'persist_reply:true', 'request_handoff:true']);
});

test('[G-L9-3] each trace says which layers ran, and which a route skipped', async () => {
    const world = makeWorld({ profile: 'production' });
    const [greet, problem] = await converse(world, 'a', ['صباح الخير', 'مش قادر ادخل على حسابي']);
    const status = (t) => Object.fromEntries(t.trace.ranking.layers.map((l) => [l.layer, l.status]));

    assert.deepEqual(status(problem), { L1: 'ran', L2: 'ran', L3: 'ran', L4: 'ran', L5: 'ran', L6: 'ran', L7: 'ran', L8: 'ran', L9: 'ran' });
    const g = status(greet);
    assert.equal(g.L1, 'ran');
    // WP4: a greeting is not diagnosed, but it IS decided (Layer 5's social
    // rule) and worded by Dialogue (Layer 6). Before WP4 the bridge answered
    // it directly: L5 "skipped", L6 "bypassed".
    for (const l of ['L2', 'L3', 'L4']) assert.equal(g[l], 'skipped', `${l} on a greeting`);
    assert.equal(g.L5, 'ran', 'the route is a Layer-5 decision');
    assert.equal(g.L6, 'ran', 'the greeting text comes from Dialogue');
    assert.equal(g.L7, 'ran', 'the customer\'s name is a Layer-7 read (memory_remember_name)');
    assert.equal(g.L8, 'ran');
    for (const l of greet.trace.ranking.layers.filter((x) => x.status !== 'ran')) assert.ok(l.reason, `${l.layer} ${l.status} without a reason`);
});

test('[G-L9-4] with the trust boundary on, a clean diagnostic turn records "trusted"', async () => {
    const world = makeWorld({ profile: 'production' });
    const [t] = await converse(world, 'a', ['مش قادر ادخل على حسابي']);
    assert.equal(t.trace.ranking.trust?.enforced?.level, 'trusted');
});

test('[G-L9-4] every route passes the trust checkpoint and records its verdict — the escalation and the ticket answer included', async () => {
    // Before WP4 the escalation and pending-answer routes returned before CP1
    // and were traced "not_evaluated". WP4 runs CP1 on every turn.
    const world = makeWorld({ profile: 'production' });
    const turns = await converse(world, 'a', ['صباح الخير', 'عايز اتكلم مع موظف', 'لأ مش دلوقتي']);
    for (const t of turns) {
        const trust = t.trace.ranking.trust;
        assert.ok(trust && trust.status !== 'not_evaluated', `"${t.say}" (${t.trace.ranking.route}) has no trust verdict`);
        assert.ok((trust.enforced ?? trust.observed)?.level, `"${t.say}": the verdict carries a level`);
    }
});

test('[G-L9-4] with the trust boundary off, the trace carries no trust field', async () => {
    const world = makeWorld({ profile: 'defaults' });
    const [t] = await converse(world, 'a', ['مش قادر ادخل على حسابي']);
    assert.equal(t.trace.ranking.trust, undefined);
});

test('[G-L8-6] a failed commit is traced with committed:false, and the customer gets no reply from SIE', async () => {
    const world = makeWorld({ profile: 'production', failRpcs: ['persist_bot_turn'] });
    const [t] = await converse(world, 'a', ['مش قادر ادخل على حسابي']);
    assert.equal(t.reply, null, 'the caller falls back, exactly as before');
    assert.equal(world.quota, 1, 'the turn was paid for (truthful charging is WP8)');
    assert.ok(t.trace, 'the paid, failed turn is still traced');
    assert.equal(t.trace.action_result.committed, false);
    assert.equal(t.trace.action_result.delivered, false);
    assert.equal(t.trace.rendered.responseText, null);
    assert.ok(t.trace.action_result.effects.some((e) => e.type === 'persist_reply' && e.ok === false && e.error));
});

test('[G-L9-8] a failed trace write is surfaced: logged and reported on the result', async () => {
    const world = makeWorld({ profile: 'production', failTraceInsert: true });
    const [t] = await converse(world, 'a', ['مش قادر ادخل على حسابي']);
    assert.ok(t.reply, 'a trace failure never costs the customer their reply');
    assert.equal(t.traceWritten, false);
    assert.equal(world.failedTraceInserts, 1);
    assert.ok(world.consoleErrors.some((e) => e.includes('[sie] trace write failed')), 'logged as an error');
});

test('[G-L9-8] a successful trace write is reported as written', async () => {
    const world = makeWorld({ profile: 'production' });
    const [t] = await converse(world, 'a', ['مش قادر ادخل على حسابي']);
    assert.equal(t.traceWritten, true);
});
