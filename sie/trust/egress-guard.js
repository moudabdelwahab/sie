/**
 * egress-guard.js
 * ------------------------------------------------------------
 * CHECKPOINT 4 — protects the engine's own voice.
 *
 * ------------------------------------------------------------
 * THE CROSSING THIS DEFENDS, AND WHY IT IS REAL HERE
 *
 * The other three checkpoints stop user text from becoming belief, state or
 * action. This one stops it from becoming SPEECH — specifically, from being
 * quoted back inside a message the customer reads as the company talking.
 *
 * This is not hypothetical in this codebase. Verified while building this
 * layer:
 *
 *   - `MEMORY_REPLIES.recalled` in sie/language/memory-intent.js renders
 *     stored facts as `• ${f.value}` — raw customer-authored text, up to 500
 *     characters, inside the bot's own bullet list.
 *   - `channels/telegram/telegram-api.js` sends every reply with
 *     `parse_mode: 'Markdown'`.
 *   - Nothing between them escapes anything. There is no sanitiser on the
 *     reply path.
 *
 * So a stored note containing `[اضغط هنا](https://…)` comes back as a live
 * hyperlink, rendered in the brand's voice, in a message the customer did not
 * write that turn and has no reason to distrust. `disable_web_page_preview`
 * suppresses the preview card; it does not make the link unclickable.
 *
 * CHECKED AND CLEARED, so the record is complete: the admin review centre
 * (sie/observability/admin-ui/review-center.js) DOES escape customer text with
 * `escapeHtml` at every innerHTML interpolation. There is no XSS there. The
 * defect is Markdown link injection on the Telegram path, and that is all it
 * is — overstating it would make the rest of this analysis worth less.
 *
 * ------------------------------------------------------------
 * WHY NEUTRALISE HERE RATHER THAN FIX THE CHANNEL
 *
 * The correct long-term fix is `parse_mode: 'MarkdownV2'` with proper escaping
 * at the channel boundary, which is where escaping belongs. That change alters
 * how EVERY reply renders, including authored scenario content that uses
 * `**bold**` deliberately, so it is a production behaviour change that needs
 * its own measurement and its own rollout. It is recorded as follow-up.
 *
 * What this guard does instead is narrower and safe to ship now: it neutralises
 * markup in the spans that are USER-DERIVED, and leaves authored content
 * untouched. That removes the vector without touching how the engine's own
 * copy renders.
 */

import { neutralizeUserText } from '../language/text-safety.js';

// The mechanism lives in sie/language/text-safety.js so that the language
// layer can call it without depending on layer 10. Re-exported here because
// this is where it is a CHECKPOINT rather than a string function, and callers
// reasoning about checkpoints should find it here.
export { neutralizeUserText };

/**
 * Applies `neutralizeUserText` to each stored fact's value.
 *
 * @param {Array<{key: string, value: string}>} facts
 * @returns {Array<{key: string, value: string}>}
 */
export function guardQuotedFacts(facts) {
    if (!Array.isArray(facts)) return [];
    return facts.map((f) => ({ ...f, value: neutralizeUserText(f?.value) }));
}
