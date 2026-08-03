/**
 * telegram-end-to-end.test.mjs
 * ------------------------------------------------------------
 * رسالة تيليجرام حقيقية بتعدي على المحرك الحقيقي وترجع رد حقيقي.
 *
 * The other test file exercises the layer with a fake SIE. This one wires
 * the REAL sie-runtime.js — the whole Language -> Diagnostics -> Ranking
 * -> Decision -> Knowledge -> Dialogue chain — behind a fake Supabase and
 * a fake Bot API. That is what actually answers requirement 3 and 5: the
 * standard shape really does drive the engine, and the engine's reply
 * really does come back out in Telegram's format.
 *
 * ------------------------------------------------------------
 * WHY THE fetch SHIM
 *
 * SIE's data providers load their JSON with `fetch(new URL('./x.json',
 * import.meta.url))` — correct in a browser and in Deno, both of which
 * serve file: URLs. Node's fetch does not, so the engine cannot load
 * here without this. It is a TEST shim, not production code: the Edge
 * Function runs on Deno, where file: fetch works natively.
 *
 * This is worth stating plainly rather than hiding: it is the one place
 * where "runs in Node" and "runs in production" genuinely differ, and it
 * is the reason the Deno deployment still needs a real smoke test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input?.href ?? String(input);
    if (href.startsWith('file:')) {
        const body = await readFile(new URL(href), 'utf8');
        return { ok: true, status: 200, async json() { return JSON.parse(body); } };
    }
    return realFetch(input, init);
};

const { handleInbound } = await import('../core/channel-adapter.js');
const { createTelegramAdapter } = await import('../telegram/telegram-adapter.js');
const { createInProcessSieClient } = await import('../core/sie-client.js');
const { createMemoryDeduplicator } = await import('../core/delivery.js');
const { getSieReply } = await import('../../sie-integration/sie-runtime.js');
const { getSieSettings } = await import('../../sie-integration/sie-entitlement.js');

const SECRET = 'e2e-secret';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const silentLogger = { info() {}, warn() {}, error() {} };

/**
 * A Supabase double that behaves the way the real one does for the calls
 * this path makes: settings read, quota spend, and the Action Layer's
 * writes (which go through the injected port, so they never touch this).
 */
function fakeSupabase({ settings = {} } = {}) {
    const consumed = [];
    return {
        consumed,
        from(table) {
            if (table === 'sie_settings') {
                return { select: async () => ({ data: Object.entries(settings).map(([key, value]) => ({ key, value })), error: null }) };
            }
            const chain = {
                select: () => chain, eq: () => chain, neq: () => chain, gte: () => chain,
                in: () => chain, order: () => chain, limit: () => chain,
                maybeSingle: async () => ({ data: null, error: null }),
                single: async () => ({ data: { id: 'session-1', bot_state: {} }, error: null }),
                insert: () => chain, update: () => chain,
                then: (resolve) => resolve({ data: [], error: null })
            };
            return chain;
        },
        async rpc(fn, args) {
            if (fn === 'sie_consume_message') {
                consumed.push(args);
                return { data: [{ allowed: true, reason: null, remaining: 99 }], error: null };
            }
            return { data: null, error: null };
        }
    };
}

/** A session store double — the real one is exercised against Supabase, not here. */
function fakeSessions() {
    let state = null;
    return {
        async getOrCreate() { return { sessionId: 'session-1', botState: state }; },
        async saveState(_id, botState) { state = botState; },
        get state() { return state; }
    };
}

function fakeApi() {
    const sent = [];
    return {
        sent,
        async sendMessage(chatId, text, options) { sent.push({ chatId, text, options }); },
        async sendChatAction() {}
    };
}

function update(text, messageId = 1) {
    return {
        update_id: messageId,
        message: {
            message_id: messageId,
            date: Math.floor(Date.now() / 1000),
            from: { id: 555, is_bot: false, first_name: 'محمود', language_code: 'ar' },
            chat: { id: 555, type: 'private' },
            text
        }
    };
}

/**
 * The engine caches settings for a minute, and these tests share one module
 * instance — so each build() forces a fresh read against its own fake, or a
 * test would inherit whatever the previous one configured.
 */
async function build({ settings } = {}) {
    const api = fakeApi();
    const supabase = fakeSupabase({ settings });
    await getSieSettings(supabase, { fresh: true });
    const sessions = fakeSessions();
    const adapter = createTelegramAdapter({ botToken: 'x', secretToken: SECRET, api, logger: silentLogger });

    // The Action Layer's writes go through this port, so nothing in the test
    // reaches a database — but the decision to write is still made by the
    // real pipeline.
    const port = {
        async persistBotTurn() { return { success: true }; },
        async createTicketWithMessage() { return { success: true, ticketId: 't1', ticketNumber: 501 }; }
    };

    return {
        api, supabase, sessions, adapter,
        deps: {
            logger: silentLogger,
            identity: { async resolve() { return { linked: true, userId: USER_ID, reply: null }; } },
            sieClient: createInProcessSieClient({
                supabase,
                sessions,
                // The runtime's own signature, with the port injected so the
                // Action Layer writes nowhere.
                getSieReply: (params) => getSieReply({ ...params, port }),
                logger: silentLogger
            }),
            entitlement: { async explainRefusal() { return 'مش مفعّل'; } },
            dedupe: createMemoryDeduplicator()
        }
    };
}

function request(payload) {
    return { headers: { 'x-telegram-bot-api-secret-token': SECRET }, body: payload, url: '/' };
}

test('من تيليجرام للمحرك وبالعكس: سؤال حقيقي بياخد رد حقيقي', async () => {
    const { adapter, deps, api } = await build();

    const result = await handleInbound({ adapter, request: request(update('الرسايل مش بتتبعت للجروبات')), deps });

    assert.equal(result.results[0].outcome, 'replied');
    assert.equal(api.sent.length, 1);
    assert.equal(api.sent[0].chatId, '555');
    // المحرك الحقيقي بيعرف الحالة دي وعنده حل مخزّن ليها.
    assert.ok(api.sent[0].text.length > 80, `الرد قصير أوي: ${api.sent[0].text}`);
    assert.ok(/واتساب|جروب|WhatsApp/i.test(api.sent[0].text), 'الرد لازم يكون عن نفس الموضوع');
});

test('الرد بالعربي لأن العميل كتب بالعربي', async () => {
    const { adapter, deps, api } = await build();
    await handleInbound({ adapter, request: request(update('الاشتراك بتاعي منتهي')), deps });
    assert.ok(/[؀-ۿ]/.test(api.sent[0].text), 'مفيش حروف عربية في الرد');
});

test('الرصيد بيتصرف مرة واحدة للرسالة الواحدة', async () => {
    const { adapter, deps, supabase } = await build();
    await handleInbound({ adapter, request: request(update('عندي مشكلة في الاشتراك')), deps });
    assert.equal(supabase.consumed.length, 1);
    assert.equal(supabase.consumed[0].p_user_id, USER_ID, 'بيتصرف على الحساب المربوط');
});

test('السياق بيفضل بين الرسايل — مش كل رسالة تبدأ من أول', async () => {
    const { adapter, deps, sessions } = await build();

    await handleInbound({ adapter, request: request(update('الرسايل مش بتتبعت للجروبات', 1)), deps });
    const afterFirst = sessions.state?.sie?.turnCount;

    await handleInbound({ adapter, request: request(update('اهو كده', 2)), deps });
    const afterSecond = sessions.state?.sie?.turnCount;

    assert.equal(afterFirst, 1);
    assert.equal(afterSecond, 2, 'الدور التاني لازم يبني على الأول');
});

test('التحية بتاخد ترحيب مش تشخيص', async () => {
    const { adapter, deps, api } = await build();
    await handleInbound({ adapter, request: request(update('السلام عليكم')), deps });
    assert.ok(/أهلاً|اهلا|مرحب/.test(api.sent[0].text));
});

test('إعدادات المحرك بتسري على تيليجرام زي الموقع', async () => {
    // نفس جدول sie_settings بيتحكم في كل القنوات — مفيش إعدادات لكل قناة.
    const { adapter, deps, api } = await build({ settings: { engine_enabled: false } });

    const result = await handleInbound({ adapter, request: request(update('الرسايل مش بتتبعت للجروبات')), deps });

    assert.equal(result.results[0].outcome, 'not_handled', 'المحرك مقفول يعني مفيش رد منه');
    assert.equal(api.sent[0].text, 'مش مفعّل', 'العميل بياخد شرح مش سكوت');
});

test('الذكاء العاطفي شغّال على تيليجرام', async () => {
    const { adapter, deps, api } = await build();
    await handleInbound({ adapter, request: request(update('محتاج حل دلوقتي الشغل واقف')), deps });
    assert.ok(/مستعجل|هختصر/.test(api.sent[0].text), 'لازم يحس بالاستعجال');
});

test('الأزرار بتتحول لكيبورد تيليجرام', async () => {
    const { adapter, deps, api } = await build();
    await handleInbound({ adapter, request: request(update('الرسايل مش بتتبعت للجروبات')), deps });

    const markup = api.sent[0].options?.reply_markup;
    assert.ok(markup, 'مفيش reply_markup');
    if (markup.keyboard) {
        for (const row of markup.keyboard) {
            for (const button of row) {
                assert.ok(!button.text.includes('[[icon:'), `علامة أيقونة ظاهرة للعميل: ${button.text}`);
            }
        }
    }
});
