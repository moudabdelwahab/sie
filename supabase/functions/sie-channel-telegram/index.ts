/**
 * index.ts — sie-channel-telegram Edge Function
 * ------------------------------------------------------------
 * الويبهوك اللي تيليجرام بينادي عليه لما عميل يبعت رسالة للبوت.
 *
 * ------------------------------------------------------------
 * ⚠️ WHY A NEW SLUG AND NOT `telegram-webhook`
 *
 * A `telegram-webhook` function already exists and is ACTIVE. It is NOT a
 * chat channel: it serves per-customer NOTIFICATION bots
 * (`customer_telegram_bots`), links a chat id, and pushes ticket alerts
 * outward. Its URL is already registered with every customer's bot.
 *
 * Replacing it would break every existing ticket notification. This is a
 * separate function on a separate slug, so the two coexist and the
 * notification bots keep working untouched.
 *
 * ------------------------------------------------------------
 * WHY THIS FILE IS THIN
 *
 * Everything below the HTTP boundary lives in /channels as plain ESM,
 * which Deno and Node both run. That is deliberate: it means the whole
 * pipeline is unit-tested under `node --test` with no Deno, no deploy and
 * no network, and this file holds only what genuinely cannot be — reading
 * the environment and shaping a Response.
 *
 * ------------------------------------------------------------
 * WHY IT ALWAYS ANSWERS 200
 *
 * Telegram retries any non-2xx, with increasing delay, for up to 24
 * hours. For a message we have already answered — or one we can never
 * answer, like a malformed payload — a retry produces a duplicate reply
 * and spends the customer's quota again. So the function reports failures
 * in logs and metrics, not in the status code. The one exception is an
 * unverified request: that gets 401, because it is not Telegram and
 * telling it otherwise is free information.
 *
 * ------------------------------------------------------------
 * ENVIRONMENT (never hardcoded — requirement 9)
 *
 *   TELEGRAM_BOT_TOKEN        the bot's API token
 *   TELEGRAM_WEBHOOK_SECRET   the secret_token given to setWebhook
 *   SUPABASE_URL              injected by the platform
 *   SUPABASE_SERVICE_ROLE_KEY injected by the platform
 *   SIE_TRANSPORT             optional: 'in-process' (default) or 'http'
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleInbound } from '../../../channels/core/channel-adapter.js';
import { createTelegramAdapter } from '../../../channels/telegram/telegram-adapter.js';
import { createInProcessSieClient } from '../../../channels/core/sie-client.js';
import { createSessionStore } from '../../../channels/core/channel-session.js';
import { createIdentityResolver } from '../../../channels/core/channel-identity.js';
import { createEntitlementExplainer } from '../../../channels/core/channel-entitlement.js';
import { createMemoryDeduplicator } from '../../../channels/core/delivery.js';
import { createLogger } from '../../../channels/core/logger.js';
import { getSieReply, getSieAccessStatus, evaluateSieAccessRow } from '../../../sie-integration/sie-runtime.js';

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const logger = createLogger('telegram');

/**
 * The service-role client. Correct here and nowhere else in SIE: there is
 * no user session to forward, because the person is on Telegram. The trust
 * comes from the webhook secret plus an active channel_identities row, and
 * every write passes an explicit user_id resolved from that row rather
 * than relying on auth.uid().
 */
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

// Built once per instance, not per request: the deduplicator's whole
// purpose is remembering across the requests of one warm instance.
const adapter = createTelegramAdapter({
    botToken: BOT_TOKEN,
    secretToken: WEBHOOK_SECRET,
    logger
});

const sessions = createSessionStore({ supabase, logger });

const deps = {
    logger,
    sieClient: createInProcessSieClient({ supabase, sessions, getSieReply, logger }),
    identity: createIdentityResolver({ supabase, logger }),
    entitlement: createEntitlementExplainer({ supabase, getSieAccessStatus, evaluateSieAccessRow, logger }),
    dedupe: createMemoryDeduplicator()
};

/**
 * GET /  — فحص ذاتي لكل مرحلة في المسار.
 *
 * Every stage between "Telegram called us" and "the customer got a reply"
 * can fail silently, and from the outside they all look identical: no
 * reply. This runs each one and reports which succeeded, so a single URL
 * answers "where does it stop" instead of a hunt through logs.
 *
 * It is also the honest way to settle the one thing that cannot be tested
 * before deployment: whether the engine's ~580 KB of scenario and glossary
 * data actually loads inside Deno. `catalogSize` is that answer.
 *
 * Safe to expose: it reports only whether each secret is PRESENT, never a
 * value, and touches no customer data.
 */
async function selfCheck(): Promise<Record<string, unknown>> {
    const stages: Record<string, unknown> = {
        env_bot_token: Boolean(BOT_TOKEN),
        env_webhook_secret: Boolean(WEBHOOK_SECRET),
        env_supabase_url: Boolean(SUPABASE_URL),
        env_service_role_key: Boolean(SERVICE_ROLE_KEY)
    };

    // Does the engine's data load in this runtime? The single most likely
    // deployment failure, and invisible from outside.
    try {
        const { listActiveScenarios } = await import('../../../sie-integration/sie-runtime.js');
        const scenarios = await listActiveScenarios();
        stages.engine_loaded = true;
        stages.catalog_size = scenarios.length;
        stages.catalog_ok = scenarios.length > 0;
    } catch (err) {
        stages.engine_loaded = false;
        stages.engine_error = err instanceof Error ? err.message : String(err);
    }

    // Can we read the linking table? Without this every chat looks unlinked.
    try {
        const { count, error } = await supabase
            .from('channel_identities')
            .select('*', { count: 'exact', head: true })
            .eq('channel', 'telegram');
        stages.identity_table = !error;
        stages.linked_telegram_chats = error ? null : count;
        if (error) stages.identity_error = error.message;
    } catch (err) {
        stages.identity_table = false;
        stages.identity_error = err instanceof Error ? err.message : String(err);
    }

    // Is the webhook registered, and did Telegram's last call succeed?
    // Telegram remembers exactly why it last failed, which is usually the
    // whole answer.
    if (BOT_TOKEN) {
        try {
            const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
            const body = await response.json();
            stages.webhook_registered = Boolean(body?.result?.url);
            stages.webhook_url = body?.result?.url ?? null;
            stages.webhook_pending = body?.result?.pending_update_count ?? 0;
            stages.webhook_last_error = body?.result?.last_error_message ?? null;
        } catch (err) {
            stages.webhook_registered = null;
            stages.webhook_error = err instanceof Error ? err.message : String(err);
        }
    }

    return stages;
}

Deno.serve(async (req: Request) => {
    // The self-check is a GET so it can be opened in a browser; the webhook
    // is always a POST, so the two cannot be confused.
    if (req.method === 'GET') {
        const stages = await selfCheck();
        return new Response(JSON.stringify({ ok: true, stages }, null, 2), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    if (req.method !== 'POST') {
        return new Response('method not allowed', { status: 405 });
    }

    // A missing secret means the deployment is misconfigured. Fail loudly
    // and closed rather than accepting unauthenticated updates.
    if (!BOT_TOKEN || !WEBHOOK_SECRET) {
        logger.error('the function is missing TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET');
        return new Response('misconfigured', { status: 500 });
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        // Not JSON: not Telegram, and no retry will change that.
        return new Response('ok', { status: 200 });
    }

    try {
        const result = await handleInbound({
            adapter,
            request: { headers: req.headers, body, url: req.url },
            deps
        });

        if (result.status === 'unverified') {
            // The one case worth a non-200: this is not Telegram, so there
            // is no redelivery to worry about.
            return new Response('unauthorized', { status: 401 });
        }

        return new Response('ok', { status: 200 });
    } catch (err) {
        // Nothing below should throw — handleInbound catches per message —
        // so reaching here is a bug worth seeing in the logs. Still 200:
        // a redelivery would hit the same bug and charge the customer again.
        logger.error('the webhook threw', { error: err instanceof Error ? err.message : String(err) });
        return new Response('ok', { status: 200 });
    }
});
