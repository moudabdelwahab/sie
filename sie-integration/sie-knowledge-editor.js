/**
 * sie-knowledge-editor.js  —  INTERNAL TO SIE
 * ------------------------------------------------------------
 * ⚠️ Not a public surface. Mad3oom imports sie-runtime.js instead.
 *
 * The knowledge-entry twin of sie-scenario-editor.js: read the stored
 * versions, validate a proposed entry against Module 7's own validator,
 * and save it as a draft. Publishing goes through the same gated action
 * as scenarios.
 *
 * ------------------------------------------------------------
 * WHY IT ONLY APPEARED NOW
 *
 * The whole write path — action-layer's saveKnowledgeDraft, the port's
 * createKnowledgeDraft and publishKnowledge, the RLS policy letting staff
 * manage chat_engine_knowledge_entries — has existed since the action
 * layer was built. Nothing above it ever called them, so knowledge could
 * be read by the engine and edited only by someone with SQL access.
 *
 * The document import needs to write knowledge entries, so this is the
 * thin layer that was missing, not new machinery.
 *
 * Same posture as every other file in this directory: every export is
 * total. A failure degrades to an empty list or a structured error and
 * never takes down the console.
 */
import { validateStaticKnowledgeEntry } from '../sie/knowledge/knowledge-types.js';
import { saveKnowledgeDraft as saveKnowledgeDraftAction } from '../sie/action/action-layer.js';
import { createRealSupabasePort } from '../sie/action/supabase-port.supabase.js';

/**
 * Every stored version of every knowledge entry, newest first.
 * Staff-only by RLS; a non-staff caller gets an empty list rather than a
 * thrown error.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<Array<{knowledge_key: string, version: number, status: string, notes: string|null, created_at: string}>>}
 */
export async function listStoredKnowledgeVersions(supabase) {
    try {
        const { data, error } = await supabase
            .from('chat_engine_knowledge_entries')
            .select('knowledge_key, version, status, notes, created_at')
            .order('created_at', { ascending: false });
        if (error) {
            console.warn('[sie] listStoredKnowledgeVersions failed:', error.message);
            return [];
        }
        return data || [];
    } catch (err) {
        console.warn('[sie] listStoredKnowledgeVersions threw:', err?.message || err);
        return [];
    }
}

/**
 * @param {*} entry
 * @returns {Promise<{valid: boolean, errors: string[]}>}
 */
export async function validateKnowledgeDraft(entry) {
    return validateStaticKnowledgeEntry(entry);
}

/**
 * Saves a proposed knowledge entry as a new draft version. Never
 * publishes — the live engine keeps answering from the current published
 * version until a separate publish step promotes this one.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{key: string, definition: *, authorNote?: string|null}} params
 * @returns {Promise<{success: boolean, error: string|null, draftVersion: number|null}>}
 */
export async function saveKnowledgeDraft(supabase, { key, definition, authorNote = null }) {
    try {
        const port = createRealSupabasePort(supabase);
        const result = await saveKnowledgeDraftAction({ key, definition, authorNote, port });
        return {
            success: result.success,
            error: result.success ? null : (result.steps?.[0]?.error ?? 'unknown error'),
            draftVersion: result.draftVersion ?? null
        };
    } catch (err) {
        console.warn('[sie] saveKnowledgeDraft threw:', err?.message || err);
        return { success: false, error: err?.message || String(err), draftVersion: null };
    }
}
