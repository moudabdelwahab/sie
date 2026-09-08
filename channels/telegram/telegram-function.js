/**
 * telegram-function.js
 * ------------------------------------------------------------
 * الجسم الكامل لدالة قناة تيليجرام — نسخة واحدة، والـentrypoints مجرد
 * أسطر استيراد فوقها.
 *
 * ------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * There were two entrypoints — `index.ts` (relative imports, for
 * `supabase functions deploy` from a checkout) and `index.remote.ts`
 * (pinned CDN imports, which is what is actually deployed). Their headers
 * said "everything below the imports is identical and must stay so".
 *
 * They were not identical. The deployed one had grown `readSecret()`, the
 * `channel_secrets` fallback for the webhook secret, `autoRegisterWebhook()`,
 * and four extra self-check fields. `index.ts` had none of it. A routine
 * `supabase functions deploy` from a checkout would therefore have SILENTLY
 * REMOVED the secret fallback — and where the secret lives only in the
 * table, the channel would answer `misconfigured 500` to every Telegram
 * update. "Keep two files in step by hand" is not a mechanism, and this is
 * what it cost.
 *
 * So the body lives here once. The entrypoints differ only in HOW they
 * import — which is the one thing that genuinely cannot be shared, because
 * Supabase resolves the module graph at deploy time (eszip) and a static
 * remote import must be a literal string at that moment.
 *
 * ------------------------------------------------------------
 * WHY DEPENDENCIES ARE INJECTED RATHER THAN IMPORTED HERE
 *
 * If this file imported the engine itself, it would have to name a
 * specifier — and then it would be the file that has to exist twice.
 * Taking them as arguments is what lets one body serve both import styles.
 *
 * It also keeps the `/channels` promise: no `Deno.` anywhere in this file,
 * so the whole thing runs under `node --test` with plain objects, exactly
 * like every other module in this directory. The entrypoints read the
 * environment, because reading the environment is the one thing they are
 * for.
 */

/**
 * @param {Object} params
 * @param {string} params.botToken                 TELEGRAM_BOT_TOKEN
 * @param {string} params.webhookSecretFromEnv     TELEGRAM_WEBHOOK_SECRET ('' when unset)
 * @param {string} params.supabaseUrl              SUPABASE_URL
 * @param {string} params.serviceRoleKey           SUPABASE_SERVICE_ROLE_KEY
 * @param {string} params.functionUrl              this function's own public URL
 * @param {Function} params.createClient
 * @param {Function} params.createLogger
 * @param {Function} params.createTelegramAdapter
 * @param {Function} params.createSessionStore
 * @param {Function} params.createIdentityResolver
 * @param {Function} params.createEntitlementExplainer
 * @param {Function} params.createInProcessSieClient
 * @param {Function} params.createMemoryDeduplicator
 * @param {Function} params.handleInbound
 * @param {Function} params.getSieReply
 * @param {Function} params.getSieAccessStatus
 * @param {Function} params.evaluateSieAccessRow
 * @param {Function} params.describeScenarioCatalog
 * @param {Function} params.getSieSettings
 * @param {Function} [params.fetchImpl]            injectable so tests never touch the network
 * @returns {Promise<{handler: (req: Request) => Promise<Response>, selfCheck: () => Promise<Object>}>}
 *   async because the webhook secret is resolved ONCE AT BOOT, exactly as
 *   the deployed function does — a per-request read would put a database
 *   round trip in front of every customer message for a value that never
 *   changes.
 */
export async function createTelegramFunction({
    botToken,
    webhookSecretFromEnv,
    supabaseUrl,
    serviceRoleKey,
    functionUrl,
    createClient,
    createLogger,
    createTelegramAdapter,
    createSessionStore,
    createIdentityResolver,
    createEntitlementExplainer,
    createInProcessSieClient,
    createMemoryDeduplicator,
    handleInbound,
    getSieReply,
    getSieAccessStatus,
    evaluateSieAccessRow,
    describeScenarioCatalog,
    getSieSettings,
    fetchImpl = globalThis.fetch
}) {
    const BOT_TOKEN = botToken ?? '';
    const SUPABASE_URL = supabaseUrl ?? '';
    const SERVICE_ROLE_KEY = serviceRoleKey ?? '';
    const FUNCTION_URL = functionUrl ?? '';

    const logger = createLogger('telegram');

    /**
     * The service-role client. Correct here and nowhere else in SIE: there is
     * no user session to forward, because the person is on Telegram. Trust
     * comes from the webhook secret plus an active channel_identities row, and
     * every write passes an explicit user_id resolved from that row rather
     * than relying on auth.uid().
     */
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    async function readSecret(key) {
        const { data, error } = await supabase
            .from('channel_secrets').select('value').eq('key', key).maybeSingle();
        if (error) {
            logger.error('could not read a channel secret', { key, error: error.message });
            return '';
        }
        return data?.value ?? '';
    }

    /**
     * The environment variable wins when set — it is the better home for a
     * shared secret. The table exists so the channel can be brought up without
     * CLI access, not to replace it.
     *
     * Resolved once at boot: a per-request read would put a database round trip
     * in front of every customer message for a value that changes never.
     */
    const WEBHOOK_SECRET = webhookSecretFromEnv || await readSecret('telegram_webhook_secret');

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
     * Registers this function as the bot's webhook, once.
     *
     * Gated on a database flag rather than running on every cold start, so a
     * restart can never silently repoint a webhook someone configured by hand.
     * The flag is cleared on success, which makes this genuinely one-time.
     */
    async function autoRegisterWebhook(stages) {
        const flag = await readSecret('telegram_autoregister');
        if (flag !== 'true') return;
        if (!BOT_TOKEN || !WEBHOOK_SECRET) {
            stages.autoregister = 'skipped: bot token or webhook secret missing';
            return;
        }

        try {
            const response = await fetchImpl(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: FUNCTION_URL,
                    secret_token: WEBHOOK_SECRET,
                    // Only what this channel handles, so Telegram does not wake
                    // the function for reactions and member changes.
                    allowed_updates: ['message', 'edited_message'],
                    // Anything queued while no webhook was set is stale; replying
                    // would answer questions asked hours ago.
                    drop_pending_updates: true
                })
            });
            const body = await response.json();
            stages.autoregister = body?.ok ? 'registered' : `failed: ${body?.description ?? response.status}`;

            if (body?.ok) {
                await supabase.from('channel_secrets')
                    .update({ value: 'false', updated_at: new Date().toISOString() })
                    .eq('key', 'telegram_autoregister');
            }
        } catch (err) {
            stages.autoregister = `failed: ${err instanceof Error ? err.message : String(err)}`;
        }
    }

    /**
     * GET / — فحص ذاتي لكل مرحلة في المسار.
     *
     * Every stage between "Telegram called us" and "the customer got a reply"
     * can fail silently, and from outside they all look identical: no reply.
     * This runs each one, so a single URL answers "where does it stop".
     *
     * Reports only whether each secret is PRESENT, never a value.
     */
    async function selfCheck() {
        const stages = {
            env_bot_token: Boolean(BOT_TOKEN),
            webhook_secret_resolved: Boolean(WEBHOOK_SECRET),
            webhook_secret_source: webhookSecretFromEnv ? 'env' : 'database',
            env_supabase_url: Boolean(SUPABASE_URL),
            env_service_role_key: Boolean(SERVICE_ROLE_KEY)
        };

        await autoRegisterWebhook(stages);

        // Does the engine's data load in this runtime? The single most likely
        // deployment failure, and invisible from outside.
        try {
            // Reported the way the ENGINE resolves it — shipped catalog plus
            // whatever published rows are actually merged over it — because a
            // bare count cannot tell "the operator's rows are live" from "the
            // overlay silently failed", and those need different responses.
            const settings = await getSieSettings(supabase);
            const resolution = await describeScenarioCatalog({ supabase, settings });
            stages.engine_loaded = true;
            stages.catalog_size = resolution.effectiveCount;
            stages.catalog_ok = resolution.effectiveCount > 0;
            stages.catalog = resolution;
        } catch (err) {
            stages.engine_loaded = false;
            stages.engine_error = err instanceof Error ? err.message : String(err);
        }

        // Can we read the linking table? Without it every chat looks unlinked.
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
                const response = await fetchImpl(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
                const body = await response.json();
                stages.webhook_registered = Boolean(body?.result?.url);
                stages.webhook_url = body?.result?.url ?? null;
                stages.webhook_points_here = body?.result?.url === FUNCTION_URL;
                stages.webhook_pending = body?.result?.pending_update_count ?? 0;
                stages.webhook_last_error = body?.result?.last_error_message ?? null;

                const me = await (await fetchImpl(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`)).json();
                stages.bot_username = me?.result?.username ?? null;
            } catch (err) {
                stages.webhook_registered = null;
                stages.webhook_error = err instanceof Error ? err.message : String(err);
            }
        }

        return stages;
    }

    async function handler(req) {
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
            logger.error('the function has no bot token or no webhook secret');
            return new Response('misconfigured', { status: 500 });
        }

        let body;
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
            // Telegram retries any non-2xx for up to 24 hours, and a retry of a
            // message we already answered charges the customer twice. So
            // failures are reported in logs, not in the status code.
            logger.error('the webhook threw', { error: err instanceof Error ? err.message : String(err) });
            return new Response('ok', { status: 200 });
        }
    }

    return { handler, selfCheck };
}
