/**
 * index.remote.ts — the variant actually deployed to Supabase
 * ------------------------------------------------------------
 * Pinned CDN imports. Supabase resolves the graph at deploy time (eszip), so these must be literal strings — see the long note in git history about dynamic vs static imports. Pinned to a COMMIT, never a branch.
 *
 * ⚠️ THIS FILE IS IMPORTS + WIRING ONLY.
 *
 * Every line of behaviour lives in channels/telegram/telegram-function.js,
 * imported below. That is deliberate: this file and its sibling used to
 * carry the whole function body twice with a comment asking humans to keep
 * them identical, and they drifted anyway — the deployed one grew the
 * channel_secrets fallback and autoRegisterWebhook() while this one did
 * not, so deploying this one would have silently removed both.
 *
 * The two files differ in ONE thing and may only ever differ in that one
 * thing: the import specifiers. Supabase resolves the module graph at
 * deploy time (eszip), so a static remote import has to be a literal
 * string right there — it cannot come from a variable, and it cannot be
 * shared. Everything else is shared, and a test asserts it
 * (tests/entrypoint-parity.test.mjs).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleInbound } from 'https://cdn.jsdelivr.net/gh/moudabdelwahab/sie@8252e5774529196b323d72932df8b43c09f9cdbe/channels/core/channel-adapter.js';
import { createTelegramAdapter } from 'https://cdn.jsdelivr.net/gh/moudabdelwahab/sie@8252e5774529196b323d72932df8b43c09f9cdbe/channels/telegram/telegram-adapter.js';
import { createInProcessSieClient } from 'https://cdn.jsdelivr.net/gh/moudabdelwahab/sie@8252e5774529196b323d72932df8b43c09f9cdbe/channels/core/sie-client.js';
import { createSessionStore } from 'https://cdn.jsdelivr.net/gh/moudabdelwahab/sie@8252e5774529196b323d72932df8b43c09f9cdbe/channels/core/channel-session.js';
import { createIdentityResolver } from 'https://cdn.jsdelivr.net/gh/moudabdelwahab/sie@8252e5774529196b323d72932df8b43c09f9cdbe/channels/core/channel-identity.js';
import { createEntitlementExplainer } from 'https://cdn.jsdelivr.net/gh/moudabdelwahab/sie@8252e5774529196b323d72932df8b43c09f9cdbe/channels/core/channel-entitlement.js';
import { createMemoryDeduplicator } from 'https://cdn.jsdelivr.net/gh/moudabdelwahab/sie@8252e5774529196b323d72932df8b43c09f9cdbe/channels/core/delivery.js';
import { createLogger } from 'https://cdn.jsdelivr.net/gh/moudabdelwahab/sie@8252e5774529196b323d72932df8b43c09f9cdbe/channels/core/logger.js';
import { createTelegramFunction } from 'https://cdn.jsdelivr.net/gh/moudabdelwahab/sie@8252e5774529196b323d72932df8b43c09f9cdbe/channels/telegram/telegram-function.js';
import { getSieReply, getSieAccessStatus, evaluateSieAccessRow, describeScenarioCatalog, getSieSettings } from 'https://cdn.jsdelivr.net/gh/moudabdelwahab/sie@8252e5774529196b323d72932df8b43c09f9cdbe/sie-integration/sie-runtime.js';

const { handler } = await createTelegramFunction({
    botToken: Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '',
    webhookSecretFromEnv: Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '',
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    functionUrl: `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/sie-channel-telegram`,
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
    getSieSettings
});

Deno.serve(handler);
