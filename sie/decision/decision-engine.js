/**
 * decision-engine.js
 * ------------------------------------------------------------
 * Consumes Module 4's RankingResult (which already carries full
 * Scenario objects and confidence-scored Hypotheses) and decides
 * exactly ONE next action. Performs no diagnosis, no ranking, no
 * dialogue/text generation — the returned Decision is data only, for
 * the future Dialogue Engine to render.
 *
 * Fully synchronous, zero I/O: everything it needs is already present
 * in the RankingResult and the DecisionState it's given. The only
 * "impure" ingredient is wall-clock time for the Decision's timestamp,
 * which is injected via a `clock` parameter (default: real time) so the
 * module stays deterministic and testable — tests can supply a fixed
 * clock instead of asserting against real time.
 *
 * Every returned Decision carries an `evaluatedRules` trace: an ordered
 * list of every rule this turn considered, up to and including the one
 * that matched, each tagged with whether it matched and why. This is
 * what makes "why was this decided" fully auditable from the Decision
 * object alone, not just a single free-text explanation.
 */
import { ACTIONS, createEmptyDecisionState } from './decision-types.js';
import {
    EVIDENCE_REQUEST_ACTION_BY_CATEGORY,
    DEFAULT_EVIDENCE_REQUEST_ACTION,
    resolvePolicy
} from './decision-policy.js';

const defaultClock = () => new Date().toISOString();

/**
 * The trail is what turns a ticket from "customer says it's broken" into
 * "here is what the engine already ruled in and out", so an agent starts
 * where the engine stopped instead of re-asking everything.
 *
 * Omitting it (policy.includeTicketSummary off) is for deployments whose
 * agents would rather read the raw conversation.
 */
function buildTicketDraft(ranking, policy) {
    return {
        scenarioId: ranking.topHypothesis?.hypothesis.scenarioId ?? null,
        category: ranking.topHypothesis?.scenario?.category ?? 'other',
        diagnosticTrail: policy?.includeTicketSummary === false
            ? []
            : ranking.ranked.slice(0, 5).map((r) => ({
                scenarioId: r.hypothesis.scenarioId,
                confidence: r.hypothesis.confidence,
                status: r.hypothesis.status
            }))
    };
}

function hasMissingLiveEvidence(entry) {
    if (!entry?.scenario) return false;
    const liveTokens = new Set(
        entry.scenario.evidenceSignature.filter((sig) => sig.source === 'live').map((sig) => sig.token)
    );
    if (liveTokens.size === 0) return false;
    return (entry.hypothesis.missingEvidenceTokens || []).some((token) => liveTokens.has(token));
}

function pickEvidenceRequestAction(category) {
    return EVIDENCE_REQUEST_ACTION_BY_CATEGORY[category] || DEFAULT_EVIDENCE_REQUEST_ACTION;
}

function findUnaskedCandidateQuestion(candidateQuestions, askedQuestionIds, scenarioIdFilter = null) {
    return (candidateQuestions || []).find(
        (cq) =>
            !askedQuestionIds.includes(cq.question.id) &&
            (scenarioIdFilter === null || cq.scenarioId === scenarioIdFilter)
    );
}

/**
 * @param {Object} params
 * @param {Object} [params.policy] - operator-set switches, resolved against
 *   this module's constants by resolvePolicy(). These are per-deployment
 *   choices (how sure before answering, how many questions, when to hand
 *   off), not properties of the decision rules, which is why they arrive as
 *   an argument rather than living as constants. Omitting `policy` entirely
 *   reproduces the pre-policy behaviour exactly.
 */
/**
 * @param {'resolved'|'unresolved'|null} [params.customerSignal] - what the
 *   customer just said about the state of their problem, when they said
 *   anything at all. "شكرًا" / "اشتغلت" is resolved; "لسه عندي نفس المشكلة"
 *   is unresolved. The engine cannot infer this from evidence — a thank-you
 *   and a complaint both produce tokens — so it is supplied by the caller,
 *   which has the language layer's read of the message.
 */
export function decide({ ranking, turn, previousDecisionState, newEvidenceAddedThisTurn, clock = defaultClock, policy: rawPolicy = {}, customerSignal = null }) {
    const prevState = previousDecisionState || createEmptyDecisionState();
    const noNewEvidence = !newEvidenceAddedThisTurn || newEvidenceAddedThisTurn === 0;
    const consecutiveNoNewEvidenceTurns = noNewEvidence ? prevState.consecutiveNoNewEvidenceTurns + 1 : 0;
    const policy = resolvePolicy(rawPolicy);

    const evaluatedRules = [];
    let decision = decideAction(
        { ranking, turn, prevState, noNewEvidence, consecutiveNoNewEvidenceTurns, policy, customerSignal },
        evaluatedRules,
        clock
    );

    // R1 (turn budget), R5's exhausted-questions branch, and R6's exhausted-
    // ambiguity branch all key off conditions that never revert once true
    // (turn only increases, questionsAskedCount only increases), so left
    // alone they'd re-decide CREATE_TICKET/ESCALATE_TO_HUMAN — and open a
    // fresh duplicate ticket — on every single subsequent turn forever. If
    // this session already has one, keep the same action (still true: a
    // human is on it) but drop ticketDraft so the Action Layer won't create
    // another, and flag it so the Dialogue Engine can phrase it as a
    // reminder rather than repeating the first-time announcement verbatim.
    const isTicketAction = decision.action === ACTIONS.CREATE_TICKET || decision.action === ACTIONS.ESCALATE_TO_HUMAN;
    if (isTicketAction && prevState.ticketAlreadyCreated) {
        decision = { ...decision, ticketDraft: null, alreadyTicketed: true };
    }

    const decisionState = updateDecisionState(prevState, decision, consecutiveNoNewEvidenceTurns);

    return { decision, decisionState };
}

function finalize(action, opts, turn, evaluatedRules, clock) {
    const { scenarioId = null, scenarioLabel = null, confidence = null, explanation, targetQuestion = null, resolution = null, ticketDraft = null, attemptNumber = null, hedged = false } = opts;
    return {
        action,
        scenarioId,
        scenarioLabel,
        confidence,
        explanation,
        evaluatedRules: [...evaluatedRules],
        timestamp: clock(),
        targetQuestion,
        resolution,
        ticketDraft,
        turn,
        attemptNumber,
        hedged
    };
}

function decideAction({ ranking, turn, prevState, noNewEvidence, consecutiveNoNewEvidenceTurns, policy, customerSignal = null }, evaluatedRules, clock) {
    const { topHypothesis, runnerUp, isAmbiguous, candidateDiscriminatingQuestions } = ranking;

    const rule0Matches = noNewEvidence && !topHypothesis && prevState.lastAction === null;
    evaluatedRules.push({
        rule: 'R0_WAIT_FOR_USER',
        matched: rule0Matches,
        detail: rule0Matches
            ? 'No evidence yet and no prior decision this session.'
            : 'Either evidence exists, a hypothesis exists, or this is not the first turn.'
    });
    if (rule0Matches) {
        return finalize(
            ACTIONS.WAIT_FOR_USER,
            { explanation: 'No interpretable content received yet in a brand-new session; waiting for a substantive message.' },
            turn, evaluatedRules, clock
        );
    }

    const rule1Matches = turn >= policy.maxTurnsBeforeEscalation;
    evaluatedRules.push({ rule: 'R1_TURN_BUDGET', matched: rule1Matches, detail: `turn=${turn}, cap=${policy.maxTurnsBeforeEscalation}` });
    if (rule1Matches) {
        return finalize(
            ACTIONS.ESCALATE_TO_HUMAN,
            {
                scenarioId: topHypothesis?.hypothesis.scenarioId ?? null,
                scenarioLabel: topHypothesis?.scenario?.label ?? null,
                confidence: topHypothesis?.hypothesis.confidence ?? null,
                explanation: `Turn ${turn} reached the maximum turn budget (${policy.maxTurnsBeforeEscalation}) without a confident, resolved diagnosis.`,
                ticketDraft: buildTicketDraft(ranking, policy)
            },
            turn, evaluatedRules, clock
        );
    }

    const rule2Matches = prevState.lastAction === ACTIONS.ANSWER && noNewEvidence;
    evaluatedRules.push({
        rule: 'R2_COMPLETE_AFTER_ANSWER',
        matched: rule2Matches,
        detail: rule2Matches
            ? `Previous action was ANSWER for "${prevState.lastScenarioId}" and no new evidence followed.`
            : 'Previous action was not ANSWER, or new evidence arrived since.'
    });
    if (rule2Matches) {
        const stillTop = topHypothesis?.hypothesis.scenarioId === prevState.lastScenarioId;
        const lastEntry = stillTop ? topHypothesis : ranking.ranked.find((r) => r.hypothesis.scenarioId === prevState.lastScenarioId);
        return finalize(
            ACTIONS.COMPLETE,
            {
                scenarioId: prevState.lastScenarioId,
                scenarioLabel: lastEntry?.scenario?.label ?? null,
                confidence: stillTop ? topHypothesis.hypothesis.confidence : null,
                explanation: `Previous turn presented a resolution for "${prevState.lastScenarioId}" and no new problem evidence followed; considering the issue resolved.`
            },
            turn, evaluatedRules, clock
        );
    }

    const rule3Matches = consecutiveNoNewEvidenceTurns >= policy.maxNoProgressTurns;
    evaluatedRules.push({ rule: 'R3_NO_PROGRESS_FALLBACK', matched: rule3Matches, detail: `consecutiveNoNewEvidenceTurns=${consecutiveNoNewEvidenceTurns}, cap=${policy.maxNoProgressTurns}` });
    if (rule3Matches) {
        return finalize(
            ACTIONS.FALLBACK,
            {
                scenarioId: topHypothesis?.hypothesis.scenarioId ?? null,
                scenarioLabel: topHypothesis?.scenario?.label ?? null,
                confidence: topHypothesis?.hypothesis.confidence ?? null,
                explanation: `${consecutiveNoNewEvidenceTurns} consecutive turns produced no new diagnostic evidence; unable to make further progress.`
            },
            turn, evaluatedRules, clock
        );
    }

    const rule4Matches = !topHypothesis;
    evaluatedRules.push({ rule: 'R4_NO_HYPOTHESES', matched: rule4Matches, detail: rule4Matches ? 'ranking.topHypothesis is null.' : 'At least one hypothesis exists.' });
    if (rule4Matches) {
        return finalize(ACTIONS.FALLBACK, { explanation: 'No ranked hypotheses are available to reason about.' }, turn, evaluatedRules, clock);
    }

    const rule5Matches = topHypothesis.hypothesis.confidence < policy.activationThreshold;
    evaluatedRules.push({
        rule: 'R5_BELOW_ACTIVATION',
        matched: rule5Matches,
        detail: `topConfidence=${topHypothesis.hypothesis.confidence.toFixed(3)}, activationThreshold=${policy.activationThreshold}`
    });
    if (rule5Matches) {
        if (prevState.questionsAskedCount < policy.maxClarifyingQuestions) {
            return finalize(
                ACTIONS.ASK_CLARIFYING_QUESTION,
                {
                    explanation: `Top hypothesis "${topHypothesis.hypothesis.scenarioId}" confidence ${topHypothesis.hypothesis.confidence.toFixed(2)} is below the activation threshold (${policy.activationThreshold}); no scenario is a real candidate yet, requesting more detail.`,
                    attemptNumber: prevState.questionsAskedCount
                },
                turn, evaluatedRules, clock
            );
        }
        return finalize(
            ACTIONS.ESCALATE_TO_HUMAN,
            { explanation: `No scenario reached the activation threshold after ${prevState.questionsAskedCount} clarifying questions.`, ticketDraft: buildTicketDraft(ranking, policy) },
            turn, evaluatedRules, clock
        );
    }

    evaluatedRules.push({
        rule: 'R6_AMBIGUOUS',
        matched: isAmbiguous,
        detail: isAmbiguous
            ? `confidenceGap=${ranking.confidenceGap?.toFixed(3)} between "${topHypothesis.hypothesis.scenarioId}" and "${runnerUp?.hypothesis.scenarioId}".`
            : 'Ranking Engine did not flag ambiguity.'
    });
    if (isAmbiguous) {
        const unasked = findUnaskedCandidateQuestion(candidateDiscriminatingQuestions, prevState.askedQuestionIds);
        if (unasked && prevState.questionsAskedCount < policy.maxClarifyingQuestions) {
            const entry = ranking.ranked.find((r) => r.hypothesis.scenarioId === unasked.scenarioId);
            return finalize(
                ACTIONS.ASK_CLARIFYING_QUESTION,
                {
                    scenarioId: unasked.scenarioId,
                    scenarioLabel: entry?.scenario?.label ?? null,
                    confidence: entry?.hypothesis.confidence ?? null,
                    explanation: `Top candidates "${topHypothesis.hypothesis.scenarioId}" (${topHypothesis.hypothesis.confidence.toFixed(2)}) and "${runnerUp.hypothesis.scenarioId}" (${runnerUp.hypothesis.confidence.toFixed(2)}) are within the ambiguity margin (gap ${ranking.confidenceGap.toFixed(2)}); asking a discriminating question to separate them.`,
                    targetQuestion: unasked.question
                },
                turn, evaluatedRules, clock
            );
        }
        if (prevState.questionsAskedCount >= policy.maxClarifyingQuestions) {
            return finalize(
                ACTIONS.ESCALATE_TO_HUMAN,
                {
                    scenarioId: topHypothesis.hypothesis.scenarioId,
                    scenarioLabel: topHypothesis.scenario?.label ?? null,
                    confidence: topHypothesis.hypothesis.confidence,
                    explanation: `Ambiguity between "${topHypothesis.hypothesis.scenarioId}" and "${runnerUp.hypothesis.scenarioId}" remains unresolved after ${prevState.questionsAskedCount} clarifying questions.`,
                    ticketDraft: buildTicketDraft(ranking, policy)
                },
                turn, evaluatedRules, clock
            );
        }
        if (hasMissingLiveEvidence(topHypothesis) && !prevState.accountDetailsRequested && policy.allowEvidenceRequests) {
            return finalize(
                ACTIONS.REQUEST_ACCOUNT_DETAILS,
                {
                    scenarioId: topHypothesis.hypothesis.scenarioId,
                    scenarioLabel: topHypothesis.scenario?.label ?? null,
                    confidence: topHypothesis.hypothesis.confidence,
                    explanation: `Ambiguity persists and "${topHypothesis.hypothesis.scenarioId}" depends on account data not yet available; requesting account details to look it up.`
                },
                turn, evaluatedRules, clock
            );
        }
        if (policy.ticketOnAmbiguity) {
            return finalize(
                ACTIONS.CREATE_TICKET,
                {
                    scenarioId: topHypothesis.hypothesis.scenarioId,
                    scenarioLabel: topHypothesis.scenario?.label ?? null,
                    confidence: topHypothesis.hypothesis.confidence,
                    explanation: `Ambiguity between "${topHypothesis.hypothesis.scenarioId}" and "${runnerUp.hypothesis.scenarioId}" cannot be further resolved automatically (no unasked discriminating questions available); escalating with the current diagnostic trail.`,
                    ticketDraft: buildTicketDraft(ranking, policy)
                },
                turn, evaluatedRules, clock
            );
        }
        // Handing off on unresolvable ambiguity is switched off, so keep
        // asking instead. R8 below still has the question budget and the
        // turn cap to stop this running forever.
        evaluatedRules.push({
            rule: 'R6_TICKET_ON_AMBIGUITY_DISABLED',
            matched: true,
            detail: 'Ambiguity is unresolvable but policy.ticketOnAmbiguity is off; continuing to refine instead of handing off.'
        });
    }

    // R6b — an answer is delivered ONCE.
    //
    // Without this the engine re-answers forever. Confidence accumulates
    // across turns and never decays, so a scenario that once cleared the
    // threshold clears it on every subsequent turn too — and R2 cannot stop
    // it, because R2 requires "no new evidence" and almost any message
    // produces some token. Observed live on Telegram: the same WhatsApp
    // answer sent four times, including in reply to "تم الحل" and to the
    // customer introducing themselves.
    //
    // Repeating a solution is never the right move. If it worked, the
    // customer has moved on; if it did not, saying it again louder does not
    // help. So once a scenario has been answered:
    //
    //   customer signalled it is resolved  -> COMPLETE, quietly
    //   otherwise                          -> the answer did not land, so a
    //                                         human takes it
    const alreadyAnswered = prevState.answeredScenarioIds.includes(topHypothesis.hypothesis.scenarioId);
    evaluatedRules.push({
        rule: 'R6B_ALREADY_ANSWERED',
        matched: alreadyAnswered,
        detail: alreadyAnswered
            ? `"${topHypothesis.hypothesis.scenarioId}" was already answered this session; refusing to repeat it.`
            : 'The leading scenario has not been answered yet this session.'
    });
    if (alreadyAnswered) {
        // "لسه عندي نفس المشكلة" is the one thing that overrides everything
        // else here: the customer is telling us plainly that the stored
        // answer failed, so no amount of accumulated confidence justifies
        // treating the issue as closed.
        const stillBroken = customerSignal === 'unresolved';
        if (!stillBroken && (customerSignal === 'resolved' || prevState.resolvedByCustomer || noNewEvidence)) {
            return finalize(
                ACTIONS.COMPLETE,
                {
                    scenarioId: topHypothesis.hypothesis.scenarioId,
                    scenarioLabel: topHypothesis.scenario?.label ?? null,
                    confidence: topHypothesis.hypothesis.confidence,
                    explanation: `"${topHypothesis.hypothesis.scenarioId}" was already answered and nothing new suggests it is still open; treating the issue as resolved.`
                },
                turn, evaluatedRules, clock
            );
        }
        return finalize(
            ACTIONS.CREATE_TICKET,
            {
                scenarioId: topHypothesis.hypothesis.scenarioId,
                scenarioLabel: topHypothesis.scenario?.label ?? null,
                confidence: topHypothesis.hypothesis.confidence,
                explanation: `"${topHypothesis.hypothesis.scenarioId}" was already answered and the customer is still describing it; the stored solution did not resolve it, so a human takes over rather than repeating it.`,
                ticketDraft: buildTicketDraft(ranking, policy)
            },
            turn, evaluatedRules, clock
        );
    }

    const rule7Matches = topHypothesis.hypothesis.confidence >= policy.resolutionConfidenceThreshold;
    evaluatedRules.push({
        rule: 'R7_CONFIDENT_LEADER',
        matched: rule7Matches,
        detail: `topConfidence=${topHypothesis.hypothesis.confidence.toFixed(3)}, resolutionThreshold=${policy.resolutionConfidenceThreshold}`
    });
    if (rule7Matches) {
        // The recorded reason distinguishes "this scenario has no stored
        // solution" from "solutions are switched off", which otherwise look
        // identical in a trace.
        // «المكتوب عنده بس»: الحالة لازم تكون مكتملة الأدلة، مش مستنتجة
        // من أجزاء. Confidence alone can clear the threshold while tokens
        // are still missing — that is inference, and this mode forbids it.
        const evidenceIncomplete =
            policy.requireCompleteEvidence &&
            (topHypothesis.hypothesis.missingEvidenceTokens || []).length > 0;
        if (evidenceIncomplete) {
            evaluatedRules.push({
                rule: 'R7_INCOMPLETE_EVIDENCE',
                matched: true,
                detail: `"${topHypothesis.hypothesis.scenarioId}" is still missing ${topHypothesis.hypothesis.missingEvidenceTokens.length} evidence token(s) and policy.requireCompleteEvidence is on; not answering from a partial match.`
            });
        }
        const autoResolutionAvailable =
            Boolean(topHypothesis.scenario?.resolution?.hasAutoResolution) &&
            policy.allowScenarioAnswers &&
            !evidenceIncomplete;
        if (autoResolutionAvailable && !policy.allowAutoResolution) {
            evaluatedRules.push({
                rule: 'R7_AUTO_RESOLUTION_DISABLED',
                matched: true,
                detail: `"${topHypothesis.hypothesis.scenarioId}" has an automatic resolution, but policy.allowAutoResolution is off; handing off to a human instead.`
            });
        }
        if (autoResolutionAvailable && policy.allowAutoResolution) {
            return finalize(
                ACTIONS.ANSWER,
                {
                    scenarioId: topHypothesis.hypothesis.scenarioId,
                    scenarioLabel: topHypothesis.scenario?.label ?? null,
                    confidence: topHypothesis.hypothesis.confidence,
                    explanation: `"${topHypothesis.hypothesis.scenarioId}" confidence ${topHypothesis.hypothesis.confidence.toFixed(2)} clears the resolution threshold (${policy.resolutionConfidenceThreshold}) and has an automatic resolution available.`,
                    resolution: topHypothesis.scenario.resolution
                },
                turn, evaluatedRules, clock
            );
        }
        if (!prevState.supplementaryEvidenceRequested && policy.allowEvidenceRequests) {
            const action = pickEvidenceRequestAction(topHypothesis.scenario?.category);
            return finalize(
                ACTIONS[action],
                {
                    scenarioId: topHypothesis.hypothesis.scenarioId,
                    scenarioLabel: topHypothesis.scenario?.label ?? null,
                    confidence: topHypothesis.hypothesis.confidence,
                    explanation: `"${topHypothesis.hypothesis.scenarioId}" confidence ${topHypothesis.hypothesis.confidence.toFixed(2)} clears the resolution threshold but has no automatic resolution; requesting supplementary evidence (category "${topHypothesis.scenario?.category}") before creating a ticket.`
                },
                turn, evaluatedRules, clock
            );
        }
        return finalize(
            ACTIONS.CREATE_TICKET,
            {
                scenarioId: topHypothesis.hypothesis.scenarioId,
                scenarioLabel: topHypothesis.scenario?.label ?? null,
                confidence: topHypothesis.hypothesis.confidence,
                explanation: `"${topHypothesis.hypothesis.scenarioId}" confidence ${topHypothesis.hypothesis.confidence.toFixed(2)} clears the resolution threshold, has no automatic resolution, and supplementary evidence was already requested; creating a ticket.`,
                ticketDraft: buildTicketDraft(ranking, policy)
            },
            turn, evaluatedRules, clock
        );
    }

    evaluatedRules.push({
        rule: 'R8_REFINE',
        matched: true,
        detail: `topConfidence=${topHypothesis.hypothesis.confidence.toFixed(3)} is active but below resolution threshold, and not ambiguous.`
    });
    const ownUnasked = findUnaskedCandidateQuestion(candidateDiscriminatingQuestions, prevState.askedQuestionIds, topHypothesis.hypothesis.scenarioId);
    if (ownUnasked && prevState.questionsAskedCount < policy.maxClarifyingQuestions) {
        return finalize(
            ACTIONS.ASK_CLARIFYING_QUESTION,
            {
                scenarioId: topHypothesis.hypothesis.scenarioId,
                scenarioLabel: topHypothesis.scenario?.label ?? null,
                confidence: topHypothesis.hypothesis.confidence,
                explanation: `"${topHypothesis.hypothesis.scenarioId}" confidence ${topHypothesis.hypothesis.confidence.toFixed(2)} is below the resolution threshold (${policy.resolutionConfidenceThreshold}); asking a discriminating question to confirm it.`,
                targetQuestion: ownUnasked.question
            },
            turn, evaluatedRules, clock
        );
    }
    if (hasMissingLiveEvidence(topHypothesis) && !prevState.accountDetailsRequested) {
        return finalize(
            ACTIONS.REQUEST_ACCOUNT_DETAILS,
            {
                scenarioId: topHypothesis.hypothesis.scenarioId,
                scenarioLabel: topHypothesis.scenario?.label ?? null,
                confidence: topHypothesis.hypothesis.confidence,
                explanation: `"${topHypothesis.hypothesis.scenarioId}" depends on account data not yet available; requesting account details to verify.`
            },
            turn, evaluatedRules, clock
        );
    }
    if (prevState.questionsAskedCount < policy.maxClarifyingQuestions) {
        return finalize(
            ACTIONS.ASK_CLARIFYING_QUESTION,
            {
                scenarioId: topHypothesis.hypothesis.scenarioId,
                scenarioLabel: topHypothesis.scenario?.label ?? null,
                confidence: topHypothesis.hypothesis.confidence,
                explanation: `"${topHypothesis.hypothesis.scenarioId}" confidence ${topHypothesis.hypothesis.confidence.toFixed(2)} is below the resolution threshold with no specific discriminating question available; requesting more detail.`,
                attemptNumber: prevState.questionsAskedCount
            },
            turn, evaluatedRules, clock
        );
    }
    if (!prevState.verificationDone) {
        return finalize(
            ACTIONS.VERIFY_INFORMATION,
            {
                scenarioId: topHypothesis.hypothesis.scenarioId,
                scenarioLabel: topHypothesis.scenario?.label ?? null,
                confidence: topHypothesis.hypothesis.confidence,
                explanation: `Question budget (${policy.maxClarifyingQuestions}) exhausted without reaching the resolution threshold for "${topHypothesis.hypothesis.scenarioId}"; confirming current understanding before escalating.`
            },
            turn, evaluatedRules, clock
        );
    }
    // R9 — smart guess. Everything else is exhausted: questions are spent,
    // verification is done, and the next step is a hand-off. If the leader is
    // only just short of the threshold and does have a stored solution, offer
    // it as a likelihood rather than making the customer wait for a human.
    //
    // Gated on a NARROW margin, and only here at the very end, because a
    // wrong answer costs more than a slow one — a customer who acts on a bad
    // guess is worse off than one who waited. `hedged` tells the Dialogue
    // Engine to phrase it as "most likely", never as a diagnosis.
    const guessGap = policy.resolutionConfidenceThreshold - topHypothesis.hypothesis.confidence;
    const canGuess =
        policy.smartGuessMargin > 0 &&
        guessGap <= policy.smartGuessMargin &&
        policy.allowScenarioAnswers &&
        policy.allowAutoResolution &&
        Boolean(topHypothesis.scenario?.resolution?.hasAutoResolution);

    evaluatedRules.push({
        rule: 'R9_SMART_GUESS',
        matched: canGuess,
        detail: policy.smartGuessMargin > 0
            ? `gapToThreshold=${guessGap.toFixed(3)}, guessMargin=${policy.smartGuessMargin}, hasAutoResolution=${Boolean(topHypothesis.scenario?.resolution?.hasAutoResolution)}`
            : 'policy.allowSmartGuess is off.'
    });
    if (canGuess) {
        return finalize(
            ACTIONS.ANSWER,
            {
                scenarioId: topHypothesis.hypothesis.scenarioId,
                scenarioLabel: topHypothesis.scenario?.label ?? null,
                confidence: topHypothesis.hypothesis.confidence,
                explanation: `"${topHypothesis.hypothesis.scenarioId}" confidence ${topHypothesis.hypothesis.confidence.toFixed(2)} is within the smart-guess margin (${policy.smartGuessMargin}) of the threshold and every other avenue is exhausted; offering its resolution as a likelihood.`,
                resolution: topHypothesis.scenario.resolution,
                hedged: true
            },
            turn, evaluatedRules, clock
        );
    }

    return finalize(
        ACTIONS.CREATE_TICKET,
        {
            scenarioId: topHypothesis.hypothesis.scenarioId,
            scenarioLabel: topHypothesis.scenario?.label ?? null,
            confidence: topHypothesis.hypothesis.confidence,
            explanation: `Confidence for "${topHypothesis.hypothesis.scenarioId}" plateaued at ${topHypothesis.hypothesis.confidence.toFixed(2)} with no further automated disambiguation available; creating a ticket.`,
            ticketDraft: buildTicketDraft(ranking, policy)
        },
        turn, evaluatedRules, clock
    );
}

function updateDecisionState(prevState, decision, consecutiveNoNewEvidenceTurns) {
    const askedQuestionIds =
        decision.action === ACTIONS.ASK_CLARIFYING_QUESTION && decision.targetQuestion
            ? [...prevState.askedQuestionIds, decision.targetQuestion.id]
            : prevState.askedQuestionIds;

    const questionsAskedCount =
        decision.action === ACTIONS.ASK_CLARIFYING_QUESTION ? prevState.questionsAskedCount + 1 : prevState.questionsAskedCount;

    const isEvidenceRequestAction = [ACTIONS.ASK_FOR_SCREENSHOT, ACTIONS.ASK_FOR_ATTACHMENT, ACTIONS.ASK_FOR_LOGS].includes(decision.action);

    const ticketAlreadyCreated =
        prevState.ticketAlreadyCreated ||
        (decision.action === ACTIONS.CREATE_TICKET || decision.action === ACTIONS.ESCALATE_TO_HUMAN);

    const answeredScenarioIds =
        decision.action === ACTIONS.ANSWER && decision.scenarioId
            ? [...new Set([...prevState.answeredScenarioIds, decision.scenarioId])]
            : prevState.answeredScenarioIds;

    return {
        askedQuestionIds,
        questionsAskedCount,
        supplementaryEvidenceRequested: prevState.supplementaryEvidenceRequested || isEvidenceRequestAction,
        accountDetailsRequested: prevState.accountDetailsRequested || decision.action === ACTIONS.REQUEST_ACCOUNT_DETAILS,
        verificationDone: prevState.verificationDone || decision.action === ACTIONS.VERIFY_INFORMATION,
        consecutiveNoNewEvidenceTurns,
        lastAction: decision.action,
        lastScenarioId: decision.scenarioId,
        answeredScenarioIds,
        resolvedByCustomer: prevState.resolvedByCustomer || decision.action === ACTIONS.COMPLETE,
        ticketAlreadyCreated,
        history: [
            ...prevState.history,
            { turn: decision.turn, action: decision.action, scenarioId: decision.scenarioId, confidence: decision.confidence, explanation: decision.explanation }
        ]
    };
}
