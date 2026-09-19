/**
 * text-safety.js
 * ------------------------------------------------------------
 * تحييد الترميز في نص المستخدم — making a span of customer-authored text safe
 * to place inside a message the engine is sending as itself.
 *
 * ------------------------------------------------------------
 * WHY THIS IS IN THE LANGUAGE LAYER
 *
 * The POLICY — which spans need this, and why quoting user text back is a
 * trust-boundary crossing at all — belongs to sie/trust, and
 * `trust/egress-guard.js` carries it, including the verified vulnerability
 * that motivated it.
 *
 * The MECHANISM is a text operation, and text operations belong here. Keeping
 * them apart matters for one concrete reason: this file has to be callable
 * from the language layer itself. `memory-intent.js` renders stored facts into
 * replies, and it cannot import from layer 10 without inverting the dependency
 * graph — which today has no layering violations and is worth keeping that way.
 *
 * So: mechanism here, policy in trust, and trust re-exports this so callers who
 * think in terms of checkpoints still find it where they expect.
 *
 * ------------------------------------------------------------
 * WHAT IT DEFENDS AGAINST, CONCRETELY
 *
 * Replies leave this system through `channels/telegram/telegram-api.js` with
 * `parse_mode: 'Markdown'`, and nothing on that path escapes anything. A
 * stored note containing `[اضغط هنا](https://…)` therefore comes back as a
 * live hyperlink rendered in the brand's voice, inside a message the customer
 * did not write this turn and has no reason to distrust.
 * `disable_web_page_preview` suppresses the preview card; it does not make the
 * link unclickable.
 */

/** Stored text is a quotation inside a reply, not a document. */
const MAX_QUOTED_LENGTH = 200;

/**
 * Makes one span of user-authored text safe to place inside a reply.
 *
 * @param {string} text
 * @param {Object} [options]
 * @param {number} [options.maxLength]
 * @returns {string}
 */
export function neutralizeUserText(text, { maxLength = MAX_QUOTED_LENGTH } = {}) {
    if (typeof text !== 'string' || text === '') return '';

    let out = text;

    // 1. Link syntax, label kept. This is the vector that matters: it is the
    //    only markup here that can send someone somewhere.
    out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

    // 2. Emphasis and code actives. Removed rather than escaped because the
    //    legacy Markdown dialect Telegram is being asked for does not honour
    //    backslash escapes reliably, and a half-working escape is worse than
    //    none — it reads as safe.
    out = out.replace(/[*_`~\[\]]/g, '');

    // 3. Structure. Newlines let quoted text forge its own bullets and
    //    paragraphs, which is how a quotation starts looking like the sender.
    out = out.replace(/[\r\n\u2028\u2029]+/g, ' ');

    // 4. Invisible characters: control codes, zero-width joiners and the
    //    bidirectional overrides, which can reorder rendered text so that what
    //    is displayed differs from what is stored.
    // eslint-disable-next-line no-control-regex
    out = out.replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '');

    out = out.replace(/\s+/g, ' ').trim();
    if (out.length > maxLength) out = `${out.slice(0, maxLength - 1)}…`;
    return out;
}

