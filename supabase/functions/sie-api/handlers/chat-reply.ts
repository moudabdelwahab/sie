/**
 * handlers/chat-reply.ts
 * ------------------------------------------------------------
 * POST /v1/chat/reply — دور محادثة كامل.
 *
 * ------------------------------------------------------------
 * WHAT THIS REPLACES
 *
 * This route returned `501 not_implemented` from the day the API was
 * deployed, with a note saying the pipeline would have to be "ported
 * into this Deno function". It does not: the engine is imported from the
 * CDN at a pinned commit, exactly as `sie-channel-telegram` already does
 * in production, and `import.meta.url` resolution means its 580 KB of
 * scenario and glossary data loads from the same place.
 *
 * Until now, every SIE-mode message on the platform hit that 501,
 * `getSieReply()` returned null, and the customer was shown "محرك الدعم
 * الذكي (SIE) واجه مشكلة مؤقتة في الرد على رسالتك". SIE worked on
 * Telegram and had never worked on the website.
 *
 * ------------------------------------------------------------
 * THE BODY'S userId IS NOT TRUSTED
 *
 * `assets/js/sie-client.js` sends `{ text, sessionId, userId, botState }`.
 * The `userId` in that body is a client-supplied string, and the whole
 * entitlement system — quota, expiry, who is allowed to use SIE at all —
 * is keyed on it. So it is read from the VERIFIED JWT instead, and a
 * body that disagrees is rejected rather than quietly ignored: a caller
 * sending someone else's id is either confused or probing, and both
 * deserve an answer that says so.
 *
 * The session is checked the same way. `runSieTurn` writes through
 * RLS-checked RPCs so a foreign session would fail at the database
 * anyway — but it would fail AFTER a quota message was spent, which
 * makes the customer pay for someone else's mistake.
 *
 * ------------------------------------------------------------
 * WHY THE RESPONSE SAYS alreadyPersisted
 *
 * The engine writes the bot turn itself — the message, the new
 * bot_state, and the ticket if one was opened — inside its action layer,
 * so the diagnostic trail and the ticket are one transaction rather than
 * two things that can disagree.
 *
 * Mad3oom's chat-logic.js and chat-widget.js were written against an
 * older contract where SIE returned data and the caller did the writing.
 * If both sides write, every reply is inserted twice and the customer
 * sees it twice. So the flag is explicit in the response, and the two
 * callers skip their own insert when they see it.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { json } from '../_shared/http.ts';

// Pinned to a COMMIT, never a branch: a branch would mean every push to
// the SIE repo silently swaps the engine underneath a running function.
// Same reasoning, and the same verified-working import FORM, as
// supabase/functions/sie-channel-telegram/index.remote.ts — see the long
// note there about eszip resolving the graph at deploy time.
import { getSieReply } from 'https://cdn.jsdelivr.net/gh/moudabdelwahab/sie@6c8d16406aa14cb8aa3866a059b96b1ee08e1162/sie-integration/sie-runtime.js';

interface ChatReplyBody {
    text?: string;
    sessionId?: string;
    userId?: string;
    botState?: unknown;
}

export async function handleChatReply(supabase: SupabaseClient, req: Request, cors: HeadersInit): Promise<Response> {
    let body: ChatReplyBody;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'invalid_json' }, 400, cors);
    }

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    if (!text || !sessionId) {
        return json({ error: 'missing_required_fields', required: ['text', 'sessionId'] }, 400, cors);
    }

    // Identity comes from the token, not the body.
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
        return json({ error: 'unauthorized' }, 401, cors);
    }
    const userId = userData.user.id;

    if (body.userId && body.userId !== userId) {
        return json({ error: 'forbidden', message: 'userId does not match the authenticated caller' }, 403, cors);
    }

    // Ownership before spending. The row is invisible under RLS to
    // anyone but its owner, so "not found" and "not yours" are the same
    // answer here — and that is the right amount to tell a caller.
    const { data: session, error: sessionError } = await supabase
        .from('chat_sessions')
        .select('id')
        .eq('id', sessionId)
        .maybeSingle();

    if (sessionError) {
        console.error('[sie-api] session lookup failed:', sessionError.message);
        return json({ error: 'internal_error' }, 500, cors);
    }
    if (!session) {
        return json({ error: 'not_found', message: 'session not found' }, 404, cors);
    }

    const result = await getSieReply({
        text,
        supabase,
        sessionId,
        userId,
        botState: body.botState ?? {}
    });

    // null covers three different things — the engine is switched off in
    // settings, the customer's entitlement is spent, or the turn failed.
    // 503 is the honest status for all three: the caller's request was
    // fine, SIE just has no reply for it right now, and sie-client.js
    // already degrades to a clear message rather than a silent fallback.
    if (!result) {
        return json({ error: 'no_reply', message: 'SIE produced no reply for this turn' }, 503, cors);
    }

    return json(
        {
            reply: result.reply,
            options: Array.isArray(result.options) ? result.options : [],
            botState: result.botState ?? body.botState ?? {},
            alreadyPersisted: result.alreadyPersisted === true,
            ticketNumber: result.ticketNumber ?? null
        },
        200,
        cors
    );
}
