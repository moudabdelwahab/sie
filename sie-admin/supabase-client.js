/**
 * supabase-client.js — standalone Supabase client for sie-admin
 * ------------------------------------------------------------
 * sie-admin pages are served from their own origin (a separate
 * deployment of the `sie` repo) and must NOT import anything from the
 * main Mad3oom platform repo — files like `/api-config.js`,
 * `/styles.css`, `/theme-manager.js` simply don't exist on this origin
 * and 404 (that's the root cause of the console errors: the page tries
 * to fetch platform-repo files across a deployment boundary).
 *
 * This file creates its OWN Supabase client, pointed at the exact same
 * Supabase project the main platform uses. Same project = same
 * auth.users table, same session cookies pattern, same RLS, same
 * is_chat_engine_staff()/is_sie_admin() RPCs. Nothing about behavior
 * changes — only where the client object comes from.
 *
 * Loaded via esm.sh (a CDN that re-exports npm packages as native ES
 * modules), so no bundler/build step is needed — this stays a plain
 * <script type="module"> import, exactly like the rest of this repo.
 *
 * ⚠️ FILL THESE IN before deploying:
 *   SUPABASE_URL        - Supabase Dashboard -> Project Settings -> API -> Project URL
 *   SUPABASE_ANON_KEY    - Supabase Dashboard -> Project Settings -> API -> Project API keys -> anon/public
 *
 * The anon key is meant to be public (it ships in every browser bundle
 * of any Supabase app) — Row Level Security on the tables is what
 * actually protects data, not secrecy of this key. It DOES need to be
 * the anon key for the SAME project mad3oom.online/mad3oom.com uses —
 * pointing at a different project's keys would create a second,
 * disconnected user base with no shared sessions or data.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://srnelrdpqkcntbgudyto.supabase.co'; // TODO: confirm this is your project's URL
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNybmVscmRwcWtjbnRiZ3VkeXRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxNDYwNDcsImV4cCI6MjA3ODcyMjA0N30.Ox7wWQPu7GjYnjpx1w3gNYnDIykfANN4ott6narxdZI'; // TODO: fill in

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
    }
});
