import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
    CHANNELS, createInboundMessage, hasProcessableContent,
    hasUnsupportedAttachmentOnly, deduplicationKey
} from '../core/channel-message.js';
import { defineAdapter, createAdapterRegistry, handleInbound, CHANNEL_REPLIES } from '../core/channel-adapter.js';
import { constantTimeEquals, readHeader } from '../core/request-verify.js';
import { withRetry, backoffDelay, DeliveryError, isRetryableStatus, createMemoryDeduplicator } from '../core/delivery.js';
import { createLogger, redact } from '../core/logger.js';
import { extractLinkCode } from '../core/channel-identity.js';
import { channelSessionTag } from '../core/channel-session.js';
import { createTelegramAdapter, buildReplyMarkup, stripIconMarkers } from '../telegram/telegram-adapter.js';
import { normalizeUpdate } from '../telegram/telegram-normalize.js';
import { splitMessage } from '../telegram/telegram-api.js';
import { createWebsiteAdapter } from '../website/website-adapter.js';
import { createWhatsAppAdapter } from '../whatsapp/whatsapp-adapter.js';
import { createMessengerAdapter } from '../messenger/messenger-adapter.js';
import { createApiAdapter } from '../api/api-adapter.js';

const SECRET = 'test-secret-token';
const silentLogger = { info() {}, warn() {}, error() {} };

function telegramUpdate(overrides = {}) {
    return {
        update_id: 1,
        message: {
            message_id: 100,
            date: 1700000000,
            from: { id: 555, is_bot: false, first_name: 'محمود', language_code: 'ar' },
            chat: { id: 555, type: 'private' },
            text: 'الاشتراك بتاعي منتهي',
            ...overrides
        }
    };
}

function telegramRequest(update, secret = SECRET) {
    return { headers: { 'X-Telegram-Bot-Api-Secret-Token': secret }, body: update, url: '/' };
}

/** A test double for the Bot API — no network, no token. */
function fakeTelegramApi() {
    const sent = [];
    const actions = [];
    return {
        sent,
        actions,
        async sendMessage(chatId, text, options) { sent.push({ chatId, text, options }); return { message_id: sent.length }; },
        async sendChatAction(chatId) { actions.push(chatId); }
    };
}

function buildDeps({ reply = { text: 'رد المحرك', options: [] }, linked = true, userId = 'user-1' } = {}) {
    const calls = { sie: [], explained: 0 };
    return {
        calls,
        deps: {
            logger: silentLogger,
            identity: { async resolve() { return { linked, userId: linked ? userId : null, reply: null }; } },
            sieClient: {
                async reply(params) {
                    calls.sie.push(params);
                    return typeof reply === 'function' ? reply(params) : reply;
                }
            },
            entitlement: { async explainRefusal() { calls.explained += 1; return 'اشتراكك خلص'; } }
        }
    };
}

// ══════════════════ الصيغة القياسية ══════════════════

test('createInboundMessage: بيملأ الناقص بقيم افتراضية', () => {
    const message = createInboundMessage({ channel: CHANNELS.TELEGRAM, channelUserId: 1, channelChatId: 2 });
    assert.equal(message.text, '');
    assert.deepEqual(message.attachments, []);
    assert.equal(typeof message.receivedAt, 'number');
});

test('createInboundMessage: المعرّفات بتتحول لنصوص', () => {
    // تيليجرام بيبعت أرقام، وقاعدة البيانات بتخزن نصوص. مقارنة رقم بنص
    // بتفشل بصمت لبعض الحسابات بس.
    const message = createInboundMessage({ channel: CHANNELS.TELEGRAM, channelUserId: 555, channelChatId: 999 });
    assert.strictEqual(message.channelUserId, '555');
    assert.strictEqual(message.channelChatId, '999');
});

test('hasProcessableContent: المسافات مش محتوى', () => {
    assert.equal(hasProcessableContent(createInboundMessage({ text: '   ' })), false);
    assert.equal(hasProcessableContent(createInboundMessage({ text: 'أهلاً' })), true);
});

test('hasUnsupportedAttachmentOnly: صورة من غير تعليق', () => {
    const withCaption = createInboundMessage({ text: 'شوف الصورة', attachments: [{ kind: 'image' }] });
    const without = createInboundMessage({ text: '', attachments: [{ kind: 'image' }] });
    assert.equal(hasUnsupportedAttachmentOnly(withCaption), false);
    assert.equal(hasUnsupportedAttachmentOnly(without), true);
});

test('deduplicationKey: بيفرّق بين القنوات', () => {
    const a = createInboundMessage({ channel: 'telegram', channelChatId: '1', messageId: '9' });
    const b = createInboundMessage({ channel: 'whatsapp', channelChatId: '1', messageId: '9' });
    assert.notEqual(deduplicationKey(a), deduplicationKey(b));
});

// ══════════════════ الواجهة ══════════════════

test('defineAdapter: بيرفض المحوّل الناقص', () => {
    assert.throws(() => defineAdapter({ name: CHANNELS.TELEGRAM, verify() {}, parse() {} }), /missing send/);
});

test('defineAdapter: بيرفض اسم قناة مش معروف', () => {
    assert.throws(() => defineAdapter({ name: 'discord', verify() {}, parse() {}, send() {} }), /unknown channel/);
});

test('registry: بيرفض تسجيل نفس القناة مرتين', () => {
    const registry = createAdapterRegistry();
    const adapter = { name: CHANNELS.API, verify: () => ({ ok: true }), parse: () => [], send: async () => {} };
    registry.register(adapter);
    assert.throws(() => registry.register(adapter), /already registered/);
});

test('كل القنوات الخمسة بتنفّذ نفس الواجهة', () => {
    const registry = createAdapterRegistry();
    registry.register(createTelegramAdapter({ botToken: 't', secretToken: SECRET, api: fakeTelegramApi() }));
    registry.register(createWebsiteAdapter({ render: async () => {} }));
    registry.register(createWhatsAppAdapter({ verifySignature: () => true, sendMessage: async () => {} }));
    registry.register(createMessengerAdapter({ verifySignature: () => true, sendMessage: async () => {} }));
    registry.register(createApiAdapter({ authenticateToken: async () => ({ valid: true }), deliver: async () => {} }));

    assert.equal(registry.size, 5);
    assert.deepEqual(registry.names().sort(), ['api', 'messenger', 'telegram', 'website', 'whatsapp']);
});

// ══════════════════ التحقق من الطلب ══════════════════

test('constantTimeEquals: بيقارن صح', () => {
    assert.equal(constantTimeEquals('abc', 'abc'), true);
    assert.equal(constantTimeEquals('abc', 'abd'), false);
    assert.equal(constantTimeEquals('abc', 'abcd'), false);
    assert.equal(constantTimeEquals('', ''), true);
    assert.equal(constantTimeEquals(null, undefined), true, 'الاتنين فاضيين');
});

test('readHeader: مش حساس لحالة الحروف، وبيقبل Headers', () => {
    assert.equal(readHeader({ 'X-Thing': 'v' }, 'x-thing'), 'v');
    assert.equal(readHeader(new Headers({ 'x-thing': 'v' }), 'X-Thing'), 'v');
    assert.equal(readHeader(null, 'x'), null);
});

test('تيليجرام: بيرفض السر الغلط', () => {
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: SECRET, api: fakeTelegramApi() });
    assert.equal(adapter.verify(telegramRequest(telegramUpdate(), 'wrong')).ok, false);
    assert.equal(adapter.verify(telegramRequest(telegramUpdate(), 'wrong')).reason, 'secret_mismatch');
});

test('تيليجرام: بيرفض الطلب اللي مالوش هيدر السر', () => {
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: SECRET, api: fakeTelegramApi() });
    assert.equal(adapter.verify({ headers: {}, body: telegramUpdate() }).reason, 'missing_secret_header');
});

test('تيليجرام: سر فاضي في الإعداد = رفض، مش سماح', () => {
    // الأهم في الملف ده: نشر من غير سر لازم يبقى عطل واضح، مش ثغرة صامتة.
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: '', api: fakeTelegramApi() });
    const result = adapter.verify(telegramRequest(telegramUpdate(), ''));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no_secret_configured');
});

test('تيليجرام: بيقبل السر الصح', () => {
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: SECRET, api: fakeTelegramApi() });
    assert.equal(adapter.verify(telegramRequest(telegramUpdate())).ok, true);
});

test('تيليجرام: بيرفض حاجة مش Update', () => {
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: SECRET, api: fakeTelegramApi() });
    assert.equal(adapter.verify({ headers: { 'x-telegram-bot-api-secret-token': SECRET }, body: { hi: 1 } }).reason, 'not_an_update');
});

// ══════════════════ تحويل رسالة تيليجرام ══════════════════

test('normalizeUpdate: بيحوّل الرسالة العادية', () => {
    const [message] = normalizeUpdate(telegramUpdate());
    assert.equal(message.channel, 'telegram');
    assert.equal(message.text, 'الاشتراك بتاعي منتهي');
    assert.equal(message.channelChatId, '555');
    assert.equal(message.displayName, 'محمود');
    assert.equal(message.locale, 'ar');
});

test('normalizeUpdate: بيتجاهل رسايل البوتات', () => {
    assert.deepEqual(normalizeUpdate(telegramUpdate({ from: { id: 1, is_bot: true } })), []);
});

test('normalizeUpdate: بيتجاهل الجروبات', () => {
    // في الجروب البوت بيشوف كل رسالة؛ الرد على كلها غلط وغالي.
    assert.deepEqual(normalizeUpdate(telegramUpdate({ chat: { id: -100, type: 'group' } })), []);
});

test('normalizeUpdate: بيقرا الرسالة المعدّلة', () => {
    const update = { update_id: 2, edited_message: telegramUpdate().message };
    const [message] = normalizeUpdate(update);
    assert.equal(message.text, 'الاشتراك بتاعي منتهي');
});

test('normalizeUpdate: التعليق على الصورة بيتقرا كنص', () => {
    const [message] = normalizeUpdate(telegramUpdate({
        text: undefined,
        caption: 'المشكلة في الصورة دي',
        photo: [{ file_id: 'small', file_size: 100 }, { file_id: 'large', file_size: 900 }]
    }));
    assert.equal(message.text, 'المشكلة في الصورة دي');
    assert.equal(message.attachments[0].kind, 'image');
    assert.equal(message.attachments[0].id, 'large', 'بياخد أكبر مقاس');
});

test('normalizeUpdate: الصوت والملف بيتسجلوا للمستقبل', () => {
    const [voice] = normalizeUpdate(telegramUpdate({ text: undefined, voice: { file_id: 'v1', mime_type: 'audio/ogg' } }));
    assert.equal(voice.attachments[0].kind, 'voice');
    const [file] = normalizeUpdate(telegramUpdate({ text: undefined, document: { file_id: 'd1', mime_type: 'application/pdf' } }));
    assert.equal(file.attachments[0].kind, 'file');
});

test('normalizeUpdate: التحديث اللي مالوش رسالة بيرجع فاضي', () => {
    assert.deepEqual(normalizeUpdate({ update_id: 3, poll: {} }), []);
    assert.deepEqual(normalizeUpdate(null), []);
});

// ══════════════════ الإرسال ══════════════════

test('splitMessage: بيسيب الرسالة القصيرة زي ما هي', () => {
    assert.deepEqual(splitMessage('قصيرة'), ['قصيرة']);
});

test('splitMessage: بيقسم على الفقرات', () => {
    const text = `${'أ'.repeat(3000)}\n\n${'ب'.repeat(3000)}`;
    const chunks = splitMessage(text);
    assert.equal(chunks.length, 2);
    assert.ok(chunks.every((c) => c.length <= 4096));
});

test('splitMessage: مفيش جزء بيتعدى الحد', () => {
    const chunks = splitMessage('ا'.repeat(20000));
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((c) => c.length <= 4096));
});

test('buildReplyMarkup: بيشيل الكيبورد لما مفيش اختيارات', () => {
    // من غير كده العميل بيفضل شايف أزرار سؤال خلص من زمان.
    assert.equal(buildReplyMarkup([]).reply_markup.remove_keyboard, true);
});

test('buildReplyMarkup: بيبني كيبورد من اختيارات المحرك', () => {
    const markup = buildReplyMarkup([{ label: '[[icon:check]] تم، شكرًا', value: 'تم الحل' }]);
    assert.deepEqual(markup.reply_markup.keyboard, [[{ text: 'تم، شكرًا' }]]);
    assert.equal(markup.reply_markup.one_time_keyboard, true);
});

test('stripIconMarkers: بيشيل علامات الأيقونات', () => {
    assert.equal(stripIconMarkers('[[icon:smile]] أهلاً'), 'أهلاً');
    assert.equal(stripIconMarkers('من غير أيقونة'), 'من غير أيقونة');
});

test('الإرسال: الرد الطويل بيتقسم والكيبورد على آخر جزء بس', async () => {
    const api = fakeTelegramApi();
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: SECRET, api });
    await adapter.send('555', { text: 'ا'.repeat(9000), options: [{ label: 'تم', value: 'تم' }] });

    assert.ok(api.sent.length >= 3);
    const withKeyboard = api.sent.filter((s) => s.options?.reply_markup?.keyboard);
    assert.equal(withKeyboard.length, 1, 'كيبورد واحد بس');
    assert.equal(api.sent[api.sent.length - 1].options.reply_markup.keyboard.length, 1);
});

// ══════════════════ إعادة المحاولة ══════════════════

test('isRetryableStatus: 429 و5xx بس', () => {
    assert.equal(isRetryableStatus(429), true);
    assert.equal(isRetryableStatus(503), true);
    assert.equal(isRetryableStatus(400), false);
    assert.equal(isRetryableStatus(403), false);
});

test('withRetry: بيعيد المحاولة على القابل للإعادة', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
        attempts += 1;
        if (attempts < 3) throw new DeliveryError('boom', { retryable: true });
        return 'done';
    }, { sleep: async () => {}, retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 } });

    assert.equal(result, 'done');
    assert.equal(attempts, 3);
});

test('withRetry: مابيعيدش على 4xx', async () => {
    let attempts = 0;
    await assert.rejects(withRetry(async () => {
        attempts += 1;
        throw new DeliveryError('blocked', { retryable: false, status: 403 });
    }, { sleep: async () => {} }));
    assert.equal(attempts, 1, 'محاولة واحدة بس — الإعادة مش هتنفع');
});

test('withRetry: بيحترم Retry-After بتاع السيرفر', async () => {
    const waits = [];
    let attempts = 0;
    await withRetry(async () => {
        attempts += 1;
        if (attempts === 1) throw new DeliveryError('rate limited', { retryable: true, status: 429, retryAfterMs: 7000 });
        return 'ok';
    }, { sleep: async (ms) => { waits.push(ms); }, retry: { attempts: 2, baseDelayMs: 10, maxDelayMs: 20 } });

    assert.deepEqual(waits, [7000], 'السيرفر أعرف مننا بوقت الرجوع');
});

test('backoffDelay: بيزيد أسّيًا وبيقف عند الحد', () => {
    const config = { baseDelayMs: 100, maxDelayMs: 500 };
    assert.equal(backoffDelay(1, config, () => 1), 100);
    assert.equal(backoffDelay(2, config, () => 1), 200);
    assert.equal(backoffDelay(9, config, () => 1), 500, 'مايعديش الحد الأقصى');
});

test('backoffDelay: العشوائية بتفرّق المحاولات', () => {
    const config = { baseDelayMs: 100, maxDelayMs: 500 };
    assert.equal(backoffDelay(3, config, () => 0), 0);
    assert.equal(backoffDelay(3, config, () => 0.5), 200);
});

test('deduplicator: بيفتكر وبينسى', async () => {
    const dedupe = createMemoryDeduplicator({ max: 2, ttlMs: 60000 });
    assert.equal(await dedupe.seen('a'), false);
    await dedupe.remember('a');
    assert.equal(await dedupe.seen('a'), true);

    await dedupe.remember('b');
    await dedupe.remember('c');
    assert.ok(dedupe.size <= 2, 'محدود الحجم');
});

// ══════════════════ التسجيل ══════════════════

test('redact: بيحجب الأسرار', () => {
    const clean = redact({ bot_token: '123:ABC', chat: 555, nested: { webhookSecret: 's', ok: 1 } });
    assert.equal(clean.bot_token, '[محجوب]');
    assert.equal(clean.nested.webhookSecret, '[محجوب]');
    assert.equal(clean.chat, 555, 'اللي مش سرّي بيعدي');
    assert.equal(clean.nested.ok, 1);
});

test('redact: مابيقعش على العميق أو الدوائر', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'x' } } } } } };
    assert.doesNotThrow(() => redact(deep));
});

test('createLogger: سطر JSON فيه اسم القناة', () => {
    const lines = [];
    const sink = { info: (l) => lines.push(l), warn: () => {}, error: () => {} };
    createLogger('telegram', { sink }).info('حصل حاجة', { token: 'secret-value' });

    assert.ok(lines[0].includes('[channel:telegram]'));
    assert.ok(!lines[0].includes('secret-value'), 'التوكن مايتسجلش أبدًا');
    assert.ok(lines[0].includes('[محجوب]'));
});

// ══════════════════ كود الربط ══════════════════

test('extractLinkCode: بيقرا الكود لوحده ومع /start', () => {
    assert.equal(extractLinkCode('ABCD2345'), 'ABCD2345');
    assert.equal(extractLinkCode('/start ABCD2345'), 'ABCD2345');
    assert.equal(extractLinkCode('abcd2345'), 'ABCD2345');
});

test('extractLinkCode: الرسالة العادية مش كود', () => {
    assert.equal(extractLinkCode('الاشتراك بتاعي منتهي'), null);
    assert.equal(extractLinkCode('ABC'), null, 'قصير');
    assert.equal(extractLinkCode(''), null);
});

test('channelSessionTag: مفتاح ثابت للمحادثة', () => {
    assert.equal(channelSessionTag('telegram', '555'), 'channel:telegram:555');
});

// ══════════════════ المسار الكامل ══════════════════

test('المسار: رسالة سليمة بتوصل للمحرك والرد بيتبعت', async () => {
    const api = fakeTelegramApi();
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: SECRET, api });
    const { deps, calls } = buildDeps({ reply: { text: 'جدّد اشتراكك من المنصة', options: [] } });

    const result = await handleInbound({ adapter, request: telegramRequest(telegramUpdate()), deps });

    assert.equal(result.status, 'ok');
    assert.equal(result.results[0].outcome, 'replied');
    assert.equal(calls.sie.length, 1);
    assert.equal(calls.sie[0].message.text, 'الاشتراك بتاعي منتهي');
    assert.equal(api.sent[0].text, 'جدّد اشتراكك من المنصة');
});

test('المسار: الطلب المزوّر مابيوصلش للمحرك خالص', async () => {
    const api = fakeTelegramApi();
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: SECRET, api });
    const { deps, calls } = buildDeps();

    const result = await handleInbound({ adapter, request: telegramRequest(telegramUpdate(), 'forged'), deps });

    assert.equal(result.status, 'unverified');
    assert.equal(calls.sie.length, 0, 'مفيش أي شغل قبل التحقق');
    assert.equal(api.sent.length, 0);
});

test('المسار: الرسالة المكررة مابتستهلكش رصيد تاني', async () => {
    const api = fakeTelegramApi();
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: SECRET, api });
    const { deps, calls } = buildDeps();
    deps.dedupe = createMemoryDeduplicator();

    await handleInbound({ adapter, request: telegramRequest(telegramUpdate()), deps });
    const second = await handleInbound({ adapter, request: telegramRequest(telegramUpdate()), deps });

    assert.equal(second.results[0].outcome, 'duplicate');
    assert.equal(calls.sie.length, 1, 'المحرك اتنادى مرة واحدة بس');
    assert.equal(api.sent.length, 1);
});

test('المسار: الحساب غير المربوط بياخد شرح مش إجابة', async () => {
    const api = fakeTelegramApi();
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: SECRET, api });
    const { deps, calls } = buildDeps({ linked: false });

    const result = await handleInbound({ adapter, request: telegramRequest(telegramUpdate()), deps });

    assert.equal(result.results[0].outcome, 'not_linked');
    assert.equal(calls.sie.length, 0, 'مستحيل نصرف رصيد حد على مجهول');
    assert.ok(api.sent[0].text.includes('تربط حسابك'));
});

test('المسار: لما المحرك يرفض، العميل بياخد السبب', async () => {
    const api = fakeTelegramApi();
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: SECRET, api });
    const { deps, calls } = buildDeps({ reply: null });

    const result = await handleInbound({ adapter, request: telegramRequest(telegramUpdate()), deps });

    assert.equal(result.results[0].outcome, 'not_handled');
    assert.equal(calls.explained, 1);
    assert.equal(api.sent[0].text, 'اشتراكك خلص', 'مش سكوت');
});

test('المسار: صورة من غير تعليق بترد ردًا صادقًا', async () => {
    const api = fakeTelegramApi();
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: SECRET, api });
    const { deps, calls } = buildDeps();

    const update = telegramUpdate({ text: undefined, photo: [{ file_id: 'p1' }] });
    const result = await handleInbound({ adapter, request: telegramRequest(update), deps });

    assert.equal(result.results[0].outcome, 'unsupported_attachment');
    assert.equal(calls.sie.length, 0);
    assert.equal(api.sent[0].text, CHANNEL_REPLIES.unsupportedAttachment);
});

test('المسار: فشل المحرك مابيرميش العميل في السكوت', async () => {
    const api = fakeTelegramApi();
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: SECRET, api });
    const { deps } = buildDeps({ reply: () => { throw new Error('pipeline exploded'); } });

    const result = await handleInbound({ adapter, request: telegramRequest(telegramUpdate()), deps });

    assert.equal(result.results[0].outcome, 'sie_error');
    assert.equal(api.sent[0].text, CHANNEL_REPLIES.temporaryFailure);
});

test('المسار: فشل الإرسال مابيرميش استثناء برّه', async () => {
    // الرد اتحسب واترصد بالفعل؛ رمي استثناء هنا هيخلّي تيليجرام يعيد
    // الإرسال ويستهلك رصيد تاني على نفس الرسالة.
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: SECRET, api: {
        async sendMessage() { throw new Error('telegram is down'); },
        async sendChatAction() {}
    } });
    const { deps } = buildDeps();

    const result = await handleInbound({ adapter, request: telegramRequest(telegramUpdate()), deps });
    assert.equal(result.status, 'ok');
});

test('المسار: مؤشر الكتابة بيتبعت وفشله مايأثرش', async () => {
    const api = fakeTelegramApi();
    const adapter = createTelegramAdapter({ botToken: 't', secretToken: SECRET, api });
    const { deps } = buildDeps();

    await handleInbound({ adapter, request: telegramRequest(telegramUpdate()), deps });
    assert.deepEqual(api.actions, ['555']);
});

// ══════════════════ باقي القنوات على نفس الواجهة ══════════════════

test('واتساب: بيقرا الرسايل المجمّعة', () => {
    const adapter = createWhatsAppAdapter({ verifySignature: () => true, sendMessage: async () => {} });
    const messages = adapter.parse({
        entry: [{ changes: [{ value: {
            contacts: [{ wa_id: '2010', profile: { name: 'محمود' } }],
            messages: [
                { id: 'm1', from: '2010', timestamp: '1700000000', text: { body: 'أهلاً' } },
                { id: 'm2', from: '2011', timestamp: '1700000001', text: { body: 'مشكلة' } }
            ]
        } }] }]
    });
    assert.equal(messages.length, 2, 'المحوّل بيرجع مصفوفة عشان القنوات اللي بتجمّع');
    assert.equal(messages[0].displayName, 'محمود');
    assert.equal(messages[0].channel, 'whatsapp');
});

test('واتساب: من غير الجسم الخام، التحقق بيفشل مقفول', () => {
    const adapter = createWhatsAppAdapter({ verifySignature: () => true, sendMessage: async () => {}, logger: silentLogger });
    const result = adapter.verify({ headers: { 'x-hub-signature-256': 'sha256=abc' }, body: {} });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'raw_body_unavailable');
});

test('ماسنجر: بيتجاهل صدى رسايلنا', () => {
    // من غير الفحص ده البوت بيرد على نفسه للأبد على حساب العميل.
    const adapter = createMessengerAdapter({ verifySignature: () => true, sendMessage: async () => {} });
    const messages = adapter.parse({
        entry: [{ messaging: [
            { sender: { id: 'u1' }, message: { mid: 'a', text: 'أهلاً' } },
            { sender: { id: 'page' }, message: { mid: 'b', text: 'ردنا', is_echo: true } }
        ] }]
    });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].text, 'أهلاً');
});

test('الموقع: التحقق بيعدي لأن الصفحة نفسها هي اللي بتنادي', () => {
    const adapter = createWebsiteAdapter({ render: async () => {} });
    assert.equal(adapter.verify().ok, true);
});

test('الموقع: بيسلّم الرد للصفحة تعرضه', async () => {
    const rendered = [];
    const adapter = createWebsiteAdapter({ render: async (m) => rendered.push(m) });
    await adapter.send('session-1', { text: 'رد', options: [] });
    assert.equal(rendered[0].text, 'رد');
});

test('الـ API: بيرفض الهيدر الناقص أو المشوّه', () => {
    const adapter = createApiAdapter({ authenticateToken: async () => ({ valid: true }), deliver: async () => {} });
    assert.equal(adapter.verify({ headers: {} }).reason, 'missing_authorization');
    assert.equal(adapter.verify({ headers: { authorization: 'Basic xyz' } }).reason, 'malformed_authorization');
    assert.equal(adapter.verify({ headers: { authorization: 'Bearer abc' } }).ok, true);
});

// ══════════════════ حدود الطبقة ══════════════════

async function readSources(dir) {
    const base = fileURLToPath(new URL(`../${dir}/`, import.meta.url));
    const files = (await readdir(base)).filter((f) => f.endsWith('.js'));
    return Promise.all(files.map(async (f) => [`${dir}/${f}`, await readFile(join(base, f), 'utf8')]));
}

test('core مافيهوش أي اسم قناة معيّنة', async () => {
    // القاعدة اللي بتحافظ على الطبقة: الأساس مايعرفش أي بائع.
    const vendors = ['telegram', 'whatsapp', 'messenger', 'api.telegram.org', 'graph.facebook'];
    for (const [name, source] of await readSources('core')) {
        // CHANNELS نفسها بتعرّف الأسماء، وده مقصود.
        if (name.endsWith('channel-message.js')) continue;
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        for (const vendor of vendors) {
            assert.ok(
                !code.toLowerCase().includes(vendor),
                `${name} بيذكر ${vendor} — ده لازم يفضل جوه محوّل القناة`
            );
        }
    }
});

test('تفاصيل تيليجرام مش موجودة بره مجلد تيليجرام', async () => {
    for (const dir of ['whatsapp', 'messenger', 'website', 'api']) {
        for (const [name, source] of await readSources(dir)) {
            assert.ok(!source.includes('api.telegram.org'), `${name} فيه تفاصيل تيليجرام`);
            assert.ok(!source.includes("from '../telegram/"), `${name} بيستورد من محوّل تاني`);
        }
    }
});

test('مفيش أسرار مكتوبة في الكود', async () => {
    // المتطلب ٩. بنفحص المصدر نفسه بدل ما نثق في المراجعة.
    const patterns = [
        /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/,        // شكل توكن بوت تيليجرام
        /eyJ[A-Za-z0-9_-]{20,}\./                 // JWT
    ];
    for (const dir of ['core', 'telegram', 'whatsapp', 'messenger', 'website', 'api']) {
        for (const [name, source] of await readSources(dir)) {
            for (const pattern of patterns) {
                assert.ok(!pattern.test(source), `${name} فيه سر مكتوب`);
            }
        }
    }
});
