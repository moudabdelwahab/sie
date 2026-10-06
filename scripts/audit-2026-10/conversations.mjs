// End-to-end reproductions for docs/AUDIT-SIE-9-LAYERS-2026-10.md.
//
// Every conversation here is SYNTHETIC: written for the audit to trigger the
// same mechanism a production conversation triggered, never copied from one.
// Each case drives the real getSieReply -> runSieTurn with the production
// settings snapshot in harness.mjs and checks the defect's observable symptom.
//
// These are AUDIT reproductions, not regression tests: a case reports
// REPRODUCED while the defect exists. The regression tests live in
// sie-integration/tests/golden/regressions.json. When a work package fixes a
// finding, record it in FIXED below.
//
//   node scripts/audit-2026-10/conversations.mjs            summary table
//   node scripts/audit-2026-10/conversations.mjs --verbose  plus full per-turn traces
import { makeWorld, converse, show } from './harness.mjs';

const VERBOSE = process.argv.includes('--verbose');
const CONFIRM = 'تحب أفتحلك تذكرة';
const results = [];

async function finding(id, title, fn) {
    let reproduced = false; let detail = '';
    try { ({ reproduced, detail } = await fn()); } catch (err) { detail = `ERROR ${err?.message || err}`; }
    results.push({ id, title, reproduced, detail });
}
const log = (title, rows) => { if (VERBOSE) show(title, rows); };
const quiet = async (fn) => { const w = console.warn, i = console.info; console.warn = () => {}; console.info = () => {}; try { return await fn(); } finally { console.warn = w; console.info = i; } };
const lastTrace = (r) => r.traced;
// "The turn never reached diagnosis." Before WP2 such turns wrote no trace at
// all; since WP2 every paid turn is traced and carries its route, so the
// symptom is the route, not the absence of a trace.
const shortCircuited = (r) => !r.traced || (r.traced.ranking?.route && r.traced.ranking.route !== 'diagnostic');
const rule = (r) => (r.traced?.decision?.evaluatedRules || []).find((x) => x.matched)?.rule;

await quiet(async () => {

// ---- Trace A: happy path, every layer contributes (control case)
await finding('A', 'Happy path: pricing question answered from static knowledge (control)', async () => {
    const w = makeWorld();
    const r = await converse(w, 'a', ['بكام الاشتراك؟ عايز اعرف الاسعار']);
    log('Trace A', r);
    const t = lastTrace(r[0]);
    return { reproduced: t?.decision?.action === 'ANSWER' && t?.knowledge_data?.source === 'pricing',
        detail: `${t?.decision?.action} ${t?.decision?.scenarioId} knowledge=${t?.knowledge_data?.source}` };
});

// ---- Trace B: cross-conversation contamination (synthetic equivalent of the production chain)
await finding('B', 'Cross-chat contamination: a closing remark in chat 1 becomes the "problem" ticketed in chats 2 and 3', async () => {
    const w = makeWorld({ edition: 'max' });
    const a = await converse(w, 'chat-1', ['صباح الخير', 'احكيلي عن مدعوم', 'مفيش مشكلة، بس عندي سؤال عام عن المنصة', 'لا مفيش حاجة تانية']);
    const b = await converse(w, 'chat-2', ['هاي', 'مين صاحب المنصة', 'حسابي عنده مشكلة', 'لأ مش دلوقتي', 'متشكر', 'وضحلي الـ api']);
    const c = await converse(w, 'chat-3', ['وضحلي الـ api', 'لأ مش دلوقتي', 'ازاي استخدم الـ API بتاعكم']);
    log('Trace B chat-1', a); log('Trace B chat-2', b); log('Trace B chat-3', c);
    // Chat 2: the first diagnosed message ("who owns the platform") is offered a
    // ticket about chat 1's closing remark; the customer's next message ("my
    // account has a problem") is then consumed as a DECLINE of that prompt
    // (مش inside مشكلة). Chat 3: the very first message is offered the same ticket.
    const b2 = b[1].traced?.decision, c1 = c[0].traced?.decision;
    const ok = b2?.action === 'CREATE_TICKET' && b2?.scenarioId === 'convo_goodbye_nothing_else'
        && b[1].reply.includes(CONFIRM) && shortCircuited(b[2]) && w.reviews.length >= 1
        && c1?.action === 'CREATE_TICKET' && c1?.scenarioId === 'convo_goodbye_nothing_else' && c[0].reply.includes(CONFIRM);
    const all = [...a, ...b, ...c]; const traced = all.filter((x) => x.traced).length;
    return { reproduced: ok, detail: `chat-2 turn 2: ${b2?.action}/${b2?.scenarioId}; chat-2 turn 3 consumed as decline (reviews ${w.reviews.length}); chat-3 turn 1: ${c1?.action}/${c1?.scenarioId}; traced ${traced}/${all.length} paid turns; tickets created ${w.ticketsCreated.length}` };
});

await finding('B2', 'Cross-chat contamination: ticket-status chat makes a subscription-status chat tie 1.00/1.00 and go to a ticket', async () => {
    const w = makeWorld();
    await converse(w, 't', ['ايه حالة التذكرة بتاعتي؟']);
    const r = await converse(w, 'u', ['ايه حالة الاشتراك بتاعي؟']);
    log('Trace B2', r);
    const hyp = (r[0].traced?.hypotheses || []).filter((h) => h.confidence >= 0.99).map((h) => h.scenarioId);
    return { reproduced: r[0].traced?.decision?.action === 'CREATE_TICKET' && hyp.includes('ticket_status_inquiry'),
        detail: `${r[0].traced?.decision?.action} via ${rule(r[0])}; at 1.00: ${hyp.join(', ')}` };
});

// ---- Trace C: false resolution
await finding('C', '"Tried the steps but it didn\'t work" after an answer -> "glad it\'s sorted" and state wiped', async () => {
    const w = makeWorld();
    const r = await converse(w, 'c', ['ازاي استخدم الـ API بتاعكم', 'جربت الخطوات بس ما اشتغلش', 'طب اعمل ايه']);
    log('Trace C', r);
    return { reproduced: r[0].traced?.decision?.action === 'ANSWER' && r[1].reply.includes('مبسوط') && shortCircuited(r[1]) && !r[1].sie?.diagnosticState,
        detail: `turn 2 reply: "${r[1].reply.split('\n')[0]}"; state after: ${r[1].sie?.diagnosticState ? 'kept' : 'wiped'}` };
});

await finding('C2', 'Same negated phrase before any answer -> contradictory "glad it sorted" prefix on a clarifying question', async () => {
    const w = makeWorld();
    const r = await converse(w, 'c2', ['مش بقدر ابعت رسايل للجروبات', 'جربت الحل بس ما اشتغلش']);
    log('Trace C2', r);
    // Turn 1 also shows the threshold effect: the canonical phrasing scores 0.64,
    // one hundredth under production's answer_confidence of 0.65.
    return { reproduced: r[0].traced?.decision?.confidence < 0.65 && r[1].reply.includes('مبسوط') && r[1].traced?.decision?.action === 'ASK_CLARIFYING_QUESTION',
        detail: `turn 1 conf ${r[0].traced?.decision?.confidence?.toFixed(2)} (< 0.65, not answerable); turn 2: ${r[1].traced?.decision?.action}, reply starts "${r[1].reply.split('\n')[0]}"` };
});

// ---- Confirmation classifier
await finding('D1', 'Plain "لا" / "اه" at the ticket prompt re-asks forever (\\b never matches Arabic)', async () => {
    const w = makeWorld();
    const r = await converse(w, 'd1', ['عايز اتكلم مع موظف', 'لا', 'لا', 'اه']);
    log('Trace D1', r);
    return { reproduced: r.slice(1).every((x) => x.reply.includes(CONFIRM)) && w.reviews.length === 0 && w.ticketsCreated.length === 0,
        detail: `3 answers -> ${r.slice(1).filter((x) => x.reply.includes(CONFIRM)).length} re-asks; reviews ${w.reviews.length}, tickets ${w.ticketsCreated.length}` };
});

await finding('D2', '"أيوه عندي مشكلة…" at the prompt is a DECLINE (/مش/ inside مشكلة)', async () => {
    const w = makeWorld();
    const r = await converse(w, 'd2', ['عايز اتكلم مع موظف', 'أيوه عندي مشكلة في الدفع']);
    log('Trace D2', r);
    return { reproduced: w.reviews.length === 1 && w.ticketsCreated.length === 0,
        detail: `reply "${r[1].reply.slice(0, 40)}…"; reviews ${w.reviews.length}, tickets ${w.ticketsCreated.length}` };
});

await finding('D3', 'Restating the problem at the prompt counts as declining it', async () => {
    const w = makeWorld();
    const r = await converse(w, 'd3', ['الواتساب مش بيبعت رسايل', 'الواتساب مش بيبعت رسايل', 'الواتساب مش بيبعت رسايل']);
    log('Trace D3', r);
    return { reproduced: r[1].reply.includes(CONFIRM) && w.reviews.length === 1 && w.ticketsCreated.length === 0,
        detail: `turn 2 prompt, turn 3 -> reviews ${w.reviews.length}, tickets ${w.ticketsCreated.length}` };
});

// ---- Phantom ticket
await finding('E', 'Phantom ticket: decline, then "yes" later -> "the ticket we opened is still active", 0 tickets', async () => {
    const w = makeWorld();
    const msg = 'مش قادر ادخل على حسابي';
    const r = await converse(w, 'e', [msg, msg, 'لأ مش دلوقتي', msg, 'أيوه، افتحلي تذكرة']);
    log('Trace E', r);
    return { reproduced: w.ticketsCreated.length === 0 && r[4].reply.includes('لسه شغالة') && r[0].traced?.decision?.action === 'ASK_FOR_SCREENSHOT',
        detail: `turn1 ${r[0].traced?.decision?.action} (no attachment path), final reply "${r[4].reply.slice(0, 45)}…", tickets created ${w.ticketsCreated.length}` };
});

// ---- Emotion / small talk / memory pre-emption
await finding('F1', '"How do I install WhatsApp" -> anger -> immediate human escalation (نصب inside انصب)', async () => {
    const w = makeWorld();
    const r = await converse(w, 'f1', ['ازاي انصب الواتساب بزنس']);
    log('Trace F1', r);
    return { reproduced: r[0].reply.includes('هوصلك بفريق الدعم') && shortCircuited(r[0]), detail: `reply "${r[0].reply.slice(0, 50)}…"` };
});

await finding('F2', 'Sincere praise -> sarcasm -> escalation', async () => {
    const w = makeWorld();
    const r = await converse(w, 'f2', ['انا مبسوط جدا بصراحة']);
    log('Trace F2', r);
    return { reproduced: r[0].reply.includes('هوصلك بفريق الدعم'), detail: `reply "${r[0].reply.slice(0, 50)}…"` };
});

await finding('F3', 'Greeting + real problem -> greeting reply, problem discarded, no trace', async () => {
    const w = makeWorld();
    const r = await converse(w, 'f3', ['اهلا الواتساب واقف']);
    log('Trace F3', r);
    return { reproduced: shortCircuited(r[0]) && r[0].reply.includes('أهلاً'), detail: `reply "${r[0].reply.split('\n').pop().slice(0, 50)}…"` };
});

await finding('F4', '"I\'m the manager and can\'t add an employee" -> saved as name "ال", never diagnosed', async () => {
    const w = makeWorld();
    const r = await converse(w, 'f4', ['انا المدير ومش قادر اضيف موظف']);
    log('Trace F4', r);
    return { reproduced: r[0].reply.includes('حفظتها') && shortCircuited(r[0]), detail: `stored facts: ${JSON.stringify(w.facts)}` };
});

// ---- Pending prompt expiry
await finding('G', 'Escalation prompt never expires (no lastTurnAt): next-day greeting gets the ticket question', async () => {
    const realNow = Date.now;
    const w = makeWorld();
    await converse(w, 'g', ['عايز اتكلم مع موظف']);
    const hasStamp = Boolean(w.sessions.g.botState.sie?.lastTurnAt);
    Date.now = () => realNow() + 24 * 3600 * 1000;
    let r; try { r = await converse(w, 'g', ['صباح الخير']); } finally { Date.now = realNow; }
    log('Trace G', r);
    return { reproduced: !hasStamp && r[0].reply.includes(CONFIRM), detail: `lastTurnAt written: ${hasStamp}; next-day reply "${r[0].reply.slice(0, 35)}…"` };
});

// ---- Knowledge
await finding('H', 'Ticket status with an open ticket -> permanent "can\'t find your data, try later" (live stub)', async () => {
    const w = makeWorld({ openTickets: [{ ticket_number: 77, title: 'x', status: 'open' }] });
    const r = await converse(w, 'h', ['ايه حالة التذكرة بتاعتي؟']);
    log('Trace H', r);
    return { reproduced: r[0].traced?.decision?.action === 'ANSWER' && r[0].reply.includes('مش لاقي بيانات'),
        detail: `${r[0].traced?.decision?.scenarioId} -> "${r[0].reply.split('\n')[0].slice(0, 50)}…"` };
});

// ---- Decision
await finding('I', 'Any new detail after an ANSWER is read as "the solution failed" -> ticket (R6B)', async () => {
    const w = makeWorld();
    const r = await converse(w, 'i', ['رسايل الجروبات مش بتتبعت', 'في جروب العملاء']);
    log('Trace I', r);
    return { reproduced: r[0].traced?.decision?.action === 'ANSWER' && rule(r[1]) === 'R6B_ALREADY_ANSWERED' && r[1].traced?.decision?.action === 'CREATE_TICKET',
        detail: `turn 1 ${r[0].traced?.decision?.action}; turn 2 (a detail, not a complaint) ${r[1].traced?.decision?.action} via ${rule(r[1])}` };
});

await finding('I2', 'R6C never fires: maxSimultaneousResolvable is Infinity', async () => {
    const w = makeWorld();
    const r = await converse(w, 'i2', ['بكام الاشتراك؟ عايز اعرف الاسعار']);
    const r6c = (r[0].traced?.decision?.evaluatedRules || []).find((x) => x.rule === 'R6C_NON_DISCRIMINATING_EVIDENCE');
    return { reproduced: /Infinity/.test(r6c?.detail || ''), detail: r6c?.detail || 'rule not evaluated' };
});

// ---- Trust boundary
await finding('J', 'Genuine multi-problem message under trust enforce -> quarantined, all evidence dropped', async () => {
    const w = makeWorld();
    const long = 'السلام عليكم، عندي مشكلة من امبارح الواتساب مش بيبعت رسايل للعملاء والاشتراك مدفوع والفاتورة اتخصمت وكمان الموظفين مش قادرين يدخلوا الحساب والداشبورد مش بيحمل والتذاكر مش بتتفتح والرسايل بتتأخر والـ API بيرجع 429 والويبهوك مش بيوصل';
    const r = await converse(w, 'j', [long]);
    log('Trace J', r);
    const lvl = r[0].traced?.ranking?.trust?.enforced?.level;
    return { reproduced: lvl === 'quarantined' && (r[0].traced?.hypotheses || []).length === 0,
        detail: `trust=${lvl}; hypotheses scored: ${(r[0].traced?.hypotheses || []).length}; decision ${r[0].traced?.decision?.action}` };
});

// ---- Observability
await finding('K1', 'Trace records intent, not outcome: trace says CREATE_TICKET, customer saw the confirmation prompt', async () => {
    const w = makeWorld();
    const msg = 'مش قادر ادخل على حسابي';
    const r = await converse(w, 'k1', [msg, msg]);
    const t = r[1].traced;
    return { reproduced: t?.decision?.action === 'CREATE_TICKET' && t?.rendered?.responseText !== r[1].reply && r[1].reply.includes(CONFIRM) && w.ticketsCreated.length === 0,
        detail: `trace responseText "${(t?.rendered?.responseText || '').slice(0, 30)}…" vs sent "${r[1].reply.slice(0, 30)}…"` };
});

await finding('K2', 'Shadow comparison cannot agree: the only diff is the structural "kind" field', async () => {
    const w = makeWorld();
    const r = await converse(w, 'k2', ['بكام الاشتراك؟ عايز اعرف الاسعار']);
    const s = r[0].traced?.ranking?.shadow;
    const fields = (s?.diff || []).map((d) => d.field);
    return { reproduced: s?.agreed === false && fields.length === 1 && fields[0] === 'kind', detail: `agreed=${s?.agreed}, diff fields=${JSON.stringify(fields)}` };
});

await finding('K3', 'Short-circuit turns write no trace (coverage)', async () => {
    const w = makeWorld();
    const r = await converse(w, 'k3', ['صباح الخير', 'انت بوت', 'عايز اتكلم مع موظف', 'لأ مش دلوقتي', 'رسايل الجروبات مش بتتبعت']);
    const traced = r.filter((x) => x.traced).length;
    return { reproduced: traced < r.length, detail: `${traced} traces for ${w.quota} paid turns` };
});

});

// Findings fixed in the engine, by the work package that fixed them. A fixed
// finding must NOT reproduce; every other finding still must. Either kind of
// surprise exits non-zero.
const FIXED = Object.freeze({
    K1: 'WP2', K2: 'WP2', K3: 'WP2',
    C: 'WP3', C2: 'WP3', D1: 'WP3', D2: 'WP3', F1: 'WP3', F3: 'WP3', F4: 'WP3',
    // The decline is gone; the restated problem is still not diagnosed at
    // the prompt (REG-D3 stays red for WP4).
    D3: 'WP3, decline part only'
});

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n${pad('id', 4)} ${pad('status', 14)} finding`);
for (const f of results) {
    const status = f.reproduced ? 'REPRODUCED' : (FIXED[f.id] ? `fixed (${FIXED[f.id]})` : 'not reproduced');
    console.log(`${pad(f.id, 4)} ${pad(status, 14)} ${f.title}\n${' '.repeat(20)}${f.detail}`);
}
const reappeared = results.filter((f) => f.reproduced && FIXED[f.id]);
const vanished = results.filter((f) => !f.reproduced && !FIXED[f.id]);
const open = results.filter((f) => f.reproduced).length;
console.log(`\n${open}/${results.length} findings still reproduce; ${Object.keys(FIXED).length} fixed (${Object.keys(FIXED).join(', ')}).`);
if (reappeared.length) console.log(`REGRESSION: fixed finding(s) reproduce again: ${reappeared.map((f) => f.id).join(', ')}`);
if (vanished.length) console.log(`UNEXPECTED: finding(s) no longer reproduce but are not recorded as fixed: ${vanished.map((f) => f.id).join(', ')}`);
process.exitCode = reappeared.length || vanished.length ? 1 : 0;
