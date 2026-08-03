/**
 * sie-customer-memory.js  —  INTERNAL TO SIE
 * ------------------------------------------------------------
 * الذاكرة: اللي المحرك يقدر يفتكره عن العميل من برّه المحادثة الحالية.
 *
 * ⚠️ Not a public surface — Mad3oom imports sie-runtime.js.
 *
 * ------------------------------------------------------------
 * OWNERSHIP
 *
 * Everything here READS Mad3oom-owned tables (`profiles`, `tickets`,
 * `chat_sessions`) and writes none of them. That is the whole reason this
 * file sits in sie-integration/ rather than under sie/: the engine modules
 * stay ignorant of Mad3oom's schema, and the one file that isn't is the
 * one whose job is precisely to bridge the two.
 *
 * Every function here is OFF by default at the settings layer, or cheap
 * enough to leave on. That is deliberate — each one is a database round
 * trip on the customer-facing path, so none of them may be assumed.
 *
 * Every function degrades to "no memory" on any failure. A memory lookup
 * that fails must never cost the customer their answer, so nothing here
 * throws and nothing here blocks.
 */

/**
 * «يفتكر اسم العميل».
 *
 * Returns a first name only. Greeting someone by their full legal name
 * reads as a form letter, which is the opposite of the point.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<string|null>}
 */
export async function recallCustomerName(supabase, userId) {
    if (!userId) return null;
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('first_name, full_name')
            .eq('id', userId)
            .maybeSingle();
        if (error || !data) return null;

        const name = (data.first_name || '').trim() || (data.full_name || '').trim().split(/\s+/)[0] || '';
        return name || null;
    } catch {
        return null;
    }
}

/**
 * «يدوّر في تذاكر العميل القديمة قبل ما يرد».
 *
 * Looks for a still-open ticket in the same category the engine is about
 * to open one for. Opening a second ticket for a problem an agent is
 * already working is worse than useless: it splits the history across two
 * threads and makes the queue look busier than it is.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string|null} category
 * @returns {Promise<{ticketNumber: number, title: string, createdAt: string}|null>}
 */
export async function findOpenTicket(supabase, userId, category) {
    if (!userId) return null;
    try {
        let query = supabase
            .from('tickets')
            .select('ticket_number, title, created_at, category, status')
            .eq('user_id', userId)
            .in('status', ['open', 'in_progress', 'pending'])
            .order('created_at', { ascending: false })
            .limit(1);

        // A category match is the point — an open billing ticket is no
        // reason to withhold a new one about WhatsApp. With no category to
        // match on, the most recent open ticket is the best available
        // signal, which is why the filter is conditional rather than absent.
        if (category) query = query.eq('category', category);

        const { data, error } = await query;
        if (error || !data || data.length === 0) return null;

        const ticket = data[0];
        return { ticketNumber: ticket.ticket_number, title: ticket.title, createdAt: ticket.created_at };
    } catch {
        return null;
    }
}

/**
 * «يستفيد من المحادثات القديمة».
 *
 * Returns the SIE state from this customer's most recent *other* session,
 * so a customer who opens a new chat about the same unresolved problem is
 * not made to explain it from scratch.
 *
 * Off by default: it is a query per new conversation, and carrying
 * yesterday's evidence into today's chat is exactly the wrong thing when
 * the customer has moved on to an unrelated problem. Operators who see
 * repeat contacts about the same issue want it; operators with broad
 * traffic do not.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string} currentSessionId
 * @param {number} withinMinutes - anything older is treated as a different problem
 * @returns {Promise<Object|null>}
 */
export async function recallPreviousSession(supabase, userId, currentSessionId, withinMinutes = 1440) {
    if (!userId) return null;
    try {
        const since = new Date(Date.now() - withinMinutes * 60000).toISOString();
        const { data, error } = await supabase
            .from('chat_sessions')
            .select('id, bot_state, updated_at')
            .eq('user_id', userId)
            .neq('id', currentSessionId)
            .gte('updated_at', since)
            .order('updated_at', { ascending: false })
            .limit(1);

        if (error || !data || data.length === 0) return null;
        const sie = data[0].bot_state?.sie;
        if (!sie?.diagnosticState) return null;

        // Only the LABEL and the diagnostic state carry over, never the
        // decision state: question counts, "already ticketed", and turn
        // budgets belong to the conversation that spent them. Carrying
        // those would start a fresh chat with its budget already gone.
        return {
            diagnosticState: sie.diagnosticState,
            lastScenarioLabel: sie.lastScenarioLabel || null,
            fromSessionId: data[0].id
        };
    } catch {
        return null;
    }
}

// ===================================================================
// الذاكرة الدائمة: حاجات العميل طلب إن المحرك يفتكرها
// ===================================================================

/**
 * ------------------------------------------------------------
 * WHY THIS IS NOT bot_state
 *
 * chat_sessions.bot_state is the DIAGNOSTIC state of one conversation, and
 * it is deliberately wiped when a problem is resolved — that reset is what
 * stops the engine re-answering a closed issue.
 *
 * "I am the owner of the platform" must survive that. It is true after the
 * WhatsApp question is closed and true in next month's conversation, so it
 * lives in its own table keyed by account, not by session.
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {Array<{key: string, value: string}>} facts
 * @returns {Promise<{saved: number}>}
 */
export async function rememberFacts(supabase, userId, facts) {
    if (!userId || !Array.isArray(facts) || facts.length === 0) return { saved: 0 };
    try {
        const rows = facts.map((fact) => ({
            user_id: userId,
            key: fact.key,
            value: String(fact.value).slice(0, 500),
            updated_at: new Date().toISOString()
        }));
        // Upsert on (user_id, key): a customer who corrects their name ends
        // up with one name, not two contradictory rows.
        const { error } = await supabase
            .from('sie_customer_memory')
            .upsert(rows, { onConflict: 'user_id,key' });
        if (error) {
            console.warn('[sie] could not save customer memory:', error.message);
            return { saved: 0 };
        }
        return { saved: rows.length };
    } catch (err) {
        console.warn('[sie] saving customer memory threw:', err?.message || err);
        return { saved: 0 };
    }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<Array<{key: string, value: string}>>}
 */
export async function recallFacts(supabase, userId) {
    if (!userId) return [];
    try {
        const { data, error } = await supabase
            .from('sie_customer_memory')
            .select('key, value')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false });
        if (error) {
            console.warn('[sie] could not read customer memory:', error.message);
            return [];
        }
        return data || [];
    } catch (err) {
        console.warn('[sie] reading customer memory threw:', err?.message || err);
        return [];
    }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @returns {Promise<{forgotten: boolean}>}
 */
export async function forgetFacts(supabase, userId) {
    if (!userId) return { forgotten: false };
    try {
        const { error } = await supabase.from('sie_customer_memory').delete().eq('user_id', userId);
        if (error) {
            console.warn('[sie] could not clear customer memory:', error.message);
            return { forgotten: false };
        }
        return { forgotten: true };
    } catch (err) {
        console.warn('[sie] clearing customer memory threw:', err?.message || err);
        return { forgotten: false };
    }
}
