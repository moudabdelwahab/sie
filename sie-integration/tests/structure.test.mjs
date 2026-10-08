/**
 * structure.test.mjs — where responsibilities live (G-BR-1, G-L6-1).
 * ------------------------------------------------------------
 * The remediation plan moves every customer-facing sentence into Dialogue
 * (L6), every classifier into Language (L1) and every routing decision into
 * Decision (L5), leaving sie-chat-bridge.js as an orchestrator. Behavioural
 * tests prove what a turn does; these prove where the code that does it
 * lives, which no behavioural test can see.
 *
 * The bridge measurement was RED by design from WP1 (pinned, like a red
 * golden run) and went green in WP4, when the bridge was emptied to an
 * orchestrator (G-BR-1). The Language-module measurement went green in WP3.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Source with comments removed, so only executable code is measured. */
function code(rel) {
    return read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const ARABIC = /[\u0600-\u06FF]/;

/** Measures the orchestrator's violations of G-BR-1 / G-L6-1. */
export function bridgeViolations() {
    // Log lines are operator text, not customer text: excluded.
    const src = code('sie-integration/sie-chat-bridge.js').split('\n').filter((l) => !/\bconsole\./.test(l)).join('\n');
    const stringLiterals = [...src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]);
    const customerText = stringLiterals.filter((s) => ARABIC.test(s)).length;
    const regexClassifiers = [...src.matchAll(/\/(?![*/])((?:\\.|[^/\n])+)\/[gimsuy]*/g)].filter((m) => ARABIC.test(m[1])).length;
    const body = src.slice(src.indexOf('export async function runSieTurn'));
    const successReturns = [...body.matchAll(/\breturn\s+(?!null\b)([^;]+);/g)].length;
    return { customerText, regexClassifiers, successReturns };
}

/** Customer replies exported from Language (L1) modules instead of living in Dialogue. */
export function languageReplyExports() {
    const found = [];
    for (const [file, name] of [
        ['sie/language/small-talk.js', 'SMALL_TALK_REPLIES'],
        ['sie/language/memory-intent.js', 'MEMORY_REPLIES'],
        ['sie/language/emotion-detector.js', 'EMOTION_ACKNOWLEDGEMENT']
    ]) {
        if (new RegExp(`export const ${name}\\b`).test(read(file))) found.push(name);
    }
    return found;
}

test('[G-BR-1] the bridge is an orchestrator: no customer text, no classifier, one success return, no state literal', () => {
    // History of this measurement: WP1 { customerText: 14, regexClassifiers: 19,
    // successReturns: 7 }; WP3 { 9, 0, 7 } (classifier to Layer 1, ticket
    // prompt to Dialogue); WP4 { 0, 0, 1 } (routing to Layer 5, texts to
    // Layer 6, effects to Layer 8).
    assert.deepEqual(bridgeViolations(), { customerText: 0, regexClassifiers: 0, successReturns: 1 });
    // No session state is composed here: Layer 5 builds it, Layer 8 stamps it.
    const src = code('sie-integration/sie-chat-bridge.js');
    assert.ok(!/\bsie\s*:\s*\{/.test(src), 'the bridge builds a bot_state.sie literal');
    assert.ok(!/lastTurnAt|pendingTicketConfirmation|ticketAlreadyCreated/.test(src), 'the bridge reads or writes a state field');
});

test('[G-BR-1] Layer 5 is the single owner of every routing rule: the bridge\'s decision paths are gone', () => {
    const src = code('sie-integration/sie-chat-bridge.js');
    // The pre-WP4 bridge decision paths (audit §3, overrides 1–14).
    const removed = [
        'resolvePendingTicketConfirmation', 'beginTicketConfirmation', 'escalateImmediately', 'handleMemoryIntent',
        'closeConversation', 'respondToSmallTalk', 'rescueWithArticle', 'recallPreviousState', 'confirmationAnswer',
        'buildGreetingPersonalisation', 'shouldEscalateForEmotion', 'collectAlternatives', 'recordingPort'
    ];
    assert.deepEqual(removed.filter((name) => src.includes(name)), [], 'a removed bridge decision path is back');
    // The bridge calls no decision, authorization, rendering or write primitive directly.
    for (const call of ['decide(', 'admitAction(', 'admitFacts(', 'renderDecision(', 'executeDecision(', 'freeFloor(', 'requestHumanHandoff(supabase, { sessionId, reason: \'']) {
        assert.ok(!src.includes(call), `the bridge calls ${call} itself`);
    }
    // The rules exist exactly once, in Layer 5.
    const rules = code('sie/decision/conversation-rules.js');
    for (const fn of ['export function planTurn', 'export function classifyPromptAnswer', 'export function escalationFor', 'export function focusFor', 'export function decideTurn', 'export function finalizeTurn', 'export function loadPreviousState']) {
        assert.ok(rules.includes(fn), `${fn} is missing from Layer 5`);
    }
    // And the vNext interpretation projects them instead of holding a copy.
    const interp = code('sie/pipeline/interpretation.js');
    assert.ok(interp.includes('planTurn('), 'interpretation.js does not use Layer 5');
    assert.ok(!/ticket_on_anger|answeredScenarioIds|coversWholeMessage|humanRequest/.test(interp), 'interpretation.js holds its own routing rule');
});

test('[G-BR-1] the bridge calls the layers in order', () => {
    const src = code('sie-integration/sie-chat-bridge.js');
    const body = src.slice(src.indexOf('export async function runSieTurn'));
    const order = [
        'tryConsumeSieMessage(',   // gates
        'normalize(',              // L1
        'analyzeSignals(',         // L1
        'loadPreviousState(',      // L5 (context) — precedes L1 in the text; checked below
        'openTurn(',               // CP1
        'planTurn(',               // L5
        'processTurn(',            // L3
        'rankDiagnosticState(',    // L4
        'focusFor(',               // L5 focus
        'decideTurn(',             // L5
        'composeAnswerDecision(',  // L7
        'finalizeTurn(',           // L5
        'runPreEffects(',          // L8
        'renderTurn(',             // L6
        'commitTurn(',             // L8
        'runPostEffects(',         // L8
        'writeTurnTrace('          // L9
    ].filter((c) => c !== 'loadPreviousState(');
    const at = order.map((c) => [c, body.indexOf(c)]);
    for (const [c, i] of at) assert.ok(i > 0, `${c} is not called`);
    for (let k = 1; k < at.length; k++) assert.ok(at[k - 1][1] < at[k][1], `${at[k - 1][0]} must come before ${at[k][0]}`);
    assert.ok(body.indexOf('loadPreviousState(') < body.indexOf('planTurn('));
});

test('[G-L1-6] the bridge holds no text classifier: every Arabic pattern lives in Layer 1', () => {
    assert.equal(bridgeViolations().regexClassifiers, 0);
});

test('Language modules export no customer replies: they moved to Dialogue (templates/conversational.js) in WP3', () => {
    assert.deepEqual(languageReplyExports(), []);
});

test('the structural measurement is not vacuous: it detects a planted violation', () => {
    const planted = "const T = 'تحب أفتحلك تذكرة'; const R = /لأ/; function f() { return { reply: 1 }; }";
    const literals = [...planted.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]).filter((s) => ARABIC.test(s));
    const regexes = [...planted.matchAll(/\/(?![*/])((?:\\.|[^/\n])+)\/[gimsuy]*/g)].filter((m) => ARABIC.test(m[1]));
    assert.equal(literals.length, 1);
    assert.equal(regexes.length, 1);
});
