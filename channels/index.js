/**
 * index.js — Channel Adapter Layer
 * ------------------------------------------------------------
 * المدخل الوحيد لطبقة القنوات.
 *
 * Five channels, one contract, one pipeline:
 *
 *     Website ─┐
 *    Telegram ─┤
 *    WhatsApp ─┼─> handleInbound() ─> SieClient ─> sie-runtime.js ─> SIE
 *   Messenger ─┤
 *         API ─┘
 *
 * SIE sits at the right-hand end and knows none of the names on the left.
 * That is the whole design: adding a sixth channel is a new directory and
 * a `register()` call, with no change to the engine, the pipeline, or any
 * existing adapter.
 *
 * ------------------------------------------------------------
 * WHAT LIVES WHERE
 *
 *   core/       everything identical across channels — the standard
 *               message, the pipeline, sessions, identity, retry, logging
 *   telegram/   Telegram's wire format and nothing else
 *   whatsapp/   Meta's Cloud API format
 *   messenger/  Meta's Messenger format
 *   website/    the in-page widget
 *   api/        programmatic callers
 *
 * The rule that keeps this honest: no file outside `telegram/` may
 * mention Telegram, and no file inside `core/` may mention any vendor.
 * channels/tests/channel-layer.test.mjs enforces both by reading the
 * source, so the rule cannot rot into a comment nobody checks.
 */
export { CHANNELS, ATTACHMENT_KINDS, createInboundMessage, createOutboundMessage } from './core/channel-message.js';
export { defineAdapter, createAdapterRegistry, handleInbound, CHANNEL_REPLIES } from './core/channel-adapter.js';
export { createSieClient, createInProcessSieClient, createHttpSieClient } from './core/sie-client.js';
export { createSessionStore, channelSessionTag } from './core/channel-session.js';
export { createIdentityResolver, extractLinkCode, LINK_REPLIES } from './core/channel-identity.js';
export { createEntitlementExplainer, ENTITLEMENT_REPLIES } from './core/channel-entitlement.js';
export { createMemoryDeduplicator, withRetry, DeliveryError, DEFAULT_RETRY } from './core/delivery.js';
export { createLogger, redact } from './core/logger.js';
export { constantTimeEquals, readHeader } from './core/request-verify.js';

export { createTelegramAdapter } from './telegram/telegram-adapter.js';
export { createWebsiteAdapter } from './website/website-adapter.js';
export { createWhatsAppAdapter } from './whatsapp/whatsapp-adapter.js';
export { createMessengerAdapter } from './messenger/messenger-adapter.js';
export { createApiAdapter, createApiIdentityResolver } from './api/api-adapter.js';
