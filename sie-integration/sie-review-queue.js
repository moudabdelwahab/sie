/**
 * sie-review-queue.js  —  INTERNAL TO SIE
 * ------------------------------------------------------------
 * المحادثات اللي محتاجة تدخّل بشري من غير ما العميل يوافق على تذكرة.
 *
 * ⚠️ Not a public surface — Mad3oom imports sie-runtime.js.
 *
 * ------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The engine reaching "a human should see this" and the customer wanting a
 * ticket are two different things. Before this, they were the same thing:
 * escalation opened a ticket, full stop. A customer who said "no thanks"
 * left no trace at all, so the case the engine had already judged
 * hand-off-worthy simply evaporated.
 *
 * That is the worst outcome available. The customer declined the paperwork,
 * not the help — and the engine's own judgement that a person is needed is
 * exactly the signal a support team wants.
 *
 * So a decline records the conversation in the Review Center instead. No
 * ticket, no ticket number, no notification noise for the customer, but the
 * team sees it and has 24 hours to reach out — which is what the customer
 * is told.
 *
 * ------------------------------------------------------------
 * WHY chat_engine_conversation_reviews
 *
 * The table already exists and already means "a human should look at this
 * conversation". Adding a second queue would split the one place staff
 * check into two.
 *
 * ------------------------------------------------------------
 * WHY AN RPC AND NOT A DIRECT INSERT
 *
 * The table's only policy is `is_chat_engine_staff()`. On Telegram this
 * code runs as service_role and an insert would succeed; on the website it
 * runs as the customer, who is not staff, and the insert is refused. The
 * customer would then be told a human will be in touch within 24 hours
 * with nothing recorded to make that true — and the bug would only ever
 * appear on the platform, never on the bot.
 *
 * queue_conversation_for_review (migration 0007) is SECURITY DEFINER and
 * derives its authority from ownership of the session, so both callers
 * work and neither can write a row for someone else's conversation.
 *
 * ⚠️ Three things about the LIVE table that the repo's older migration
 * file does not say, all verified against the catalog rather than assumed:
 *   - columns are (session_id, status, corrected_scenario_id, reviewed_by,
 *     reviewed_at, notes, created_at) — no `reason`, no `triggered_by_turn`
 *   - status is CHECKed against ('unresolved', 'reviewed', 'corrected').
 *     There is no 'open'; writing one is rejected outright.
 *   - UNIQUE (session_id) — one review per conversation, which is what
 *     makes a second decline in the same chat a no-op rather than a
 *     duplicate.
 */

/** الوعد اللي بنقوله للعميل — لازم يطابق اللي فريق الدعم بيقدر يلتزم بيه. */
import { HUMAN_FOLLOWUP_HOURS } from '../sie/dialogue/templates/conversational.js';

export { HUMAN_FOLLOWUP_HOURS };

/**
 * Records a conversation as needing human attention, without a ticket.
 *
 * Fails soft and says so: the caller must know whether the promise it is
 * about to make to the customer is backed by a row. Telling someone "we
 * will contact you within 24 hours" when nothing was recorded is worse
 * than admitting the request did not go through.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {number} params.turn
 * @param {string|null} [params.scenarioId] - the engine's best guess, for triage
 * @param {string} [params.note] - why it was queued, in Arabic, for staff
 * @returns {Promise<{queued: boolean, id: string|null}>}
 */
export async function queueForHumanReview(supabase, { sessionId, turn, scenarioId = null, note = '' }) {
    if (!sessionId) return { queued: false, id: null };

    try {
        // Deduplication is the table's UNIQUE (session_id) plus the RPC's
        // ON CONFLICT, not a read-then-write here: a customer who declines
        // twice in one conversation is one case, and checking first would
        // race with itself on a double tap.
        const { data, error } = await supabase.rpc('queue_conversation_for_review', {
            p_session_id: sessionId,
            p_scenario_id: scenarioId,
            p_notes: buildNote({ turn, note })
        });

        if (error) {
            console.error('[sie] could not queue the conversation for review:', error.message);
            return { queued: false, id: null };
        }
        return { queued: Boolean(data), id: data ?? null };
    } catch (err) {
        console.error('[sie] queueing for review threw:', err?.message || err);
        return { queued: false, id: null };
    }
}

/**
 * The note a support agent reads first. Arabic, because the people working
 * this queue work in Arabic, and specific about WHY it is here — "declined
 * a ticket" and "the engine gave up" call for different handling.
 */
function buildNote({ turn, note }) {
    const parts = [
        `العميل رفض فتح تذكرة، والمحرك شايف إن المحادثة محتاجة تدخّل بشري.`,
        note ? `السبب: ${note}` : null,
        `الدور رقم ${turn}.`,
        `اتوعد العميل بالتواصل خلال ${HUMAN_FOLLOWUP_HOURS} ساعة.`
    ];
    return parts.filter(Boolean).join(' ');
}

// The customer-facing texts for a queued decline live in Dialogue
// (sie/dialogue/templates/conversational.js) since WP4; re-exported here for
// existing importers.
export { REVIEW_QUEUED_TEXT, REVIEW_QUEUE_FAILED_TEXT } from '../sie/dialogue/templates/conversational.js';
