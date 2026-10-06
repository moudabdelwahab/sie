/**
 * runtime-world.mjs — drive the REAL runtime in tests.
 * ------------------------------------------------------------
 * Promoted from the audit harness (scripts/audit-2026-10/harness.mjs). It
 * calls the public `getSieReply` → `runSieTurn` with real catalogs, the real
 * glossary, the real trust boundary and real settings resolution. Only the
 * database is replaced, by a recording double that also behaves like the
 * tables the turn reads (sessions, profiles, tickets, customer memory).
 *
 * What a test gets back per turn is everything needed to assert on
 * behaviour, not implementation: the reply the customer received, the
 * trace row (if one was written), the effects that happened (tickets,
 * reviews, hand-offs, stored facts, quota), and the persisted bot state.
 *
 * Time is a world property (`world.now`, `world.advance(minutes)`) and is
 * passed to the turn as `clock`, so expiry is testable without waiting.
 *
 * Settings come from a named profile in ../fixtures/settings/ (see
 * loadSettingsProfile). Every conversation is synthetic.
 */
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The local providers load their JSON with fetch(new URL(..., import.meta.url)).
// Node's fetch has no file: scheme, so serve file: URLs from disk (the same
// shim the existing bridge-level tests install).
if (!globalThis.__sieFileFetchShim) {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const href = typeof input === 'string' ? input : input?.href ?? String(input);
        if (href.startsWith('file:')) {
            const body = await readFile(new URL(href), 'utf8');
            return { ok: true, status: 200, async json() { return JSON.parse(body); }, async text() { return body; } };
        }
        return realFetch(input, init);
    };
    globalThis.__sieFileFetchShim = true;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_DIR = path.join(HERE, '..', 'fixtures', 'settings');

const { getSieReply } = await import('../../sie-runtime.js');
const { getSieSettings } = await import('../../sie-entitlement.js');
const { SIE_DEFAULT_SETTINGS, behaviorProfileValues } = await import('../../../sie/config/settings-schema.js');

/** Names of every settings profile fixture. */
export const SETTINGS_PROFILES = Object.freeze(
    fs.readdirSync(SETTINGS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort()
);

/** The raw fixture file: {description, overrides, behaviorProfile?}. */
export function readSettingsFixture(name) {
    return JSON.parse(fs.readFileSync(path.join(SETTINGS_DIR, `${name}.json`), 'utf8'));
}

/**
 * The full settings object a profile resolves to: code defaults, then the
 * console behaviour profile (if named), then the stored overrides — the same
 * precedence the database row has over the defaults at runtime.
 */
export function loadSettingsProfile(name) {
    const fixture = readSettingsFixture(name);
    const profile = fixture.behaviorProfile ? behaviorProfileValues(fixture.behaviorProfile) : {};
    if (fixture.behaviorProfile && !profile) throw new Error(`unknown behaviour profile ${fixture.behaviorProfile}`);
    return { ...SIE_DEFAULT_SETTINGS, ...profile, ...(fixture.overrides || {}) };
}

/** A fixed, arbitrary start time so runs are reproducible. */
export const DEFAULT_START = Date.parse('2026-01-01T09:00:00Z');

/**
 * @param {Object} [options]
 * @param {string} [options.profile='defaults'] settings profile name
 * @param {Object} [options.settings] explicit settings (overrides the profile entirely)
 * @param {'free'|'pro'|'max'} [options.edition='free'] what sie_consume_message reports
 * @param {Array} [options.openTickets] rows the tickets table returns
 * @param {Array} [options.facts] rows sie_customer_memory starts with
 * @param {number} [options.startAt] epoch ms of the world clock
 * @param {string} [options.customerName='Sami'] synthetic profile first name
 * @param {string[]} [options.failRpcs] RPC names that return a database error (failure injection)
 * @param {boolean} [options.failTraceInsert] trace inserts return a database error
 */
export function makeWorld({ profile = 'defaults', settings = null, edition = 'free', openTickets = [], facts = [], startAt = DEFAULT_START, customerName = 'Sami', failRpcs = [], failTraceInsert = false } = {}) {
    const resolved = settings || loadSettingsProfile(profile);
    const world = {
        profile, settings: resolved, edition,
        sessions: {}, facts: [...facts], openTickets: [...openTickets],
        traces: [], failedTraceInserts: 0, consoleErrors: [], ticketsCreated: [], reviews: [], handoffs: [], persisted: [], quota: 0, log: [],
        now: startAt,
        advance(minutes) { world.now += minutes * 60000; }
    };
    const updatedAt = () => new Date(world.now).toISOString();

    world.client = {
        from(table) {
            let op = 'select'; let payload = null; const filters = [];
            const result = () => {
                if (table === 'chat_engine_trace_events' && op === 'insert') {
                    return failTraceInsert ? { data: null, error: { message: 'injected trace insert failure' } } : { data: null, error: null };
                }
                if (table === 'sie_settings') return { data: Object.entries(resolved).map(([key, value]) => ({ key, value })), error: null };
                if (table === 'chat_sessions') {
                    const neq = filters.find((f) => f[0] === 'neq')?.[2];
                    const since = filters.find((f) => f[0] === 'gte' && f[1] === 'updated_at')?.[2];
                    const rows = Object.entries(world.sessions)
                        .filter(([id, sess]) => id !== neq && (!since || (sess.updatedAt || updatedAt()) >= since))
                        .map(([id, s]) => ({ id, bot_state: s.botState, updated_at: s.updatedAt || updatedAt(), is_manual_mode: !!s.manual }))
                        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
                    return { data: rows, error: null };
                }
                if (table === 'profiles') return { data: [{ first_name: customerName }], error: null };
                if (table === 'tickets') return { data: world.openTickets, error: null };
                if (table === 'sie_customer_memory') {
                    if (op === 'upsert' || op === 'insert') { world.facts.push(...[].concat(payload)); return { data: null, error: null }; }
                    if (op === 'delete') { world.facts.length = 0; return { data: null, error: null }; }
                    return { data: world.facts.map((f) => ({ key: f.key, value: f.value })), error: null };
                }
                return { data: [], error: null };
            };
            const chain = {
                select() { return chain; },
                eq(...a) { filters.push(['eq', ...a]); return chain; },
                neq(...a) { filters.push(['neq', ...a]); return chain; },
                gte(...a) { filters.push(['gte', ...a]); return chain; }, in() { return chain; }, order() { return chain; }, limit() { return chain; },
                insert(p) {
                    op = 'insert'; payload = p;
                    if (table === 'chat_engine_trace_events') { if (failTraceInsert) world.failedTraceInserts++; else world.traces.push(p); }
                    world.log.push({ kind: 'insert', table });
                    return chain;
                },
                upsert(p) { op = 'upsert'; payload = p; world.log.push({ kind: 'upsert', table }); return chain; },
                update(p) { op = 'update'; payload = p; return chain; },
                delete() { op = 'delete'; return chain; },
                async maybeSingle() {
                    if (table === 'chat_sessions') {
                        const id = filters.find((f) => f[0] === 'eq' && f[1] === 'id')?.[2];
                        return { data: { is_manual_mode: !!world.sessions[id]?.manual }, error: null };
                    }
                    const r = result();
                    return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null };
                },
                async single() { return chain.maybeSingle(); },
                then(resolve, reject) { try { resolve(result()); } catch (e) { reject(e); } }
            };
            return chain;
        },
        async rpc(fn, params) {
            world.log.push({ kind: 'rpc', fn });
            if (failRpcs.includes(fn)) return { data: null, error: { message: `injected ${fn} failure` } };
            if (fn === 'sie_consume_message') { world.quota++; return { data: [{ allowed: true, reason: null, remaining: 99, edition }], error: null }; }
            if (fn === 'persist_bot_turn') { world.persisted.push(params); return { data: null, error: null }; }
            if (fn === 'create_ticket_with_message_and_session_update') { world.ticketsCreated.push(params); return { data: [{ ticket_number: 1000 + world.ticketsCreated.length }], error: null }; }
            if (fn === 'queue_conversation_for_review') { world.reviews.push(params); return { data: [{ id: `review-${world.reviews.length}` }], error: null }; }
            if (fn === 'sie_request_human') {
                world.handoffs.push(params);
                // As in production: the chat is now a human's, and SIE stops answering it.
                if (world.sessions[params?.p_session]) world.sessions[params.p_session].manual = true;
                return { data: true, error: null };
            }
            return { data: null, error: null };
        }
    };
    return world;
}

/**
 * Runs messages through one chat, in order, carrying bot_state between turns
 * exactly as the database would.
 *
 * Each message is a string or `{say, advanceMinutes?, attachments?}`.
 * `attachments` is passed to the runtime as-is: today the runtime ignores it,
 * which is precisely what the attachment regression test pins.
 *
 * @returns {Promise<Array<TurnRecord>>}
 */
export async function converse(world, chatId, messages, { userId = 'user-1' } = {}) {
    // Settings are cached module-wide with a TTL; read this world's profile now.
    await getSieSettings(world.client, { fresh: true });
    world.sessions[chatId] ||= { botState: {} };
    const out = [];
    const silence = { warn: console.warn, info: console.info, error: console.error };
    for (const raw of messages) {
        const msg = typeof raw === 'string' ? { say: raw } : raw;
        if (msg.advanceMinutes) world.advance(msg.advanceMinutes);
        const before = { traces: world.traces.length, quota: world.quota, tickets: world.ticketsCreated.length, reviews: world.reviews.length, handoffs: world.handoffs.length };
        console.warn = () => {}; console.info = () => {};
        console.error = (...args) => { world.consoleErrors.push(args.map(String).join(' ')); };
        let result;
        try {
            result = await getSieReply({
                text: msg.say, supabase: world.client, sessionId: chatId, userId,
                botState: world.sessions[chatId].botState,
                clock: () => world.now,
                ...(msg.attachments ? { attachments: msg.attachments } : {})
            });
        } finally {
            Object.assign(console, silence);
        }
        if (result?.botState) {
            world.sessions[chatId].botState = result.botState;
            world.sessions[chatId].updatedAt = new Date(world.now).toISOString();
        }
        const trace = world.traces.length > before.traces ? world.traces[world.traces.length - 1] : null;
        out.push({
            chatId, say: msg.say,
            reply: result?.reply ?? null,
            traceWritten: result?.traceWritten,
            options: result?.options ?? [],
            trace,
            handled: Boolean(result),
            quotaSpent: world.quota - before.quota,
            ticketsOpened: world.ticketsCreated.length - before.tickets,
            reviewsQueued: world.reviews.length - before.reviews,
            handoffsRequested: world.handoffs.length - before.handoffs,
            humanHandoff: result?.humanHandoff ?? false,
            state: result?.botState ?? null
        });
        world.sessions[chatId].lastTurn = out[out.length - 1];
    }
    return out;
}

/** The trace's matched decision rule, or null. */
export function matchedRule(turn) {
    return (turn?.trace?.decision?.evaluatedRules || []).find((r) => r.matched)?.rule ?? null;
}
