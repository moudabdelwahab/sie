/**
 * channel-entitlement.js
 * ------------------------------------------------------------
 * ليه المحرك مارّدش؟ — شرح بالعربي للعميل على قناة خارجية.
 *
 * ------------------------------------------------------------
 * READ-ONLY, AND THAT IS THE POINT
 *
 * Nothing here spends anything. SIE meters itself, inside getSieReply(),
 * through sie_consume_message() — one metering path for every channel,
 * which is what stops a channel and the engine from both charging for the
 * same turn.
 *
 * (That function was taught about service-role callers so it works from a
 * webhook, where there is no session. Its three rules and their order are
 * unchanged; see the migration for why that is safe.)
 *
 * What is missing after a refusal is the REASON. getSieReply() returns a
 * bare null, because on the website Mad3oom just falls back to its own bot
 * and never needs to explain. A messaging channel has no second engine to
 * fall back to, so silence is the only alternative to an explanation —
 * and "the bot ignored me" is the worst possible outcome for a customer
 * whose subscription simply expired.
 *
 * So after a null, this reads the access row (free, no quota) and turns it
 * into a sentence. It reuses evaluateSieAccessRow() from the runtime
 * rather than re-deriving the rules, so the explanation and the
 * enforcement cannot disagree.
 */

/**
 * ردود الرفض. عربي، ومحددة، لأن العميل على قناة خارجية مالوش لوحة
 * يشوف فيها السبب.
 */
export const ENTITLEMENT_REPLIES = Object.freeze({
    no_access_row: 'حسابك مش مفعّل على المساعد الذكي. كلّم فريق الدعم من المنصة وهما هيفعّلوهولك.',
    disabled: 'المساعد الذكي متوقف على حسابك دلوقتي. كلّم فريق الدعم لو محتاج تفعيله تاني.',
    expired: 'اشتراكك في المساعد الذكي خلص. جدّده من المنصة وهرجع أساعدك على طول.',
    quota_exceeded: 'خلصت رسايلك المتاحة على المساعد الذكي للفترة دي. تقدر تزوّد الباقة من المنصة.',
    // Entitlement was fine, so the null came from somewhere else in the
    // pipeline — a settings switch, or an internal failure. Do not claim a
    // billing problem the customer does not have.
    unknown: 'حصلت مشكلة مؤقتة عندي وأنا بحاول أرد عليك. جرّب تبعت الرسالة تاني بعد شوية.'
});

/**
 * @param {Object} params
 * @param {Object} params.supabase - service-role client
 * @param {Function} params.getSieAccessStatus - from sie-runtime.js
 * @param {Function} params.evaluateSieAccessRow - from sie-runtime.js
 * @param {Object} [params.logger]
 * @returns {{explainRefusal: (userId: string) => Promise<string>}}
 */
export function createEntitlementExplainer({ supabase, getSieAccessStatus, evaluateSieAccessRow, logger = null }) {
    return {
        /**
         * @param {string} userId
         * @returns {Promise<string>} what to tell the customer
         */
        async explainRefusal(userId) {
            try {
                const row = await getSieAccessStatus(supabase, userId);
                const verdict = evaluateSieAccessRow(row);

                if (verdict.available) {
                    // They ARE entitled, so the refusal came from elsewhere.
                    logger?.warn('SIE declined a turn for an entitled customer', { userId });
                    return ENTITLEMENT_REPLIES.unknown;
                }

                logger?.info('the turn was not entitled', { reason: verdict.reason });
                return ENTITLEMENT_REPLIES[verdict.reason] ?? ENTITLEMENT_REPLIES.unknown;
            } catch (err) {
                logger?.error('could not read the access status', { error: err?.message });
                return ENTITLEMENT_REPLIES.unknown;
            }
        }
    };
}
