/**
 * question-answer.js
 * ------------------------------------------------------------
 * إجابة السؤال التوضيحي — turning the customer's answer to a discriminating
 * question into the evidence that answer was written to imply.
 *
 * ------------------------------------------------------------
 * THE DEFECT THIS CLOSES
 *
 * Eighty scenarios carry discriminating questions, and every option of every
 * question declares `impliesEvidence` — the tokens that answer confirms. The
 * renderer sends each option as a quick-reply button whose VALUE is the
 * option's machine value ("debited_only", "no_such_address", …). When the
 * customer taps it, that value comes back as the next message.
 *
 * Nothing read `impliesEvidence`. The value was normalized like free text,
 * produced no evidence at all, and the engine carried on as if the customer
 * had said nothing. Production trace, 2026-09: the customer tapped
 * "debited_only" on a subscription question and was handed a ticket for
 * `subscription_expired` — the one reading their answer ruled out.
 *
 * ------------------------------------------------------------
 * THE CONTRACT
 *
 * Pure. Given the decision state and a way to look a scenario up, returns the
 * implied evidence for this turn, or null. Only the question asked on the
 * immediately preceding turn is considered (decisionState.pendingQuestion),
 * and only an answer that IS one of its options — its value, or its label in
 * either language, compared after normalization. A free-text answer is left
 * to the language layer, which is where free text belongs; guessing which
 * option a sentence "meant" would be a second, hidden classifier.
 *
 * The returned evidence goes through the same trust boundary as every other
 * piece of evidence (CP2), so a forged option value cannot buy influence the
 * catalog did not already grant that option.
 */
import { normalizeArabicToken } from '../language/dialect-normalizer.js';
import { extractDiscriminatingAnswerEvidence } from './evidence-extractor.js';

const ICON_MARKUP = /\[\[icon:[a-z_]+\]\]/g;

function comparable(text) {
    return normalizeArabicToken(String(text || '').replace(ICON_MARKUP, ' ')).trim();
}

/**
 * @param {Object} params
 * @param {string} params.text
 * @param {Object} params.decisionState      the PREVIOUS turn's decision state
 * @param {(id: string) => (Object|null|Promise<Object|null>)} params.lookup scenario by id
 * @param {number} params.turn
 * @returns {Promise<null | { scenarioId: string, questionId: string, optionValue: string, evidence: Array }>}
 */
export async function evidenceFromQuestionAnswer({ text, decisionState, lookup, turn }) {
    const pending = decisionState?.pendingQuestion;
    if (!pending || typeof pending !== 'object') return null;
    if (typeof pending.scenarioId !== 'string' || typeof pending.questionId !== 'string') return null;
    const answer = comparable(text);
    if (!answer || answer.length > 200) return null;

    const scenario = await lookup(pending.scenarioId);
    const question = (scenario?.discriminatingQuestions || []).find((q) => q?.id === pending.questionId);
    if (!question) return null;

    for (const option of question.options || []) {
        const forms = [option.value, option.label?.ar, option.label?.en].map(comparable).filter(Boolean);
        if (!forms.includes(answer)) continue;
        const evidence = extractDiscriminatingAnswerEvidence({ impliedTokens: option.impliesEvidence || [], turn });
        return { scenarioId: pending.scenarioId, questionId: question.id, optionValue: option.value, evidence };
    }
    return null;
}
