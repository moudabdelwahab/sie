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
 * ⚠️ Written against the LIVE schema, which differs from the migration file
 * in this repo: live has (session_id, status, corrected_scenario_id,
 * reviewed_by, reviewed_at, notes, created_at) and has no `reason` or
 * `triggered_by_turn` column. Verified against information_schema, not
 * assumed from the migration.
 */

/** الوعد اللي بنقوله للعميل — لازم يطابق اللي فريق الدعم بيقدر يلتزم بيه. */
export const HUMAN_FOLLOWUP_HOURS = 24;

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
        // Already queued and still open? Do not stack duplicates — a customer
        // who declines twice in one conversation is one case, not two, and a
        // review list full of repeats is a review list nobody reads.
        const { data: existing } = await supabase
            .from('chat_engine_conversation_reviews')
            .select('id')
            .eq('session_id', sessionId)
            .in('status', ['open', 'in_review'])
            .limit(1);

        if (existing && existing.length > 0) {
            return { queued: true, id: existing[0].id };
        }

        const { data, error } = await supabase
            .from('chat_engine_conversation_reviews')
            .insert({
                session_id: sessionId,
                status: 'open',
                corrected_scenario_id: scenarioId,
                notes: buildNote({ turn, note })
            })
            .select('id')
            .single();

        if (error) {
            console.error('[sie] could not queue the conversation for review:', error.message);
            return { queued: false, id: null };
        }
        return { queued: true, id: data.id };
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

/**
 * ما بنقوله للعميل لما نسجّل المحادثة بدل ما نفتح تذكرة.
 *
 * Deliberately does not mention a ticket number, because there is none —
 * promising a reference the customer cannot look up is how "I contacted
 * support" becomes "support has no record of me".
 */
export const REVIEW_QUEUED_TEXT = {
    ar: `تمام، مش هفتح تذكرة. بس سجّلت المحادثة دي لفريق الدعم عشان يشوفوها، `
        + `وهيتواصلوا معاك خلال ${HUMAN_FOLLOWUP_HOURS} ساعة.`,
    en: `Understood — no ticket. I have flagged this conversation for the support team, `
        + `and they will get in touch within ${HUMAN_FOLLOWUP_HOURS} hours.`
};

/**
 * The honest fallback when the record could NOT be written.
 *
 * Never promises the 24 hours, because nothing was queued to honour it.
 */
export const REVIEW_QUEUE_FAILED_TEXT = {
    ar: 'تمام، مش هفتح تذكرة. لو المشكلة فضلت، تواصل مع فريق الدعم من المنصة وهما هيساعدوك.',
    en: 'Understood — no ticket. If the problem persists, contact the support team from the platform.'
};
