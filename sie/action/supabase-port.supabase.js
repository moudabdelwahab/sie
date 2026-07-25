/**
 * supabase-port.supabase.js
 * ------------------------------------------------------------
 * Real, thin implementation of the SupabasePort contract
 * (supabase-port.js). Deliberately thin: no branching, no retries, no
 * client-side transaction logic.
 *
 * CORRECTED against the live database (verified via Supabase MCP —
 * pg_get_functiondef / information_schema / pg_constraint — not
 * assumed, not re-derived from the repo's own migration files, which
 * had drifted from what's actually deployed). Six of the ten methods
 * below needed a real fix, not a cosmetic one — see each method's own
 * comment for the specific discrepancy found and why the fix is shaped
 * the way it is. persistBotTurn and createTicketWithMessageAndSessionUpdate
 * were verified to already match live RPC signatures exactly; only their
 * comments were updated to note persist_bot_turn actually returns jsonb,
 * not void (harmless for this port, which only checks `!error`).
 *
 * Same "real implementation, mock is what tests actually exercise"
 * posture as before — verify this against a real deployment (e.g. the
 * sie-api Edge Function) before assuming test coverage alone proves it
 * correct.
 */
import { createSupabasePort } from './supabase-port.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 * @returns {import('./supabase-port.js').SupabasePort}
 */
export function createRealSupabasePort(supabaseClient) {
    async function persistBotTurn({ sessionId, turn, messageText, botState }) {
        // persist_bot_turn actually `returns jsonb` live (echoing
        // message_id/created_at/session_id/turn), not `void` as this
        // repo's own migration file claims -- harmless here since this
        // wrapper only inspects `error`, but worth knowing if you ever
        // want the returned message id.
        const { error } = await supabaseClient.rpc('persist_bot_turn', {
            p_session_id: sessionId,
            p_turn: turn,
            p_message_text: messageText,
            p_bot_state: botState
        });
        return { success: !error, error: error?.message ?? null };
    }

    async function createTicketWithMessageAndSessionUpdate({ sessionId, turn, messageText, botState, ticket }) {
        const { data, error } = await supabaseClient.rpc('create_ticket_with_message_and_session_update', {
            p_session_id: sessionId,
            p_turn: turn,
            p_message_text: messageText,
            p_bot_state: botState,
            p_scenario_id: ticket.scenarioId,
            p_category: ticket.category,
            p_description: ticket.description
        });
        return {
            success: !error,
            error: error?.message ?? null,
            ticketNumber: error ? null : (data?.[0]?.ticket_number ?? null)
        };
    }

    // Already matches the live chat_engine_trace_events columns exactly
    // (normalized_tokens, hypotheses, ranking, decision, knowledge_data,
    // rendered, action_result, response_language, processing_time_ms) --
    // verified, unchanged.
    async function insertTraceEvent({
        sessionId, turn, traceEvent,
        responseLanguage = null, processingTimeMs = null, actionResult = null, renderedOptions = null
    }) {
        const { error } = await supabaseClient.from('chat_engine_trace_events').insert({
            session_id: sessionId,
            turn,
            normalized_tokens: {
                rawText: traceEvent?.rawText ?? null,
                canonicals: traceEvent?.normalizedTokenCanonicals ?? []
            },
            hypotheses: traceEvent?.hypothesesSnapshot ?? [],
            ranking: traceEvent?.rankingSnapshot ?? {},
            decision: traceEvent?.decision ?? {},
            knowledge_data: traceEvent?.decision?.knowledgeData ?? null,
            rendered: { responseText: traceEvent?.responseText ?? '', options: renderedOptions ?? [] },
            action_result: actionResult,
            response_language: responseLanguage,
            processing_time_ms: processingTimeMs
        });
        return { success: !error, error: error?.message ?? null };
    }

    /**
     * FIXED. chat_engine_conversation_reviews has NO triggered_by_turn or
     * reason column, and a UNIQUE constraint on session_id (one review
     * row per conversation, not per flagged turn) -- both verified live.
     * status is CHECK-constrained to 'unresolved'|'reviewed'|'corrected',
     * not the 'open'|... this file previously inserted (which would have
     * violated the CHECK constraint on first use). Folds `reason` into
     * `notes` and upserts on session_id so re-flagging an already-flagged
     * conversation updates the existing row instead of erroring.
     */
    async function createConversationReview({ sessionId, triggeredByTurn, reason }) {
        const { data, error } = await supabaseClient
            .from('chat_engine_conversation_reviews')
            .upsert(
                {
                    session_id: sessionId,
                    status: 'unresolved',
                    notes: reason ? `Auto-flagged (${reason})${typeof triggeredByTurn === 'number' ? ` at turn ${triggeredByTurn}` : ''}` : null
                },
                { onConflict: 'session_id' }
            )
            .select('id')
            .single();
        return { success: !error, error: error?.message ?? null, reviewId: error ? null : (data?.id ?? null) };
    }

    /**
     * FIXED. status must be one of 'unresolved'|'reviewed'|'corrected'
     * (verified via the live CHECK constraint) -- callers still pass
     * `correction` (a free-text/scenario-id override), which maps onto
     * the real `corrected_scenario_id` column here; there is no separate
     * text column for it live.
     */
    async function updateConversationReview({ reviewId, status, correction = null }) {
        const { error } = await supabaseClient
            .from('chat_engine_conversation_reviews')
            .update({ status, corrected_scenario_id: correction, reviewed_at: new Date().toISOString() })
            .eq('id', reviewId);
        return { success: !error, error: error?.message ?? null };
    }

    /**
     * FIXED. create_chat_engine_scenario_draft does NOT exist as an RPC
     * on the live database (confirmed: no matching function in pg_proc,
     * and no migration ever created it) -- the migration file bundled in
     * this repo describing it was never actually applied. It was never
     * needed: the live RLS policy already grants staff (is_chat_engine_
     * staff()) a blanket ALL on chat_engine_scenarios, so a direct insert
     * works today with zero new database objects. Version numbering is
     * done here (max(version) for the key, +1) since there's no unique
     * constraint on (scenario_key, version) enforcing it server-side --
     * a small, accepted race window under concurrent draft creation for
     * the same key, no worse than what the RPC would have needed to
     * guard against internally anyway.
     */
    async function createScenarioDraft({ key, definition, authorNote = null }) {
        const { data: existing, error: readError } = await supabaseClient
            .from('chat_engine_scenarios')
            .select('version')
            .eq('scenario_key', key)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (readError) return { success: false, error: readError.message, draftVersion: null };

        const nextVersion = (existing?.version ?? 0) + 1;
        const { error } = await supabaseClient.from('chat_engine_scenarios').insert({
            scenario_key: key,
            version: nextVersion,
            status: 'draft',
            definition,
            notes: authorNote
        });
        return { success: !error, error: error?.message ?? null, draftVersion: error ? null : nextVersion };
    }

    /**
     * FIXED, mirroring createScenarioDraft. Two additional real
     * divergences from what this repo previously assumed: no
     * create_chat_engine_knowledge_draft RPC exists live either, and the
     * JSONB column on chat_engine_knowledge_entries is `content`, not
     * `definition` (see static-knowledge.supabase.js's fix for the read
     * side of this same discrepancy).
     */
    async function createKnowledgeDraft({ key, definition, authorNote = null }) {
        const { data: existing, error: readError } = await supabaseClient
            .from('chat_engine_knowledge_entries')
            .select('version')
            .eq('knowledge_key', key)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (readError) return { success: false, error: readError.message, draftVersion: null };

        const nextVersion = (existing?.version ?? 0) + 1;
        const { error } = await supabaseClient.from('chat_engine_knowledge_entries').insert({
            knowledge_key: key,
            version: nextVersion,
            status: 'draft',
            content: definition,
            notes: authorNote
        });
        return { success: !error, error: error?.message ?? null, draftVersion: error ? null : nextVersion };
    }

    /**
     * FIXED. chat_engine_validation_runs' live columns are
     * (run_type, target_type, target_key, before_version, after_version,
     * conversation_count, summary, details, pass_fail,
     * publish_recommendation, created_by, created_at) -- none of `kind`,
     * `target_version`, or `verdict` exist as columns; the previous
     * insert here would have failed outright. Mapped against the live
     * CHECK constraints (verified, not guessed):
     *   run_type              <- kind                 ('simulation'|'shadow_run')
     *   pass_fail             <- verdict.passed        ('pass'|'fail')
     *   publish_recommendation<- verdict.passed         ('safe_to_publish'|'requires_review')
     *   after_version         <- targetVersion (before_version stays null;
     *                            this port's callers only ever carry one version, not a range)
     *   summary               <- verdict itself (already a compact { passed, reasons, turnVerdicts })
     *   conversation_count    <- best-effort count from `details` (results[]/turns[] length, else 0)
     */
    async function insertValidationRun({ kind, targetType, targetKey, targetVersion, verdict, details }) {
        const conversationCount =
            (Array.isArray(details?.results) && details.results.length) ||
            (Array.isArray(details?.turns) && details.turns.length) ||
            0;

        const { data, error } = await supabaseClient
            .from('chat_engine_validation_runs')
            .insert({
                run_type: kind,
                target_type: targetType,
                target_key: targetKey,
                before_version: null,
                after_version: targetVersion ?? null,
                conversation_count: conversationCount,
                summary: verdict ?? {},
                details: details ?? {},
                pass_fail: verdict?.passed ? 'pass' : 'fail',
                publish_recommendation: verdict?.passed ? 'safe_to_publish' : 'requires_review'
            })
            .select('id')
            .single();
        return { success: !error, error: error?.message ?? null, runId: error ? null : (data?.id ?? null) };
    }

    /**
     * FIXED. publish_chat_engine_scenario is live with only
     * (p_scenario_key, p_version) -- NOT the 3-arg
     * (..., p_override_reason) signature in this repo's own migration
     * file, which was never actually applied as written. Passing a 3rd
     * argument to a 2-arg Postgres function raises immediately, so the
     * old code here would have failed on every call, override or not.
     *
     * The override-audit trail is preserved by writing directly to
     * chat_engine_publish_overrides (verified live columns:
     * target_type, target_key, reason, overridden_by, validation_run_id,
     * created_at) as a best-effort separate step BEFORE publishing --
     * its failure is logged, never allowed to block the actual publish,
     * since the override record is audit metadata, not the operation
     * itself.
     */
    async function publishScenario({ key, version, overrideReason = null }) {
        if (overrideReason && overrideReason.trim().length > 0) {
            const { error: overrideError } = await supabaseClient.from('chat_engine_publish_overrides').insert({
                target_type: 'scenario',
                target_key: key,
                reason: overrideReason
            });
            if (overrideError) {
                // eslint-disable-next-line no-console
                console.warn('[supabase-port] failed to record publish override (publish still proceeds):', overrideError.message);
            }
        }
        const { error } = await supabaseClient.rpc('publish_chat_engine_scenario', {
            p_scenario_key: key,
            p_version: version
        });
        return { success: !error, error: error?.message ?? null };
    }

    /** FIXED, mirroring publishScenario -- same 2-arg live RPC signature. */
    async function publishKnowledge({ key, version, overrideReason = null }) {
        if (overrideReason && overrideReason.trim().length > 0) {
            const { error: overrideError } = await supabaseClient.from('chat_engine_publish_overrides').insert({
                target_type: 'knowledge',
                target_key: key,
                reason: overrideReason
            });
            if (overrideError) {
                // eslint-disable-next-line no-console
                console.warn('[supabase-port] failed to record publish override (publish still proceeds):', overrideError.message);
            }
        }
        const { error } = await supabaseClient.rpc('publish_chat_engine_knowledge', {
            p_knowledge_key: key,
            p_version: version
        });
        return { success: !error, error: error?.message ?? null };
    }

    return createSupabasePort({
        persistBotTurn,
        createTicketWithMessageAndSessionUpdate,
        insertTraceEvent,
        createConversationReview,
        updateConversationReview,
        createScenarioDraft,
        createKnowledgeDraft,
        insertValidationRun,
        publishScenario,
        publishKnowledge
    });
}
