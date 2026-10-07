/**
 * signals.js — Layer 1's context-free reading of one message.
 * ------------------------------------------------------------
 * Every conversational signal the engine routes on is computed HERE, once,
 * from the text normalize() actually kept and the tokens it produced. No
 * consumer classifies raw text (G-L1-6): the bridge and the vNext
 * interpretation both read this object.
 *
 * Layer 1 detects; it does not decide. Whether a greeting is answered, a
 * request for a person escalated or a "that worked" closes the conversation
 * is the caller's decision — this module only says what the message says.
 *
 *   diagnosticContent  a token describes a problem (G-L1-3)
 *   smallTalk          {type, matched, coversWholeMessage} — the pleasantry,
 *                      and whether it IS the whole message
 *   humanRequest       {explicit: true} when the customer asks for a person
 *   emotion            {emotion, intensity, matched, negative} (not negated)
 *   threat             {matched} — legal action, refund, cancellation, public
 *                      exposure (not negated, not asked); null when emotion
 *                      detection or the anger emotion is off
 *   resolution         'resolved' | 'unresolved' | null (negation-aware)
 *   memory             {kind, facts, explicit, standalone} | null
 *   replyPolarity      'yes' | 'no' | null — for a pending yes/no prompt
 *   truncated, receivedChars — so every consumer knows what was not read
 */
import { analyzeMessage, hasDiagnosticContent } from './lexicon-match.js';
import { detectSmallTalk } from './small-talk.js';
import { detectEmotion, detectResolutionSignal, detectThreat } from './emotion-detector.js';
import { detectMemoryIntent } from './memory-intent.js';
import { replyPolarity } from './reply-polarity.js';

/**
 * @param {Object} params
 * @param {string} params.text            normalize()'s rawText — what Layer 1 read
 * @param {Array} [params.tokens]         normalize()'s normalizedTokens
 * @param {string} [params.previousText]  the customer's previous message (memory "save this")
 * @param {Iterable<string>} [params.enabledEmotions]
 * @param {boolean} [params.emotionDetection=true]
 * @param {boolean} [params.truncated=false]
 * @param {number} [params.receivedChars]
 */
export function analyzeSignals({ text, tokens = [], previousText = '', enabledEmotions, emotionDetection = true, truncated = false, receivedChars } = {}) {
    const raw = typeof text === 'string' ? text : (text === null || text === undefined ? '' : String(text));
    const analysis = analyzeMessage(raw);
    const diagnosticContent = hasDiagnosticContent(tokens);
    const smallTalk = detectSmallTalk(raw, { diagnosticContent, analysis });
    const angerEnabled = !enabledEmotions || [...enabledEmotions].includes('anger');
    return {
        diagnosticContent,
        smallTalk,
        humanRequest: smallTalk?.type === 'human_request' ? { explicit: true } : null,
        emotion: emotionDetection ? detectEmotion(raw, { enabled: enabledEmotions, analysis }) : null,
        threat: emotionDetection && angerEnabled ? detectThreat(raw, { analysis }) : null,
        resolution: detectResolutionSignal(raw, { analysis }),
        memory: detectMemoryIntent(raw, typeof previousText === 'string' ? previousText : '', { tokens: Array.isArray(tokens) ? tokens : [], diagnosticContent }),
        replyPolarity: replyPolarity(raw, { diagnosticContent, analysis }),
        truncated: Boolean(truncated),
        receivedChars: Number.isFinite(receivedChars) ? receivedChars : raw.length
    };
}

/** The compact projection a trace stores: what Layer 1 saw, without customer text. */
export function signalsTrace(signals) {
    if (!signals) return null;
    return {
        truncated: signals.truncated,
        receivedChars: signals.receivedChars,
        diagnosticContent: signals.diagnosticContent,
        smallTalk: signals.smallTalk ? { type: signals.smallTalk.type, coversWholeMessage: signals.smallTalk.coversWholeMessage } : null,
        emotion: signals.emotion?.emotion ?? null,
        threat: Boolean(signals.threat),
        resolution: signals.resolution,
        memory: signals.memory ? { kind: signals.memory.kind, explicit: signals.memory.explicit, standalone: signals.memory.standalone } : null,
        replyPolarity: signals.replyPolarity
    };
}
