/**
 * sie-chat-bridge.js  —  INTERNAL TO SIE
 * ------------------------------------------------------------
 * ⚠️ Not a public surface. Mad3oom must import sie-runtime.js instead.
 * This file's entry point is runSieTurn(); the runtime wraps it as
 * getSieReply().
 *
 * The turn ORCHESTRATOR (G-BR-1). It calls the layers in order and passes
 * each one's output to the next. It decides nothing, words nothing and
 * composes no session state:
 *
 *   gates     settings, human handoff, quota
 *   L1        Language: normalize + the signals every rule reads
 *   L5        load the previous state (context expiry)
 *   Trust     CP1 on every route, on the full received text
 *   L5        planTurn: the route, and whether the turn is diagnosed
 *   L7        the reads the route needs (facts, the customer's name)
 *   L2–L4     catalog, diagnosis, ranking — focused by L5 on the problem
 *             the customer is talking about now
 *   L5        decideTurn: the engine decision
 *   L7        Knowledge: compose the answer; an article or an open ticket
 *             the ticket decision needs to know about
 *   L5        finalizeTurn: the decision taken, its effects, the next state
 *   L8        pre-commit effects (review queue, memory)
 *   L6        Dialogue: the words
 *   L8        the commit (one transaction), then the hand-off
 *   L9        one trace, whatever happened
 *
 * Until WP4 this file held the conversation's routing rules as early
 * returns (audit RC1–RC10); they live in sie/decision/conversation-rules.js
 * now, with one owner.
 *
 * SIE's turn-by-turn memory is namespaced under botState.sie so it never
 * collides with chatbot-engine.js's own use of chat_sessions.bot_state.
 *
 * Any failure returns null rather than throwing, so the caller's fallback
 * to the traditional engine is exactly what applies.
 */
import { normalize } from '../sie/language/normalizer.js';
import { analyzeSignals, signalsTrace } from '../sie/language/signals.js';
import { activationThresholdForLevel, rankDiagnosticState } from '../sie/ranking/ranking-engine.js';
import { recallCustomerName, findOpenTicket, recallPreviousSession, rememberFacts, recallFacts, forgetFacts } from './sie-customer-memory.js';
import { queueForHumanReview } from './sie-review-queue.js';
import { processTurn } from '../sie/diagnostics/diagnostic-engine.js';
import {
    ROUTES, conversationPolicy, loadPreviousState, withRecalledSession, planTurn, focusFor, decideTurn, knowledgeNeeds, finalizeTurn
} from '../sie/decision/conversation-rules.js';
import { composeAnswerDecision } from '../sie/knowledge/answer-composer.js';
import { staticKnowledgeProvider } from '../sie/knowledge/static-knowledge.local.js';
import { renderTurn, presentationPolicy } from '../sie/dialogue/turn-renderer.js';
import { logTraceEvent } from '../sie/action/action-layer.js';
import { runPreEffects, commitTurn, runPostEffects } from '../sie/action/turn-executor.js';
import { createRealSupabasePort } from '../sie/action/supabase-port.supabase.js';
import { buildTraceEvent } from '../sie/observability/trace-logger.js';
import { tryConsumeSieMessage, getSieSettings } from './sie-entitlement.js';
import { resolveScenarioCatalog } from '../sie/scenarios/scenario-catalog.resolver.js';
import { openTurn, admitEvidence, trustTrace, traceProjection } from '../sie/trust/trust-boundary.js';
import { extractTextEvidence } from '../sie/diagnostics/evidence-extractor.js';
import { evidenceFromQuestionAnswer } from '../sie/diagnostics/question-answer.js';
import { toSparseState } from '../sie/diagnostics/sparse-state.js';
import { runShadowComparison } from './sie-shadow.js';
import { TURN_KINDS } from '../sie/pipeline/interpretation.js';
import { isHumanHandoffActive, requestHumanHandoff } from './sie-handoff.js';
import { resolveCustomerEdition, resolveEditionProfile } from '../sie/editions/editions.js';
import { editionCatalogs } from '../sie/editions/edition-catalog.local.js';
import { providerForAssembly } from '../sie/editions/edition-catalog.js';
import { capEvidenceTokens, scopeFor } from '../sie/editions/edition-turn.js';

/**
 * How the trust boundary is configured for this turn, from settings.
 *
 * Two flags rather than one, because the rollout has two stages and they carry
 * very different risk. `trust_boundary_enabled` alone runs every checkpoint and
 * writes every verdict to the trace while enforcing nothing — which is how the
 * false-positive rate gets measured on real traffic rather than on the test-suite
 * proxy corpus the thresholds were calibrated against. `trust_boundary_enforce`
 * is the second stage, and it can refuse to act on a customer's turn.
 *
 * Both default off. See sie/trust/README.md.
 *
 * @param {Object} settings
 * @returns {{enabled: boolean, observeOnly: boolean}}
 */
function trustConfig(settings) {
    return {
        enabled: settings.trust_boundary_enabled === true,
        observeOnly: settings.trust_boundary_enforce !== true
    };
}

/**
 * الحالات اللي الإعدادات سامحة للمحرك يقراها.
 *
 * Each emotion has its own switch, so an operator who finds one category
 * misfiring can silence just that one instead of losing the whole layer.
 *
 * @param {Object} settings
 * @returns {string[]}
 */
function enabledEmotions(settings) {
    return EMOTION_SETTING_KEYS
        .filter(({ key }) => settings[key] !== false)
        .map(({ emotion }) => emotion);
}

/**
 * «يستخدم المقالات» لما يتقفل. مزوّد فاضي بدل ما نلف على الشرط في نص
 * answer-composer — الموديول يفضل مايعرفش إن فيه إعداد أصلاً.
 */
const EMPTY_KNOWLEDGE_PROVIDER = { getEntryByKey: async () => null };


const EMOTION_SETTING_KEYS = [
    { key: 'emotion_anger', emotion: 'anger' },
    { key: 'emotion_frustration', emotion: 'frustration' },
    { key: 'emotion_urgency', emotion: 'urgency' },
    { key: 'emotion_sarcasm', emotion: 'sarcasm' },
    { key: 'emotion_thanks', emotion: 'thanks' },
    { key: 'emotion_satisfaction', emotion: 'satisfaction' }
];


/**
 * The catalog this turn diagnoses against.
 *
 * Delegates to the resolver rather than choosing here, because "which
 * catalog?" is now answered in exactly one place for the runtime, the
 * console, the health check and the tests alike. This used to pick
 * BETWEEN the shipped file and the published rows; picking the rows
 * meant discarding the file, which is how a 650-scenario catalog became
 * 7 in production without a single error anywhere. The resolver merges
 * instead, so the effective catalog can never be smaller than the
 * shipped one.
 */
async function resolveTurnScenarioProvider(supabase, settings, baseProvider) {
    const { provider, resolution } = await resolveScenarioCatalog({ supabase, settings, ...(baseProvider ? { baseProvider } : {}) });
    return { provider, resolution };
}

/**
 * The edition this turn runs as, and the catalog + vocabulary it brings.
 *
 * Never throws and never leaves a turn without a catalog: a pack that fails
 * to load (a CDN hiccup at cold start, a malformed file) degrades the turn to
 * the Free profile, which needs nothing but the core files every deployment
 * already loads. The failure is logged with the edition that was lost, so a
 * silent downgrade cannot hide.
 */
async function resolveTurnEdition(entitlement, settings) {
    const edition = resolveCustomerEdition({ accessRow: { edition: entitlement?.edition ?? null }, settings });
    const profile = resolveEditionProfile(edition, settings);
    try {
        return { profile, assembly: await editionCatalogs.forProfile(profile), degradedFrom: null };
    } catch (err) {
        console.error(`[sie] edition "${edition}" could not be assembled, answering as Free:`, err?.message || err);
        const free = resolveEditionProfile('free', settings);
        return { profile: free, assembly: await editionCatalogs.forProfile(free), degradedFrom: edition };
    }
}


/**
 * The Decision Engine's policy, from settings: per-deployment choices about
 * how sure before answering, how many questions, when to hand off.
 */
function decisionPolicyFrom(settings, activationThreshold) {
    return {
        activationThreshold,
        // «يرد بالحل بنفسه» لو اتقفل، المحرك يفضل يشخّص ويجمع
        // المعلومات زي ما هو، بس يسلّم الحل لموظف.
        allowAutoResolution: settings.answer_directly,
        allowScenarioAnswers: settings.knowledge_use_scenarios,
        allowEvidenceRequests: settings.auto_request_more_info,
        ticketOnAmbiguity: settings.ticket_on_low_confidence,
        includeTicketSummary: settings.ticket_include_summary,
        resolutionConfidenceThreshold: settings.answer_confidence,
        maxClarifyingQuestions: settings.max_clarifying_questions,
        maxTurnsBeforeEscalation: settings.ticket_after_turns,
        allowSmartGuess: settings.allow_smart_guess,
        requireCompleteEvidence: settings.inference_mode === 'knowledge_only'
    };
}

/**
 * CP2, as processTurn's evidence filter: the edition's distinct-token cap
 * (a resource bound), then the trust boundary. `dropped.count` reports what
 * was set aside.
 */
function evidenceFilterFor(editionProfile, trustEnvelope, dropped) {
    return (evidence) => {
        const capped = capEvidenceTokens(evidence, editionProfile.maxEvidenceTokensPerTurn);
        const { evidence: kept, dropped: refused } = admitEvidence(capped.evidence, trustEnvelope);
        dropped.count = refused + capped.dropped;
        return kept;
    };
}

/**
 * L7 read — «يدوّر في المقالات قبل ما يفتح تذكرة»: the knowledge entry keyed
 * on the leading scenario's `knowledgeSource`, if one exists. Deliberately
 * not the runner-up's: answering from a scenario the engine did not settle
 * on is how a customer gets a confident reply to a question never asked.
 * Layer 5 decides what to do with it.
 */
async function findArticleFor(ranking) {
    const scenario = ranking?.topHypothesis?.scenario;
    const key = scenario?.resolution?.knowledgeSource;
    if (!key) return null;
    try {
        const entry = await staticKnowledgeProvider.getEntryByKey(key);
        return entry ? { key, text: entry.text, resolution: scenario.resolution } : null;
    } catch (err) {
        // A knowledge outage must not block the hand-off it was meant to avoid.
        console.warn('[sie] article lookup before ticket failed:', err?.message || err);
        return null;
    }
}

// ===================================================================
// The turn record (WP2 — truthful observability)
// ===================================================================
//
// Every paid turn writes exactly one trace, and the trace separates what the
// engine DECIDED (intent) from what actually HAPPENED (executed effects, as
// the Action layer recorded them) and what the customer was actually SENT.
// The turn fills the record as it goes; one writer turns it into the trace
// row in runSieTurn's `finally`, so no failure can skip it.

const LAYERS = Object.freeze(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9']);

function createTurnRecord() {
    return {
        route: null, layers: {}, intent: null, intendedText: null, effects: [], error: null,
        turn: null, normalizedTokens: null, language: null, responseLanguage: null, trustEnvelope: null,
        diagnosticState: null, ranking: null, shadow: null, engine: null
    };
}

/** Records one layer's status on this turn. */
function mark(rec, layer, status, reason = null) {
    rec.layers[layer] = reason ? { status, reason } : { status };
}

/** Every layer's status; a layer the route never reached says so. */
function layerStatuses(rec) {
    return LAYERS.map((layer) => {
        if (layer === 'L9') return { layer, status: 'ran' };
        if (layer === 'L8') {
            const wrote = rec.effects.some((e) => e.type === 'persist_reply' || e.type === 'create_ticket');
            return wrote ? { layer, status: 'ran' } : { layer, status: 'skipped', reason: 'no turn write was attempted' };
        }
        const m = rec.layers[layer];
        if (m) return { layer, ...m };
        return { layer, status: 'skipped', reason: `route "${rec.route ?? 'none'}" ends before this layer` };
    });
}

/**
 * Writes the turn's one trace. Returns whether it was written.
 *
 * The trust field: with the boundary enabled, every trace carries the verdict
 * — "trusted" included — or says the route ended before the checkpoint ran.
 */
async function writeTurnTrace({ rec, result, sessionId, port, settings, rawText, timestamp, processingTimeMs }) {
    const trustOn = trustConfig(settings).enabled;
    const trust = !trustOn
        ? null
        : rec.trustEnvelope
            ? (trustTrace(rec.trustEnvelope) ?? { enforced: traceProjection(rec.trustEnvelope), observed: null })
            : { status: 'not_evaluated', reason: `route "${rec.route ?? 'none'}" exits before the trust checkpoint (CP1)` };

    const writes = rec.effects.filter((e) => e.type === 'persist_reply' || e.type === 'create_ticket');
    const outcome = {
        committed: writes.length > 0 && writes[writes.length - 1].ok === true,
        delivered: Boolean(result?.reply),
        effects: rec.effects,
        ...(rec.error ? { error: rec.error } : {})
    };

    const traceEvent = buildTraceEvent({
        sessionId,
        turn: rec.turn ?? 0,
        rawText,
        normalizedTokens: rec.normalizedTokens || [],
        // What Layer 1 read and reported (WP3): truncation, the signals.
        language: rec.language,
        diagnosticState: rec.diagnosticState,
        ranking: rec.ranking,
        decision: rec.intent || { action: null, route: rec.route },
        // What was SENT. null when nothing reached the customer.
        responseText: result?.reply ?? null,
        intendedText: rec.intendedText,
        timestamp,
        trust,
        shadow: rec.shadow,
        engine: rec.engine,
        route: rec.route,
        layers: layerStatuses(rec)
    });
    const written = await logTraceEvent({
        sessionId, turn: rec.turn ?? 0, traceEvent, port,
        responseLanguage: rec.responseLanguage,
        processingTimeMs,
        actionResult: outcome,
        renderedOptions: result?.options ?? []
    });
    return written?.success === true;
}

/**
 * Runs one full SIE turn. Called only by sie-runtime.js.
 *
 * @param {Object} params
 * @param {string} params.text
 * @param {import('@supabase/supabase-js').SupabaseClient} params.supabase
 * @param {string} params.sessionId
 * @param {string} params.userId
 * @param {Object} params.botState - the session's full bot_state blob (may contain
 *   the traditional engine's own keys too — only botState.sie is SIE's)
 * @param {import('@supabase/supabase-js').SupabaseClient} [params.writer] - writes the
 *   bot's turn (persist_bot_turn / ticket RPC); see createRealSupabasePort. Defaults to
 *   `supabase`.
 * @param {() => number} [params.clock] - epoch milliseconds for this turn's time-based
 *   decisions (context expiry, prompt expiry, lastTurnAt, decision timestamps). Defaults
 *   to real time; injected by tests so expiry is testable without waiting.
 * @returns {Promise<{reply: string, options: Array, alreadyPersisted: true, ticketNumber: string|null, botState: Object} | null>}
 *   null means "not handled by SIE" — caller should fall back to the traditional engine.
 */
export async function runSieTurn({ text, supabase, sessionId, userId, botState, writer, clock }) {
    if (!text || !supabase || !sessionId || !userId) return null;
    const now = typeof clock === 'function' ? () => clock() : () => Date.now();

    // Gates. Settings first, so turning the engine off is immediate and costs
    // the customer nothing.
    const settings = await getSieSettings(supabase);
    if (!settings.engine_enabled) {
        console.info('SIE turn skipped: المحرك متوقف من الإعدادات');
        return null;
    }
    // A conversation a human owns gets no SIE turn — and costs no quota.
    if (await isHumanHandoffActive(supabase, sessionId)) {
        console.info('SIE turn skipped: المحادثة مع فريق الدعم');
        return null;
    }
    const entitlement = await tryConsumeSieMessage(supabase, userId);
    if (!entitlement.allowed) {
        console.info('SIE turn skipped:', entitlement.reason);
        return null;
    }

    // From here the turn is paid for, so it is traced whatever happens.
    const rec = createTurnRecord();
    const port = createRealSupabasePort(supabase, { writer });
    const turnStartedAt = Date.now();
    let turnResult = null;

    const { profile: editionProfile, assembly: editionAssembly, degradedFrom: editionDegradedFrom } =
        await resolveTurnEdition(entitlement, settings);

    try {
        const policy = conversationPolicy(settings);
        let prev = loadPreviousState(botState?.sie || null, policy, now());

        // L1 — on every route; everything below reads these signals (G-L1-6).
        const language = await normalize(text, {
            previousLanguage: prev?.language || 'ar',
            glossaryLayers: editionAssembly.glossaryLayers,
            maxInputChars: editionProfile.maxMessageChars,
            typoTolerance: settings.language_typo_tolerance === true
        });
        const { normalizedTokens, responseLanguage } = language;
        const signals = analyzeSignals({
            text: language.rawText,
            tokens: normalizedTokens,
            previousText: prev?.lastCustomerText || '',
            emotionDetection: Boolean(settings.emotion_detection),
            enabledEmotions: enabledEmotions(settings),
            truncated: language.truncated,
            receivedChars: language.receivedChars
        });
        rec.normalizedTokens = normalizedTokens;
        rec.language = signalsTrace(signals);
        rec.responseLanguage = responseLanguage;
        mark(rec, 'L1', 'ran');

        // L7 — «يستفيد من المحادثات القديمة», once, on a new conversation.
        if (settings.memory_use_past_conversations && !prev?.diagnosticState) {
            prev = withRecalledSession(prev, await recallPreviousSession(
                supabase, userId, sessionId, settings.memory_context_minutes || 1440, now()
            ));
        }

        // Trust CP1 — every route, on the full received text (owner decision).
        const trustEnvelope = openTurn(
            { rawText: text, evidence: extractTextEvidence(normalizedTokens, (prev?.turnCount || 0) + 1) },
            trustConfig(settings)
        );
        rec.trustEnvelope = trustEnvelope;

        // L5 — the route.
        const plan = planTurn({ signals, prev, policy, nowMs: now() });
        rec.route = plan.route;
        rec.turn = plan.turn;

        // L7 — what the route needs to know.
        const data = {};
        if (plan.reads.facts) {
            const stored = await recallFacts(supabase, userId).catch(() => []);
            data.storedFacts = stored || [];
            data.recalledFacts = stored || [];
        }
        if (plan.reads.customerName) data.customerName = await recallCustomerName(supabase, userId);

        // L2–L4, when the turn is diagnosed.
        const activationThreshold = activationThresholdForLevel(settings.diagnosis_level);
        let diagnosticState = null;
        let ranking = null;
        let scenarioProvider = null;
        let newEvidenceAddedThisTurn = 0;
        let focus = { excludeIds: [], closedCategories: [] };
        const rankOptions = { activationThreshold };
        if (plan.diagnose) {
            const resolved = await resolveTurnScenarioProvider(supabase, settings, providerForAssembly(editionAssembly));
            scenarioProvider = resolved.provider;
            if (resolved.resolution.overlayStatus === 'unavailable') {
                console.warn(
                    `[sie] published scenarios were requested but could not be applied `
                    + `(${resolved.resolution.overlayError}); diagnosing against the shipped `
                    + `catalog of ${resolved.resolution.baseCount}`
                );
            }
            mark(rec, 'L2', 'ran');

            const previousDiagnosticState = plan.freshEpisode ? null : prev?.diagnosticState;
            const previousDecisionState = plan.freshEpisode ? null : prev?.decisionState;
            const tokens = plan.diagnoseTokens === 'turn' ? normalizedTokens : [];
            // A tapped question option carries the evidence it declares; CP2 bounds it too.
            const questionAnswer = tokens.length ? await evidenceFromQuestionAnswer({
                text: language.rawText,
                decisionState: previousDecisionState,
                lookup: (id) => scenarioProvider.getScenarioById(id),
                turn: plan.turn
            }) : null;
            const dropped = { count: 0 };
            diagnosticState = await processTurn({
                normalizedTokens: tokens,
                turn: plan.turn,
                previousState: previousDiagnosticState,
                liveEvidenceContext: { userId },
                additionalEvidence: questionAnswer ? questionAnswer.evidence : [],
                scenarioProvider,
                evidenceFilter: evidenceFilterFor(editionProfile, trustEnvelope, dropped),
                scope: settings.retrieval_scoped_diagnosis === false
                    ? null
                    : scopeFor({ previousDecisionState, limit: editionProfile.retrievalMaxCandidates })
            });
            if (dropped.count > 0) {
                console.warn(`[sie] trust boundary dropped ${dropped.count} evidence item(s) (${trustEnvelope.rationale})`);
            }
            newEvidenceAddedThisTurn = (diagnosticState.accumulator?.entries || []).filter((e) => e.turn === plan.turn).length;
            rec.diagnosticState = diagnosticState;
            mark(rec, 'L3', 'ran');

            ranking = await rankDiagnosticState(diagnosticState, scenarioProvider, rankOptions);
            // L5 says which problems the customer has moved on from; L4 ranks without them.
            focus = focusFor({ plan, prev, ranking, turnTokens: tokens.map((t) => t.canonical), signals });
            if (focus.excludeIds.length) {
                rankOptions.excludeIds = focus.excludeIds;
                ranking = await rankDiagnosticState(diagnosticState, scenarioProvider, rankOptions);
            }
            rec.ranking = ranking;
            mark(rec, 'L4', 'ran');
        } else {
            for (const layer of ['L2', 'L3', 'L4']) mark(rec, layer, 'skipped', `route "${plan.route}" does not diagnose`);
        }

        // L5 — the engine decision.
        const decided = decideTurn({
            plan, prev, ranking,
            hypotheses: diagnosticState?.hypotheses || [],
            newEvidenceAddedThisTurn,
            decisionPolicy: decisionPolicyFrom(settings, activationThreshold),
            signals,
            clock: () => new Date(now()).toISOString(),
            floor: {
                scenarios: scenarioProvider ? await scenarioProvider.getAllScenarios() : [],
                packIds: editionAssembly?.packIds,
                genericTokens: editionAssembly?.genericTokens,
                rankOptions
            },
            closedCategories: focus.closedCategories,
            movedOnFrom: focus.excludeIds
        });
        if (decided.floored) {
            console.info(`[sie] edition floor (${editionProfile.edition}): ${decided.floored.from} → ${decided.floored.to} (stand-off with ${decided.floored.scenarioId})`);
        }

        // L7 — Knowledge for the decision, and what a ticket decision must know.
        let decision = decided.decision;
        if (decision) {
            decision = await composeAnswerDecision({
                decision,
                liveKnowledgeContext: settings.knowledge_use_live_data === false ? undefined : { userId },
                turn: plan.turn,
                ...(settings.knowledge_use_articles === false ? { staticKnowledgeProvider: EMPTY_KNOWLEDGE_PROVIDER } : {}),
                ...(settings.knowledge_priority === 'live_first' ? { preferLiveKnowledge: true } : {})
            });
            const needs = knowledgeNeeds({ plan, decided, decision, settings });
            if (needs.article) data.article = await findArticleFor(ranking);
            if (needs.lookupOpenTicket) data.openTicket = await findOpenTicket(supabase, userId, needs.openTicketCategory);
        }
        const knowledgeRan = Boolean(decision) || Object.keys(data).length > 0;
        mark(rec, 'L7', knowledgeRan ? 'ran' : 'skipped', knowledgeRan ? null : `route "${plan.route}" reads no knowledge`);

        // L5 — the decision taken, its effects and the next state.
        const { scopeStats, ...diagnosticStateToPersist } = diagnosticState || {};
        const turnDecision = finalizeTurn({
            plan, prev, signals, policy, decided, decision, data,
            envelope: trustEnvelope,
            diagnosticState: diagnosticState
                ? (settings.sparse_diagnostic_state === true ? toSparseState(diagnosticStateToPersist) : diagnosticStateToPersist)
                : null,
            language: responseLanguage,
            nowMs: now(),
            customerText: language.rawText
        });
        rec.intent = turnDecision.intent;
        mark(rec, 'L5', 'ran');

        // L9 — the shadow pipeline, on diagnostic turns, when switched on.
        let shadowRecord = null;
        let shadowState = null;
        if (settings.shadow_run_enabled === true && plan.route === ROUTES.DIAGNOSTIC) {
            const shadow = await runShadowComparison({
                text,
                catalog: await scenarioProvider.getAllScenarios(),
                liveResult: { interpretation: { kind: TURN_KINDS.DIAGNOSTIC }, decision: turnDecision.decision || decision, ranking },
                shadowPrevious: prev?.shadowState || null,
                settings
            });
            shadowRecord = shadow.record;
            shadowState = shadow.shadowState && JSON.stringify(shadow.shadowState).length < 64 * 1024 ? shadow.shadowState : null;
        }

        // L8 — pre-commit effects; L6 — the words; L8 — the commit, then the hand-off.
        const effectsPort = {
            queueReview: (args) => queueForHumanReview(supabase, { sessionId, ...args }),
            writeFacts: (facts) => rememberFacts(supabase, userId, facts),
            forgetFacts: () => forgetFacts(supabase, userId),
            requestHandoff: (reason) => requestHumanHandoff(supabase, { sessionId, reason })
        };
        const outcomes = await runPreEffects(turnDecision.effects.pre, effectsPort, rec.effects);
        const rendered = renderTurn(turnDecision, {
            language: responseLanguage, outcomes, presentation: presentationPolicy(settings), ranking, activationThreshold
        });
        rec.intendedText = rendered.intendedText;
        mark(rec, 'L6', 'ran');

        const { actionResult, botState: committedBotState } = await commitTurn({
            turnDecision, rendered, sessionId, botState, port,
            nowIso: new Date(now()).toISOString(), effects: rec.effects, shadowState
        });
        if (!actionResult?.success) {
            console.error('SIE action-layer write failed:', actionResult);
            return null; // caller falls back to the traditional engine
        }
        const { handedOff } = await runPostEffects(turnDecision.effects.post, effectsPort, rec.effects);

        rec.shadow = shadowRecord;
        rec.engine = plan.diagnose ? {
            edition: editionProfile.edition,
            degradedFrom: editionDegradedFrom,
            floor: decided.floored,
            catalogSize: editionAssembly.scenarios.length,
            scope: scopeStats || null
        } : null;

        return (turnResult = {
            reply: rendered.text,
            options: rendered.options,
            alreadyPersisted: true,
            ticketNumber: actionResult.ticketNumber ?? null,
            humanHandoff: handedOff,
            botState: committedBotState
        });
    } catch (err) {
        console.error('SIE pipeline error:', err?.message || err);
        rec.error = String(err?.message || err);
        return null; // caller falls back to the traditional engine
    } finally {
        // L9 — every paid turn, answered or failed, writes one trace. A failed
        // write is surfaced, never silent, and never costs the reply.
        let written = false;
        let threw = false;
        try {
            written = await writeTurnTrace({
                rec,
                result: turnResult,
                sessionId,
                port,
                settings,
                rawText: text,
                timestamp: rec.intent?.timestamp ?? new Date(now()).toISOString(),
                processingTimeMs: Date.now() - turnStartedAt
            });
        } catch (traceErr) {
            threw = true;
            console.error(`[sie] trace write failed for session ${sessionId}, route ${rec.route ?? 'none'}:`, traceErr?.message || traceErr);
        }
        if (!written && !threw) console.error(`[sie] trace write failed for session ${sessionId}, route ${rec.route ?? 'none'}`);
        if (turnResult) turnResult.traceWritten = written;
    }
}
