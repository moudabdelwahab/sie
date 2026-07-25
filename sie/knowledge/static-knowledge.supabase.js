/**
 * static-knowledge.supabase.js
 * ------------------------------------------------------------
 * Supabase-backed implementation of the static knowledge provider.
 * Reuses createStaticKnowledgeProvider() completely unchanged — same
 * factory, same validation, same caching, same
 * getAllEntries/getEntryByKey/getLoadWarnings interface every other
 * module already depends on. Only the loadFn is new.
 * answer-composer.js remains completely unaware this file exists — it
 * only ever calls the provider interface.
 *
 * Reads only the latest PUBLISHED version of each knowledge_key from
 * chat_engine_knowledge_entries.
 *
 * CORRECTED (verified against the live schema via Supabase MCP, not
 * assumed): the JSONB column on chat_engine_knowledge_entries is named
 * `content`, not `definition` — this file previously selected
 * `definition`, which does not exist on the live table and would have
 * failed with a Postgres "column does not exist" error the first time
 * it actually ran. `chat_engine_scenarios` genuinely does use
 * `definition` (verified separately) — the two tables are NOT
 * symmetric, despite both being created in the same original migration
 * pass. Do not "fix" this back to `definition` by analogy with
 * scenario-catalog.supabase.js.
 *
 * static-knowledge.local.js is untouched and remains the default; this
 * file is opt-in, used wherever a Supabase-backed catalog is explicitly
 * wanted.
 */
import { createStaticKnowledgeProvider } from './static-knowledge.provider.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 * @returns {ReturnType<typeof createStaticKnowledgeProvider>}
 */
export function createStaticKnowledgeSupabaseProvider(supabaseClient) {
    return createStaticKnowledgeProvider(async () => {
        const { data, error } = await supabaseClient
            .from('chat_engine_knowledge_entries')
            .select('knowledge_key, version, content')
            .eq('status', 'published')
            .order('version', { ascending: false });

        if (error) {
            throw new Error(`Failed to load knowledge entries from Supabase: ${error.message}`);
        }

        // Rows are ordered by version descending, so the first row seen
        // for a given knowledge_key is its latest published version.
        const seenKeys = new Set();
        const entries = [];
        for (const row of data || []) {
            if (seenKeys.has(row.knowledge_key)) continue;
            seenKeys.add(row.knowledge_key);
            entries.push(row.content);
        }
        return entries;
    });
}
