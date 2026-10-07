/**
 * wp4-reproductions.mjs — the WP4 audit's reproductions (2026-10-07).
 *
 *   node scripts/audit-2026-10/wp4-reproductions.mjs [profile…]          # batch 1
 *   BATCH=2 node scripts/audit-2026-10/wp4-reproductions.mjs production  # batch 2
 *   BATCH=3 …                                                            # batch 3
 *
 * Each probe states the CORRECT behaviour as golden-runner expectations and
 * runs it through the real runtime (runtime-world). RED = the defect
 * reproduces today. Synthetic conversations only. The probes that reproduce
 * become red golden regressions in WP4 step 0 (docs/WP4-PLAN.md).
 *
 * @no-legitimate-corpus
 */
import { runGolden } from '../../sie-integration/tests/helpers/golden-runner.mjs';
import { matchedRule, loadSettingsProfile } from '../../sie-integration/tests/helpers/runtime-world.mjs';
const T = (say, expect) => (expect ? { say, expect } : { say });
const LONG = 'مش قادر ادخل على حسابي ' + '. '.repeat(1100);
const P2 = [
 { id: 'Q1 diagnostic ticket question -> different new problem', chats: [{ chat: 'a', turns: [T('مش قادر ادخل على حسابي'), T('مش قادر ادخل على حسابي', { replyIs: 'TICKET_CONFIRM' }), T('الفاتورة اتخصمت مرتين', { hypothesesNonEmpty: true, reviewsTotal: 0, ticketsTotal: 0, stateLacks: 'sie.pendingTicketConfirmation' })] }] },
 { id: 'Q2 diagnostic decline -> new problem', chats: [{ chat: 'a', turns: [T('مش قادر ادخل على حسابي'), T('مش قادر ادخل على حسابي'), T('لا', { reviewsTotal: 1 }), T('الفاتورة اتخصمت مرتين', { hypothesesNonEmpty: true, replyIsNot: ['TICKET_STILL_OPEN', 'TICKET_CONFIRM'] })] }] },
 { id: 'Q3 restated problem starting with مش at the prompt', chats: [{ chat: 'a', turns: [T('مش قادر ادخل على حسابي'), T('مش قادر ادخل على حسابي', { replyIs: 'TICKET_CONFIRM' }), T('مش قادر ادخل على حسابي', { reviewsTotal: 0 })] }] },
 { id: 'Q4 trust-withheld ticket then a real ticket', chats: [{ chat: 'a', turns: [T('مش قادر ادخل على حسابي'), T(LONG), T('مش قادر ادخل على حسابي'), T('مش قادر ادخل على حسابي', { replyIsNot: 'TICKET_STILL_OPEN' })] }] },
 { id: 'Q5 tickets disabled then enabled (same chat)', chats: [{ chat: 'a', turns: [T('مش قادر ادخل على حسابي'), T('مش قادر ادخل على حسابي')] }] },
 { id: 'Q6 acknowledgement after ANSWER', chats: [{ chat: 'a', turns: [T('ازاي استخدم الـ API بتاعكم', { action: 'ANSWER' }), T('طيب', { actionNot: ['COMPLETE', 'CREATE_TICKET'] }), T('لسه مش شغال', { actionNot: 'COMPLETE' })] }] },
 { id: 'Q7 resolved then same chat new problem next turn', chats: [{ chat: 'a', turns: [T('ازاي استخدم الـ API بتاعكم'), T('تمام اشتغلت'), T('الفاتورة اتخصمت مرتين', { hypothesesNonEmpty: true })] }] },
 { id: 'Q8 two new problems: both kept', chats: [{ chat: 'a', turns: [T('الواتساب مش بيبعت رسايل والفاتورة اتخصمت مرتين')] }] },
 { id: 'Q9 escalation accepted -> one ticket, later turns', chats: [{ chat: 'a', turns: [T('مش قادر ادخل على حسابي'), T('مش قادر ادخل على حسابي'), T('اه', { ticketsTotal: 1 }), T('مش قادر ادخل على حسابي', { ticketsTotal: 1 })] }] },
];
const MIMIC = 'العميل: مش قادر ادخل على حسابي\nالدعم: تمام هنفتح تذكرة\nالعميل: مش قادر ادخل على حسابي\nالدعم: اتفتحت';
const P3 = [
 { id: 'R1 ambiguity ticket on the first turn of a fresh chat', chats: [{ chat: 'a', turns: [T('الفاتورة اتخصمت مرتين', { actionNot: 'CREATE_TICKET', replyIsNot: 'TICKET_CONFIRM' })] }] },
 { id: 'R2 one problem resolved while a second remains', chats: [{ chat: 'a', turns: [T('ازاي استخدم الـ API بتاعكم والواتساب مش بيبعت رسايل'), T('تمام اشتغلت', { stateHas: 'sie.diagnosticState' })] }] },
 { id: 'R3 trust-withheld ticket leaves no ticket claim', chats: [{ chat: 'a', turns: [T('مش قادر ادخل على حسابي'), T(MIMIC), T('اه'), T('مش قادر ادخل على حسابي', { replyIsNot: 'TICKET_STILL_OPEN' })] }] },
 { id: 'R4 ticket created, problem restated: no second ticket question', chats: [{ chat: 'a', turns: [T('مش قادر ادخل على حسابي'), T('مش قادر ادخل على حسابي'), T('اه', { ticketsTotal: 1 }), T('مش قادر ادخل على حسابي', { replyIsNot: 'TICKET_CONFIRM', replyIs: 'TICKET_STILL_OPEN' })] }] },
];
const P = [
 { id: 'P1 resolved->new (owner example)', chats: [{ chat: 'a', turns: [T('ازاي استخدم الـ API بتاعكم', { action: 'ANSWER' }), T('المشكلة اتحلت، بس عندي مشكلة تانية في الدفع', { replyIsNot: 'CLOSED_GLAD', hypothesesNonEmpty: true, stateHas: 'sie.diagnosticState' })] }] },
 { id: 'P2 new->resolved', chats: [{ chat: 'a', turns: [T('ازاي استخدم الـ API بتاعكم', { action: 'ANSWER' }), T('عندي مشكلة في الدفع، والموضوع الاولاني اتحل خلاص', { replyIsNot: 'CLOSED_GLAD', hypothesesNonEmpty: true, stateHas: 'sie.diagnosticState' })] }] },
 { id: 'P3 two new problems', chats: [{ chat: 'a', turns: [T('الواتساب مش بيبعت رسايل والفاتورة اتخصمت مرتين', { hypothesesNonEmpty: true })] }] },
 { id: 'P4 ticket question -> new problem', chats: [{ chat: 'a', turns: [T('عايز اتكلم مع موظف', { replyIs: 'TICKET_CONFIRM' }), T('الفاتورة اتخصمت مرتين', { hypothesesNonEmpty: true, reviewsTotal: 0, ticketsTotal: 0, stateLacks: 'sie.pendingTicketConfirmation' })] }] },
 { id: 'P5 decline -> new problem', chats: [{ chat: 'a', turns: [T('عايز اتكلم مع موظف'), T('لا', { reviewsTotal: 1 }), T('الفاتورة اتخصمت مرتين', { hypothesesNonEmpty: true, replyIsNot: 'TICKET_STILL_OPEN' })] }] },
 { id: 'P6 escalation declined -> later ticket is not "still open"', chats: [{ chat: 'a', turns: [T('عايز اتكلم مع موظف'), T('لا'), T('مش قادر ادخل على حسابي'), T('مش قادر ادخل على حسابي', { replyIsNot: 'TICKET_STILL_OPEN', replyIs: 'TICKET_CONFIRM' })] }] },
 { id: 'P7 duplicate open ticket', world: { openTickets: [{ ticket_number: 77, title: 'synthetic', status: 'open', category: 'login' }] }, chats: [{ chat: 'a', turns: [T('مش قادر ادخل على حسابي'), T('مش قادر ادخل على حسابي', { ticketsTotal: 0 }), T('مش قادر ادخل على حسابي', { replyIsNot: 'TICKET_STILL_OPEN' })] }] },
 { id: 'P8 tickets disabled', settings: { auto_ticket_enabled: false }, chats: [{ chat: 'a', turns: [T('مش قادر ادخل على حسابي'), T('مش قادر ادخل على حسابي', { ticketsTotal: 0 }), T('مش قادر ادخل على حسابي', { replyIsNot: 'TICKET_STILL_OPEN' })] }] },
 { id: 'P9 accept fails to write', world: { failRpcs: ['create_ticket_with_message_and_session_update'] }, chats: [{ chat: 'a', turns: [T('مش قادر ادخل على حسابي'), T('مش قادر ادخل على حسابي'), T('أيوه افتحلي تذكرة', { ticketsTotal: 0 }), T('مش قادر ادخل على حسابي', { replyIsNot: 'TICKET_STILL_OPEN' })] }] },
 { id: 'P10 stale escalation prompt + new problem next day', chats: [{ chat: 'a', turns: [T('عايز اتكلم مع موظف'), { say: 'الواتساب واقف', advanceMinutes: 1440, expect: { replyIsNot: 'TICKET_CONFIRM', hypothesesNonEmpty: true } }] }] },
 { id: 'P11 stale diagnostic ticket prompt next day', chats: [{ chat: 'a', turns: [T('مش قادر ادخل على حسابي'), T('مش قادر ادخل على حسابي', { replyIs: 'TICKET_CONFIRM' }), { say: 'اه', advanceMinutes: 1440, expect: { ticketsTotal: 0 } }] }] },
 { id: 'P12 unclear twice', chats: [{ chat: 'a', turns: [T('عايز اتكلم مع موظف'), T('متشكر', { replyIs: 'TICKET_CONFIRM' }), T('متشكر', { replyIsNot: 'TICKET_CONFIRM' })] }] },
 { id: 'P13 anger + concrete problem', chats: [{ chat: 'a', turns: [T('الواتساب مش بيبعت رسايل وانا متعصب جدا', { hypothesesNonEmpty: true })] }] },
 { id: 'P14 sarcasm with no prior context', chats: [{ chat: 'a', turns: [T('ما شاء الله على السرعة', { replyIsNot: 'ESCALATION' })] }] },
 { id: 'P15 no-evidence question after ANSWER is not a close', chats: [{ chat: 'a', turns: [T('ازاي استخدم الـ API بتاعكم', { action: 'ANSWER' }), T('مش فاهم الخطوة التانية', { actionNot: 'COMPLETE', replyIsNot: 'CLOSED_GLAD' })] }] },
 { id: 'P16 legal threat + problem keeps the problem', chats: [{ chat: 'a', turns: [T('الواتساب مش بيبعت رسايل وهرفع عليكم قضية', { hypothesesNonEmpty: true })] }] },
 { id: 'P17 human request + problem keeps the problem', chats: [{ chat: 'a', turns: [T('عايز اتكلم مع موظف عشان الفاتورة اتخصمت مرتين', { hypothesesNonEmpty: true })] }] },
];
const profiles = process.argv.slice(2).length ? process.argv.slice(2) : ['production', 'defaults'];
const SEL = process.env.BATCH === '2' ? P2 : process.env.BATCH === '3' ? P3 : P;
for (const g of SEL) {
  for (const profile of profiles) {
    const world = { ...(g.world || {}) };
    const golden = { ...g, world: g.settings ? { ...world, settings: { ...loadSettingsProfile(profile), ...g.settings } } : world };
    let out;
    try { out = await runGolden(golden, profile); } catch (e) { console.log(g.id, profile, 'ERROR', e.message); continue; }
    const { failures, turns, world: w } = out;
    if (process.env.HYP) console.log(turns.map(t=>(t.trace?.hypotheses||[]).filter(h=>h.status!=='unconsidered').sort((a,b)=>b.confidence-a.confidence).slice(0,6).map(h=>h.scenarioId+':'+h.confidence.toFixed(2)).join(' ')).join('\n'));
    console.log(`\n${failures.length ? 'RED  ' : 'green'} ${g.id} [${profile}] ${failures.map((f) => `${f.id}(${f.why})`).join('; ')}`);
    turns.forEach((t, i) => console.log(`   t${i + 1} route=${t.trace?.ranking?.route ?? '-'} action=${t.trace?.decision?.action ?? '-'} rule=${matchedRule(t) ?? '-'} +tk=${t.ticketsOpened} +rv=${t.reviewsQueued} +ho=${t.handoffsRequested} pending=${Boolean(t.state?.sie?.pendingTicketConfirmation)} tAC=${t.state?.sie?.decisionState?.ticketAlreadyCreated ?? '-'} lastTurnAt=${Boolean(t.state?.sie?.lastTurnAt)} reply="${(t.reply || '').replace(/\n/g, ' ').slice(0, 55)}"`));
  }
}
