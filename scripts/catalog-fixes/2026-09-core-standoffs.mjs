/**
 * 2026-09-core-standoffs.mjs
 * ------------------------------------------------------------
 * Four stand-offs in the CORE (Free) that the Max vocabulary track found
 * (docs/editions-engineering-report.md §16.5). Each turned an ordinary
 * customer message into an ambiguous ticket in Free, and each blocked a Max
 * synonym: a synonym carries its token's core behaviour to new words, core
 * stand-offs included.
 *
 * Same discipline as 2026-09-core-audit.mjs: named, justified, re-runnable
 * (applied twice changes nothing), and measured on a FROZEN behaviour corpus
 * before and after (report §17). Nothing here adds a scenario or changes an
 * answer text; two are ALTERNATIVE signatures (scenarioSignatures scores a
 * message as the max over signatures, so every wording that reached a
 * scenario still reaches it), two add patterns to existing tokens, and one
 * is a clarifying question.
 *
 * First attempt, measured and rejected: two-token alternatives. With two
 * tokens one alone always carries ≥ half the weight, and the measurement
 * showed it — a bare «مش فاهم» leaned to login_cannot_access, a bare «كود
 * التحقق» started answering. Every alternative here has three tokens so each
 * single token scores what it scored before.
 *
 *   1. «كود التحقق مش بيوصل» — {entity_otp, symptom_not_received}. The OTP
 *      scenario keyed only on the phrase token symptom_otp_not_received, so
 *      the ordinary "code + didn't arrive" scored 0.33 there and tied with
 *      notifications / CSAT / webhooks. Alternative for login_otp_not_received.
 *
 *   2. «التذكرة محدش رد عليها» — "nobody replied" was vocabulary only in
 *      its first-person forms («محدش رد عليا», «محدش بيرد»). «محدش رد» joins
 *      the same token (social_anyone_there), and ticket_no_response gets the
 *      alternative {entity_ticket, social_anyone_there}. Alone, the token
 *      keeps meaning what it meant (convo_nobody_replied).
 *
 *   3. «عايز استرداد» — "refund" alone is genuinely three cases (the policy,
 *      a refund already requested, a new request). Free tied the first two
 *      and, with no question to ask, opened a ticket. The fix is not to pick
 *      one: it is the question — shared by the three refund scenarios, so
 *      whichever leads, R6 can ask it.
 *
 *   4. «مش عارف ادخل على حسابي» — «مش عارف» is read as confusion and
 *      «ادخل على حسابي» as the sign-in entity, so "can't sign in" never
 *      formed and login_cannot_access tied login_wrong_credentials. The
 *      phrase token symptom_login_failed gets its «على» forms.
 *
 * @no-legitimate-corpus — contains question text, not customer messages.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOG = path.join(ROOT, 'sie/scenarios/scenario-catalog.data/scenarios.json');
const GLOSSARY = path.join(ROOT, 'sie/language/data/technical-glossary.json');

const catalogFile = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const glossaryFile = JSON.parse(fs.readFileSync(GLOSSARY, 'utf8'));
const byId = new Map(catalogFile.scenarios.map((s) => [s.id, s]));
const log = [];

const sig = (pairs) => pairs.map(([token, weight]) => ({ token, weight, source: 'text' }));
const sameSig = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function addAlternative(id, pairs, why) {
    const s = byId.get(id);
    if (!s) throw new Error(`no scenario ${id}`);
    const alt = sig(pairs);
    s.alternativeSignatures = s.alternativeSignatures || [];
    if (s.alternativeSignatures.some((a) => sameSig(a, alt))) return;
    s.alternativeSignatures.push(alt);
    log.push(`alt ${id}: ${pairs.map(([t, w]) => `${t}:${w}`).join(' ')} — ${why}`);
}

function addPatterns(canonical, patterns, why) {
    const e = glossaryFile.entries.find((x) => x.canonical === canonical);
    if (!e) throw new Error(`no glossary token ${canonical}`);
    const added = patterns.filter((p) => !e.patterns.includes(p));
    if (!added.length) return;
    e.patterns.push(...added);
    log.push(`glossary ${canonical}: +${added.join(' | ')} — ${why}`);
}

function addQuestion(id, question, why) {
    const s = byId.get(id);
    if (!s) throw new Error(`no scenario ${id}`);
    s.discriminatingQuestions = s.discriminatingQuestions || [];
    if (s.discriminatingQuestions.some((q) => q.id === question.id)) return;
    s.discriminatingQuestions.push(question);
    log.push(`question ${id}: ${question.id} — ${why}`);
}

// 1. OTP + "didn't arrive"
// Three tokens, not two: with two, one of them alone carries at least half
// the weight and a bare «كود التحقق» or a bare «مش بيوصل» would lean here.
// With entity_login as the third, each alone scores 0.33 — exactly what the
// OTP token alone scored before — and only the pair wins (0.67).
addAlternative('login_otp_not_received', [['entity_otp', 2], ['symptom_not_received', 2], ['entity_login', 2]],
    'the ordinary way to say the code did not arrive');

// 2. ticket + "nobody replied"
addPatterns('social_anyone_there', ['محدش رد', 'ماحدش رد', 'محدش بيرد عليا'],
    'the third-person and bare forms of patterns the token already has');
// The primary signature with «nobody replied» in place of «not received»:
// alone, social_anyone_there scores 0.33 here, below its own convo scenarios.
addAlternative('ticket_no_response', [['entity_ticket', 3], ['social_anyone_there', 2], ['intent_status_check', 1]],
    '"the ticket — nobody replied"');

// 3. "refund" alone: ask which of the three
const REFUND_QUESTION = {
    id: 'refund_what_needed',
    prompt: { ar: 'تمام، بخصوص الاسترداد — محتاج إيه بالظبط؟', en: 'Sure — about the refund, what do you need exactly?' },
    resolvesEvidence: ['intent_how_to', 'intent_status_check', 'entity_payment'],
    options: [
        { label: { ar: 'أطلب استرداد مبلغ دفعته', en: 'Request a refund for something I paid' }, value: 'request', impliesEvidence: ['entity_payment', 'entity_subscription'] },
        { label: { ar: 'أتابع طلب استرداد قدّمته قبل كده', en: 'Follow up on a refund I already requested' }, value: 'status', impliesEvidence: ['intent_status_check'] },
        { label: { ar: 'أعرف سياسة الاسترداد', en: 'Learn the refund policy' }, value: 'policy', impliesEvidence: ['intent_how_to'] }
    ]
};
// On the policy and the request only: billing_refund_status also leads on a
// bare «الحالة»/«وصلت لفين», where a refund question would be the wrong one.
for (const id of ['billing_refund_policy', 'subscription_refund_request']) {
    addQuestion(id, REFUND_QUESTION, '"refund" alone is three cases; ask, do not guess or ticket');
}

// 4. «مش عارف ادخل على حسابي». Not an alternative signature: with two tokens
//    one alone dominates, and «مش فاهم» alone leaned to login (measured). The
//    phrase itself was being split — «مش عارف» (confusion) + «ادخل على
//    حسابي» (the sign-in entity) — so the phrase token gets its «على» forms.
addPatterns('symptom_login_failed', [
    'مش عارف ادخل على', 'مش عارف ادخل علي', 'مش عارفه ادخل على', 'مش عارفة ادخل على',
    'مش قادر ادخل على', 'مش قادر ادخل علي', 'مش قادره ادخل على', 'مش قادرة ادخل على'
], 'the «على» forms of patterns the token already has, so the phrase is not split');

if (log.length) {
    fs.writeFileSync(CATALOG, JSON.stringify(catalogFile, null, 2) + '\n');
    fs.writeFileSync(GLOSSARY, JSON.stringify(glossaryFile, null, 2) + '\n');
}
console.log(log.length ? log.join('\n') : 'already applied — nothing to do');
