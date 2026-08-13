/**
 * ports.js — توصيل الـAPI العام بمحرك SIE الحقيقي
 * ============================================================
 * الراوتر مابيعرفش Supabase ولا المحرك؛ بيعرف المنافذ دي بس. الملف ده
 * هو التوصيلة الحقيقية: بياخد عميل Supabase بصلاحية الخدمة + الرَنتايم،
 * وبيرجّع المنافذ اللي الراوتر بينادي عليها.
 *
 * ── ليه الرَنتايم بيتحقن مش بيتستورد ────────────────────────
 * الدالة الطرفية بتحمّل المحرك من CDN مثبّت على كوميت (نفس اللي
 * `handlers/chat-reply.ts` بيعمله)، والاختبارات بتحمّله من القرص. لو
 * الملف ده استورده بنفسه، الاتنين كانوا هيبقوا نسختين من المحرك في نفس
 * العملية — أو الاختبار كان هيحتاج شبكة. الحقن بيخلي مصدر المحرك قرار
 * بتاع النشر مش بتاع الكود.
 *
 * ── ليه service_role هنا وهو ممنوع في باقي sie-api ──────────
 * باقي مسارات sie-api بتتكلم بتوكن العميل نفسه، وده صح: كل RPC هناك
 * بيستنتج الهوية من auth.uid(). نداء بمفتاح API مالوش auth.uid() أصلاً
 * ومش هيبقى ليه واحد أبدًا — العميل سيرفر مش متصفح.
 *
 * فالثقة بتتنقل: المفتاح بيتحقق منه في قاعدة البيانات، وبيرجّع
 * user_id، وكل كتابة بعد كده بتمرّر الـuser_id ده صراحة — بالظبط زي ما
 * قناة تيليجرام شغالة من زمان (channels/core/channel-session.js بيشرح
 * نفس المقايضة). الـservice_role هنا بيعوّض غياب الجلسة، مش بيتخطى
 * أي فحص: sie_consume_message لسه هو اللي بيصرف من الرصيد، ولسه
 * بيرفض لو الحساب مش مستحق.
 */
import { createSessionStore } from '../../channels/core/channel-session.js';
import { CHANNELS } from '../../channels/core/channel-message.js';
import { ApiError, entitlementCode } from './errors.js';

/**
 * @param {Object} params
 * @param {Object} params.supabase - عميل بصلاحية الخدمة
 * @param {Object} params.runtime - وحدة sie-runtime.js
 * @param {Object} [params.logger]
 * @returns {import('./router.js').ApiPorts}
 */
export function createApiPorts({ supabase, runtime, logger = console }) {
    const sessions = createSessionStore({ supabase, logger });

    return {
        verifyApiKey: (apiKey) => runtime.verifyApiKey(supabase, apiKey),

        checkRateLimit: ({ userId, clientIp }) =>
            runtime.checkApiRateLimit(supabase, { userId, clientIp }),

        logRequest: (entry) => runtime.logApiRequest(supabase, entry),

        listScenarios: () => runtime.listActiveScenarios(),

        diagnose: (message, options) => runtime.diagnoseMessage(message, options),

        async engineHealth() {
            try {
                const scenarios = await runtime.listActiveScenarios();
                return { loaded: true, catalog_size: scenarios.length };
            } catch (err) {
                logger.error?.('[sie-api] engine health failed:', err?.message || err);
                return { loaded: false };
            }
        },

        /**
         * الحساب زي ما `/v1/me` بيعرضه. كله من نفس الصفوف اللي اللوحة
         * بتقراها — مفيش حساب تاني هنا.
         */
        async getAccount(userId) {
            const access = await runtime.getSieAccessStatus(supabase, userId);
            const entitlement = runtime.evaluateSieAccessRow(access);

            const quota = access?.access_mode === 'quota' ? Number(access.message_quota ?? 0) : null;
            const used = Number(access?.messages_used ?? 0);

            return {
                access,
                entitlement,
                usage: {
                    messages_used: used,
                    // null معناها «من غير حد»، مش صفر. الفرق ده هو
                    // الفرق بين عميل مفتوح وعميل مستنفد.
                    message_quota: quota,
                    remaining: quota === null ? null : Math.max(quota - used, 0)
                }
            };
        },

        /**
         * دور محادثة كامل — نفس المسار اللي بيرد على عميل على الموقع.
         */
        async chat({ userId, message, sessionId, endUserId, metadata }) {
            // الاستحقاق بيتقرا الأول عشان الرد يبقى بحالة HTTP صح
            // (٤٠٣ رصيد خلص) بدل ٥٠٣ عامة. ده مابيستبدلش الصرف —
            // sie_consume_message جوه المحرك هو اللي بيصرف فعلاً
            // وبيرفض لو الحال اتغير في اللحظة اللي بينهم.
            const access = await runtime.getSieAccessStatus(supabase, userId);
            const entitlement = runtime.evaluateSieAccessRow(access);
            if (!entitlement.available) {
                throw new ApiError(entitlementCode(entitlement.reason));
            }

            const session = sessionId
                ? await adoptSession(supabase, userId, sessionId)
                : await sessions.getOrCreate({
                    userId,
                    channel: CHANNELS.API,
                    // عميل نهائي مختلف = محادثة مختلفة، عشان ذاكرة
                    // المحرك ماتتخلطش بين ناس التكامل بيخدمهم.
                    channelChatId: endUserId || 'default'
                });

            const result = await runtime.getSieReply({
                text: message,
                supabase,
                sessionId: session.sessionId,
                userId,
                botState: session.botState ?? {}
            });

            if (!result) {
                // المحرك رفض الدور: مقفول من الإعدادات، أو فشل داخلي.
                // الاستحقاق اتفحص فوق، فمش هنقول للعميل إن رصيده خلص.
                throw new ApiError('engine_unavailable');
            }

            await sessions.saveState(session.sessionId, result.botState);

            // الرصيد بعد الصرف. قراءة تانية عشان الرقم يبقى بعد الدور
            // مش قبله — عميل بيراقب رصيده محتاج الرقم اللي فضل فعلاً.
            const after = await runtime.getSieAccessStatus(supabase, userId);
            const quota = after?.access_mode === 'quota' ? Number(after.message_quota ?? 0) : null;
            const used = Number(after?.messages_used ?? 0);

            if (metadata) {
                logger.info?.('[sie-api] chat metadata', {
                    session: session.sessionId,
                    keys: Object.keys(metadata)
                });
            }

            return {
                sessionId: session.sessionId,
                reply: result.reply,
                options: Array.isArray(result.options) ? result.options : [],
                ticketNumber: result.ticketNumber ?? null,
                usage: {
                    messages_used: used,
                    message_quota: quota,
                    remaining: quota === null ? null : Math.max(quota - used, 0)
                }
            };
        }
    };
}

/**
 * جلسة بعتها العميل: لازم تكون موجودة وتكون بتاعته.
 *
 * الفحص ده قبل أي شغل عشان دور على جلسة حد تاني مايصرفش من رصيد صاحب
 * المفتاح قبل ما RLS ترفضه.
 */
async function adoptSession(supabase, userId, sessionId) {
    const { data, error } = await supabase
        .from('chat_sessions')
        .select('id, user_id, bot_state')
        .eq('id', sessionId)
        .maybeSingle();

    if (error) {
        // معرّف مش UUID بيرجّع خطأ من Postgres، وده طلب غلط مش عطل.
        if (/invalid input syntax|uuid/i.test(error.message || '')) {
            throw new ApiError('invalid_request', {
                details: { field: 'session_id', expected: 'a session id returned by a previous /chat call' }
            });
        }
        throw new ApiError('internal_error');
    }

    if (!data) throw new ApiError('resource_not_found', { details: { session_id: sessionId } });
    if (data.user_id !== userId) throw new ApiError('session_conflict');

    return { sessionId: data.id, botState: data.bot_state ?? {} };
}
