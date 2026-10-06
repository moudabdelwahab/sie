// E2E audit harness: drives the REAL getSieReply -> runSieTurn with a recording
// Supabase double. Nothing in the engine is mocked; only the database is.
// All conversations driven through it are synthetic.
import { readFile } from 'node:fs/promises';

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input?.href ?? String(input);
    if (href.startsWith('file:')) {
        const body = await readFile(new URL(href), 'utf8');
        return { ok: true, status: 200, async json() { return JSON.parse(body); }, async text() { return body; } };
    }
    return realFetch(input, init);
};

const ROOT = new URL('../..', import.meta.url).href.replace(/\/$/, '');
const { getSieReply } = await import(`${ROOT}/sie-integration/sie-runtime.js`);
const { getSieSettings } = await import(`${ROOT}/sie-integration/sie-entitlement.js`);

// Snapshot of the production sie_settings configuration (values only; no customer data) taken for the audit.
export const PROD_SETTINGS = {
    allow_smart_guess: true, answer_confidence: 0.65, answer_directly: true, articles_before_ticket: true,
    ask_before_ticket: true, auto_request_more_info: true, auto_ticket_enabled: true, behavior_profile: 'custom',
    default_edition: 'free', diagnosis_level: 'balanced', edition_free_max_scenarios: 500,
    edition_free_monthly_messages: 2500, edition_max_max_scenarios: 924, edition_max_monthly_messages: 10000,
    edition_pro_max_scenarios: 750, edition_pro_monthly_messages: 5000, emotion_anger: true, emotion_detection: true,
    emotion_frustration: true, emotion_reply: true, emotion_sarcasm: true, emotion_satisfaction: true,
    emotion_thanks: true, emotion_urgency: true, engine_enabled: true, explain_root_cause: true,
    inference_mode: 'knowledge_and_inference', knowledge_empathy_replies: true, knowledge_priority: 'live_first',
    knowledge_use_articles: true, knowledge_use_live_data: true, knowledge_use_scenarios: true,
    max_clarifying_questions: 4, max_suggested_solutions: 2, memory_context_minutes: 245, memory_keep_context: true,
    memory_remember_last_issue: true, memory_remember_name: true, memory_use_past_conversations: true,
    rate_limit_burst: 20, rate_limit_enabled: true, rate_limit_requests_per_minute: 100, reply_to_greetings: true,
    search_past_tickets: true, shadow_run_enabled: true, sparse_diagnostic_state: true, suggest_multiple_solutions: true,
    ticket_after_turns: 6, ticket_include_summary: true, ticket_on_anger: true, ticket_on_low_confidence: true,
    trust_boundary_enabled: true, trust_boundary_enforce: true, use_published_scenarios: false
};

export function makeWorld({ settings = PROD_SETTINGS, edition = 'free', sessions = {}, facts = [], openTickets = [] } = {}) {
    const world = { log: [], traces: [], sessions, facts, openTickets, ticketsCreated: [], reviews: [], handoffs: [], quota: 0 };
    const client = {
        from(table) {
            let op = 'select'; let payload = null; const filters = [];
            const result = () => {
                if (table === 'sie_settings') return { data: Object.entries(settings).map(([key, value]) => ({ key, value })), error: null };
                if (table === 'chat_sessions') {
                    // recallPreviousSession: most recent OTHER session of this user
                    const neq = filters.find((f) => f[0] === 'neq')?.[2];
                    const rows = Object.entries(world.sessions).filter(([id]) => id !== neq)
                        .map(([id, s]) => ({ id, bot_state: s.botState, updated_at: s.updatedAt || new Date().toISOString(), is_manual_mode: !!s.manual }));
                    return { data: rows, error: null };
                }
                if (table === 'profiles') return { data: [{ first_name: 'Sami' }], error: null };
                if (table === 'tickets') return { data: world.openTickets, error: null };
                if (table === 'sie_customer_memory') {
                    if (op === 'upsert' || op === 'insert') { world.facts.push(...[].concat(payload)); return { data: null, error: null }; }
                    if (op === 'delete') { world.facts.length = 0; return { data: null, error: null }; }
                    return { data: world.facts.map((f) => ({ key: f.key ?? f.fact_key, value: f.value ?? f.fact_value })), error: null };
                }
                return { data: [], error: null };
            };
            const chain = {
                select() { return chain; }, eq(...a) { filters.push(['eq', ...a]); return chain; },
                neq(...a) { filters.push(['neq', ...a]); return chain; }, gte() { return chain; }, in() { return chain; },
                order() { return chain; }, limit() { return chain; },
                insert(p) { op = 'insert'; payload = p; if (table === 'chat_engine_trace_events') world.traces.push(p); world.log.push({ kind: 'insert', table }); return chain; },
                upsert(p) { op = 'upsert'; payload = p; world.log.push({ kind: 'upsert', table }); return chain; },
                update(p) { op = 'update'; payload = p; return chain; }, delete() { op = 'delete'; return chain; },
                async maybeSingle() {
                    if (table === 'chat_sessions') { const id = filters.find((f) => f[0] === 'eq' && f[1] === 'id')?.[2]; return { data: { is_manual_mode: !!world.sessions[id]?.manual }, error: null }; }
                    const r = result(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null };
                },
                async single() { return chain.maybeSingle(); },
                then(resolve, reject) { try { resolve(result()); } catch (e) { reject(e); } }
            };
            return chain;
        },
        async rpc(fn, params) {
            world.log.push({ kind: 'rpc', fn });
            if (fn === 'sie_consume_message') { world.quota++; return { data: [{ allowed: true, reason: null, remaining: 99, edition }], error: null }; }
            if (fn === 'create_ticket_with_message_and_session_update') { world.ticketsCreated.push(params); return { data: [{ ticket_number: 1000 + world.ticketsCreated.length }], error: null }; }
            if (fn === 'queue_conversation_for_review') { world.reviews.push(params); return { data: [{ id: 'r1' }], error: null }; }
            if (fn === 'sie_request_human') { world.handoffs.push(params); return { data: true, error: null }; }
            return { data: null, error: null };
        }
    };
    world.client = client;
    return world;
}

/** Runs a conversation; returns per-turn records. */
export async function converse(world, sessionId, messages, { userId = 'user-1' } = {}) {
    await getSieSettings(world.client, { fresh: true });
    world.sessions[sessionId] ||= { botState: {} };
    const out = [];
    for (const text of messages) {
        const tracesBefore = world.traces.length;
        const quotaBefore = world.quota;
        const ticketsBefore = world.ticketsCreated.length;
        const t0 = performance.now();
        const result = await getSieReply({ text, supabase: world.client, sessionId, userId, botState: world.sessions[sessionId].botState });
        const ms = performance.now() - t0;
        if (result?.botState) { world.sessions[sessionId].botState = result.botState; world.sessions[sessionId].updatedAt = new Date().toISOString(); }
        out.push({
            text, reply: result?.reply ?? null, options: result?.options?.map((o) => o.label) ?? [], ms: Math.round(ms),
            traced: world.traces.length > tracesBefore ? world.traces[world.traces.length - 1] : null,
            quotaSpent: world.quota - quotaBefore, ticketOpened: world.ticketsCreated.length > ticketsBefore,
            humanHandoff: result?.humanHandoff ?? false, sie: result?.botState?.sie ?? null
        });
    }
    return out;
}

export function show(title, rows) {
    console.log(`\n==== ${title}`);
    for (const r of rows) {
        const tr = r.traced;
        const dec = tr?.decision;
        console.log(`> ${r.text}`);
        console.log(`  path=${tr ? 'PIPELINE' : 'SHORT-CIRCUIT'} ms=${r.ms} quota=${r.quotaSpent} ticket=${r.ticketOpened} handoff=${r.humanHandoff}`);
        if (tr) {
            console.log(`  tokens=${JSON.stringify(tr.normalized_tokens.canonicals)}`);
            const top = [...(tr.hypotheses || [])].sort((a,b)=>b.confidence-a.confidence).slice(0, 3).map((h) => `${h.scenarioId}:${(h.confidence ?? 0).toFixed(2)}`);
            console.log(`  top=${top.join(' | ')} ambiguous=${tr.ranking?.ambiguous} trust=${JSON.stringify(tr.ranking?.trust?.enforced?.level ?? null)} shadowAgreed=${tr.ranking?.shadow?.agreed}`);
            console.log(`  decision=${dec?.action} scen=${dec?.scenarioId} conf=${dec?.confidence?.toFixed?.(2)} rule=${(dec?.evaluatedRules || []).find((x) => x.matched)?.rule}`);
        }
        console.log(`  reply: ${(r.reply ?? 'null (fallback to traditional engine)').replace(/\n/g, ' ⏎ ').slice(0, 230)}`);
        if (r.options.length) console.log(`  options: ${r.options.join(' / ')}`);
    }
}
