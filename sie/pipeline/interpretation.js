/**
 * interpretation.js
 * ------------------------------------------------------------
 * مرحلة التفسير — what KIND of message is this?
 *
 * ------------------------------------------------------------
 * WHY THIS STAGE EXISTS, AND WHY IT IS NEW
 *
 * The nine-stage decomposition has no stage for the question every turn
 * actually asks first: *is this a problem to diagnose at all?*
 *
 * Because there is no stage for it, the answer is assembled in
 * `sie-chat-bridge.js` out of six conditionals with early returns, spread
 * across ~120 lines and interleaved with the I/O each one performs. The file
 * has 39 return points. That is not a criticism of how it was written — each
 * check was correct when it was added — but the shape has three costs that
 * compound:
 *
 *   1. The ORDER is invisible. Whether small talk is checked before or after
 *      the memory intent is a real behavioural decision, and it is currently
 *      expressed only as the order of statements in a long function.
 *   2. It cannot be tested without a Supabase double, because classification
 *      and effect are the same statement.
 *   3. It cannot be traced. A turn that exits at check 2 and a turn that
 *      reaches diagnosis are indistinguishable in the trace.
 *
 * This module answers the question and nothing else: it takes text and
 * context, and returns a KIND plus the annotations the caller needs. It reads
 * no database, writes no state, and performs no effect. The bridge keeps
 * every effect it already had; what it loses is the decision about which one
 * to perform.
 *
 * ------------------------------------------------------------
 * THE ORDER, AND WHY IT IS THIS ORDER
 *
 * Made explicit because it is a real design decision, not an accident of
 * which check was written first:
 *
 *   1. PENDING_CONFIRMATION — the engine asked a yes/no question last turn.
 *      Nothing else may interpret the answer, because "أيوه" means
 *      whatever the pending question made it mean.
 *   2. ESCALATION — an explicit request for a human, or anger. Honoured
 *      before anything tries to be clever, because a customer asking for a
 *      person has already told you the automated path failed.
 *   3. MEMORY — "احفظ ده" / "انت فاكر إيه عني" are instructions ABOUT the
 *      conversation. Running them through diagnosis produced unrelated
 *      answers, which is why the check exists.
 *   4. RESOLUTION — "تمام اتحلت" after the engine actually answered. Ends
 *      the conversation and clears diagnostic state.
 *   5. SMALL_TALK — greetings and identity questions. After memory and
 *      resolution because "شكرًا" is both a pleasantry and a resolution
 *      signal, and the resolution reading is the one that matters when the
 *      engine has just answered.
 *   6. DIAGNOSTIC — everything else. The default, deliberately: an
 *      unrecognised message is a problem report, not noise.
 *
 * Emotion is an ANNOTATION, not a kind. It rides along with whatever the
 * message turned out to be, because a customer can be angry and still be
 * describing a specific problem — and the old code treated frustration as a
 * small-talk TYPE, which meant an angry problem report lost its problem.
 */
import { detectSmallTalk } from '../language/small-talk.js';
import { detectEmotion, shouldEscalateForEmotion, detectResolutionSignal } from '../language/emotion-detector.js';
import { detectMemoryIntent } from '../language/memory-intent.js';

/** The kinds a turn can be. Exhaustive and mutually exclusive. */
export const TURN_KINDS = Object.freeze({
    PENDING_CONFIRMATION: 'pending_confirmation',
    ESCALATION: 'escalation',
    MEMORY: 'memory',
    RESOLUTION: 'resolution',
    SMALL_TALK: 'small_talk',
    DIAGNOSTIC: 'diagnostic'
});

/**
 * @typedef {Object} Interpretation
 * @property {string} kind              one of TURN_KINDS
 * @property {string|null} reason       why this kind, for the trace
 * @property {Object|null} emotion      annotation, independent of kind
 * @property {Object|null} smallTalk    the small-talk reading, when there was one
 * @property {Object|null} memoryIntent the memory reading, when kind is MEMORY
 * @property {string|null} resolutionSignal
 * @property {boolean} escalatesToHuman
 */

/**
 * @param {Object} params
 * @param {string} params.text                   the raw message
 * @param {Object} [params.previous]             previous SIE state
 * @param {Object} [params.settings]             engine settings
 * @param {string[]} [params.enabledEmotions]
 * @returns {Interpretation}
 */
export function interpretTurn({ text, previous = null, settings = {}, enabledEmotions = undefined } = {}) {
    const raw = typeof text === 'string' ? text : '';

    const emotion = settings.emotion_detection === false
        ? null
        : detectEmotion(raw, enabledEmotions ? { enabled: enabledEmotions } : undefined);

    const smallTalk = detectSmallTalk(raw);
    const resolutionSignal = detectResolutionSignal(raw);
    const memoryIntent = detectMemoryIntent(raw, previous?.lastCustomerText || '');

    const base = { emotion, smallTalk, memoryIntent, resolutionSignal, escalatesToHuman: false };

    // 1. A pending yes/no owns the turn.
    if (previous?.pendingTicketConfirmation) {
        return { ...base, kind: TURN_KINDS.PENDING_CONFIRMATION, reason: 'a ticket confirmation was pending' };
    }

    // 2. Escalation. `wantsHuman` is honoured whatever the settings say —
    //    «يرد على التحيات» is about pleasantries and must not silently
    //    disable an explicit request for a person.
    const wantsHuman = smallTalk?.type === 'human_request';
    const angerEscalates = shouldEscalateForEmotion(emotion) && settings.ticket_on_anger !== false;
    const legacyFrustration = smallTalk?.type === 'frustration' && settings.ticket_on_anger !== false;
    if (wantsHuman || angerEscalates || legacyFrustration) {
        return {
            ...base,
            kind: TURN_KINDS.ESCALATION,
            escalatesToHuman: true,
            reason: wantsHuman ? 'human_request' : 'frustration'
        };
    }

    // 3. Instructions about the conversation itself.
    if (memoryIntent) {
        return { ...base, kind: TURN_KINDS.MEMORY, reason: `memory:${memoryIntent.kind}` };
    }

    // 4. "That worked" — but only once the engine has actually answered
    //    something. Before that, "تمام" is a pleasantry.
    const alreadyAnswered = (previous?.decisionState?.answeredScenarioIds || []).length > 0;
    if (resolutionSignal === 'resolved' && alreadyAnswered) {
        return { ...base, kind: TURN_KINDS.RESOLUTION, reason: 'resolution signal after an answer' };
    }

    // 5. Pleasantries.
    if (smallTalk) {
        return { ...base, kind: TURN_KINDS.SMALL_TALK, reason: `small_talk:${smallTalk.type}` };
    }

    // 6. Default: a problem to diagnose.
    return { ...base, kind: TURN_KINDS.DIAGNOSTIC, reason: null };
}

/** The compact projection for a TraceEvent. */
export function interpretationTrace(interpretation) {
    if (!interpretation) return null;
    return {
        kind: interpretation.kind,
        reason: interpretation.reason,
        emotion: interpretation.emotion?.type ?? null
    };
}
