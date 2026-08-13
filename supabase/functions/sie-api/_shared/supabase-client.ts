/**
 * supabase-client.ts
 * ------------------------------------------------------------
 * Builds a Supabase client scoped to the CALLER's own JWT, forwarded
 * verbatim from the incoming Authorization header — never the
 * service-role key, for customer-facing operations.
 *
 * Why this matters, concretely (verified against the live database, not
 * assumed):
 *   - sie_consume_message(p_user_id) hard-fails unless p_user_id =
 *     auth.uid(). A service-role call has auth.uid() = NULL, so it would
 *     always fail closed.
 *   - persist_bot_turn / create_ticket_with_message_and_session_update
 *     rely on RLS matching auth.uid() to chat_sessions.user_id. Same
 *     failure mode with a service-role client.
 *   - is_sie_admin() / is_chat_engine_staff() are SECURITY DEFINER but
 *     still resolve identity from auth.uid() internally.
 *
 * In short: every RPC this API wraps is identity-bound to the caller by
 * design, on the database side. A service-role client would not "have
 * more access" here — it would have LESS, because these functions treat
 * "no identity" as "no permission", not "trusted caller".
 *
 * (The Telegram channel is the deliberate exception: there is no user
 * session on Telegram, so it runs as service_role and passes an explicit
 * user_id resolved from channel_identities. That asymmetry is why the
 * RPCs accept both shapes.)
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

export function buildUserClient(req: Request): SupabaseClient {
    const authHeader = req.headers.get('Authorization') ?? '';
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false }
    });
}

/**
 * عميل بصلاحية الخدمة — **للـAPI العام بس**.
 * ------------------------------------------------------------
 * كل الكلام فوق عن إن service_role غلط هنا لسه صح لكل مسار بيتكلم
 * بتوكن عميل. الـAPI العام هو الحالة اللي المنطق ده مابيغطيهاش: اللي
 * بينده سيرفر بمفتاح API، ومالوش جلسة Supabase ومش هيبقى ليه واحدة —
 * بالظبط زي ويبهوك تيليجرام.
 *
 * الثقة بتتنقل مش بتختفي: المفتاح بيتحقق منه في قاعدة البيانات
 * (sie_api_key_verify، وهي service_role-only)، وبيرجّع user_id، وكل
 * كتابة بعد كده بتمرّر الـuser_id ده صراحة. sie_consume_message لسه
 * هو اللي بيصرف من الرصيد ولسه بيرفض لو الحساب مش مستحق — يعني مفتاح
 * الـAPI مابيتخطاش أي فحص، بس بيقول «أنا مين».
 *
 * ⚠️ ماتستخدمش العميل ده في أي مسار بيقبل توكن مستخدم. مسارات
 * `/v1/*` القديمة كلها لازم تفضل على buildUserClient.
 */
export function buildServiceClient(): SupabaseClient {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');

    return createClient(SUPABASE_URL, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
}
