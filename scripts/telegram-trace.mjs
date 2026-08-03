#!/usr/bin/env node
/**
 * telegram-trace.mjs
 * ------------------------------------------------------------
 * بيمشي رسالة تيليجرام على كل مرحلة ويقول وقف فين وليه.
 *
 *   node scripts/telegram-trace.mjs
 *   node scripts/telegram-trace.mjs --chat 123456789 --text "الاشتراك بتاعي منتهي"
 *
 * ------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Every stage between "Telegram called us" and "the customer got a reply"
 * fails the same way from outside: silence. This walks them in order and
 * names the first one that stops, with the file responsible — which is the
 * difference between a five-minute fix and an afternoon in the logs.
 *
 * It runs entirely locally. With SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY set it also checks the real linking and
 * entitlement rows; without them it checks everything that does not need a
 * database and says so.
 *
 * With TELEGRAM_BOT_TOKEN set it additionally asks Telegram whether the
 * webhook is registered and what its last error was.
 */
import { readFile } from 'node:fs/promises';

// SIE's data providers fetch their JSON from file: URLs, which Node's fetch
// does not serve. Deno does, which is why this shim is needed here and not
// in production. See channels/README.md.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input?.href ?? String(input);
    if (href.startsWith('file:')) {
        const body = await readFile(new URL(href), 'utf8');
        return { ok: true, status: 200, async json() { return JSON.parse(body); } };
    }
    return realFetch(input, init);
};

const flags = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) flags[argv[i].replace(/^--/, '')] = argv[i + 1];

const CHAT_ID = flags.chat ?? '123456789';
const TEXT = flags.text ?? 'الاشتراك بتاعي منتهي';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? 'trace-secret';

const stages = [];
function stage(name, ok, detail, file = null) {
    stages.push({ name, ok, detail, file });
}

function report() {
    console.log('\n════════ تتبّع رسالة تيليجرام ════════\n');
    let stopped = null;
    for (const s of stages) {
        const mark = s.ok === true ? '✓' : s.ok === false ? '✗' : '•';
        console.log(`  ${mark} ${s.name}`);
        if (s.detail) console.log(`      ${s.detail}`);
        if (s.ok === false && !stopped) stopped = s;
    }
    console.log();
    if (stopped) {
        console.log(`  توقف عند: ${stopped.name}`);
        if (stopped.file) console.log(`  الملف المسؤول: ${stopped.file}`);
    } else {
        console.log('  المسار كامل سليم محليًا.');
    }
    console.log();
}

// ── 1) هل الويبهوك مسجّل عند تيليجرام أصلاً؟ ───────────────────────
const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
    stage('تسجيل الويبهوك عند تيليجرام', null,
        'TELEGRAM_BOT_TOKEN مش متظبط، فمش قادر أسأل تيليجرام. صدّره وشغّل تاني.');
} else {
    try {
        const response = await realFetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
        const body = await response.json();
        const url = body?.result?.url;
        stage('تسجيل الويبهوك عند تيليجرام', Boolean(url),
            url ? `مسجّل على: ${url}` : 'مفيش ويبهوك مسجّل — تيليجرام مش بيبعتلنا أي حاجة.',
            url ? null : 'scripts/telegram-webhook.mjs set --url ...');
        if (body?.result?.last_error_message) {
            stage('آخر محاولة من تيليجرام', false,
                `${body.result.last_error_message} (${new Date(body.result.last_error_date * 1000).toISOString()})`);
        }
        if (body?.result?.pending_update_count) {
            stage('رسايل متعلّقة عند تيليجرام', false, `${body.result.pending_update_count} رسالة مستنية`);
        }
    } catch (err) {
        stage('تسجيل الويبهوك عند تيليجرام', false, err.message);
    }
}

// ── 2) هل الدالة موجودة؟ (بنسألها هي نفسها) ─────────────────────────
const functionUrl = flags.url ?? (process.env.SUPABASE_URL
    ? `${process.env.SUPABASE_URL}/functions/v1/sie-channel-telegram`
    : null);

if (!functionUrl) {
    stage('الدالة منشورة', null, 'SUPABASE_URL مش متظبط، فمش قادر أفحص النشر.');
} else {
    try {
        const response = await realFetch(functionUrl, { method: 'GET' });
        if (response.status === 404) {
            stage('الدالة منشورة', false, 'الدالة مش موجودة (404) — لسه ماتنشرتش.',
                'supabase functions deploy sie-channel-telegram --no-verify-jwt');
        } else {
            const body = await response.json().catch(() => null);
            stage('الدالة منشورة', true, `ردّت بـ ${response.status}`);
            if (body?.stages) {
                for (const [key, value] of Object.entries(body.stages)) {
                    stage(`  فحص ذاتي: ${key}`, value === true ? true : value === false ? false : null, String(value));
                }
            }
        }
    } catch (err) {
        stage('الدالة منشورة', false, err.message);
    }
}

// ── 3..5) التحقق والتحويل — محليًا، من غير شبكة ────────────────────
const { createTelegramAdapter } = await import('../channels/telegram/telegram-adapter.js');
const adapter = createTelegramAdapter({
    botToken: botToken ?? 'x',
    secretToken: SECRET,
    api: { async sendMessage() {}, async sendChatAction() {} }
});

const update = {
    update_id: 1,
    message: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        from: { id: Number(CHAT_ID), is_bot: false, first_name: 'عميل', language_code: 'ar' },
        chat: { id: Number(CHAT_ID), type: 'private' },
        text: TEXT
    }
};

const verification = adapter.verify({
    headers: { 'x-telegram-bot-api-secret-token': SECRET },
    body: update
});
stage('التحقق من الطلب (request-verify)', verification.ok,
    verification.ok ? 'السر مطابق' : `مرفوض: ${verification.reason}`,
    verification.ok ? null : 'channels/telegram/telegram-verify.js');

const parsed = adapter.parse(update);
stage('التحويل للصيغة القياسية (normalize)', parsed.length === 1,
    parsed.length === 1 ? `«${parsed[0].text}» من ${parsed[0].channelChatId}` : 'الرسالة اتفلترت',
    parsed.length === 1 ? null : 'channels/telegram/telegram-normalize.js');

// ── 6..7) الهوية والرصيد — محتاجين قاعدة البيانات ──────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
    stage('الربط بين المحادثة والحساب (channel-identity)', null,
        'SUPABASE_URL أو SUPABASE_SERVICE_ROLE_KEY مش متظبطين، فمش قادر أفحص الربط.');
    stage('الرصيد (channel-entitlement)', null, 'محتاج نفس المتغيّرات.');
} else {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2').catch(() => ({}));
    if (!createClient) {
        stage('الربط بين المحادثة والحساب (channel-identity)', null, 'مش قادر أحمّل مكتبة Supabase.');
    } else {
        const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

        const { data: identity, error } = await supabase
            .from('channel_identities')
            .select('user_id, is_active')
            .eq('channel', 'telegram')
            .eq('channel_user_id', String(CHAT_ID))
            .maybeSingle();

        if (error) {
            stage('الربط بين المحادثة والحساب (channel-identity)', false, error.message,
                'channels/core/channel-identity.js');
        } else if (!identity) {
            stage('الربط بين المحادثة والحساب (channel-identity)', false,
                `المحادثة ${CHAT_ID} مش مربوطة بأي حساب — العميل هياخد شرح مش إجابة.`,
                'محتاج كود ربط: channel_create_link_code()');
        } else {
            stage('الربط بين المحادثة والحساب (channel-identity)', identity.is_active,
                `مربوطة بالحساب ${identity.user_id}${identity.is_active ? '' : ' (متعطّلة)'}`);

            const { data: access } = await supabase
                .from('customer_sie_access')
                .select('is_enabled, access_mode, messages_used, message_quota, expires_at')
                .eq('user_id', identity.user_id)
                .maybeSingle();

            if (!access) {
                stage('الرصيد (channel-entitlement)', false,
                    'مفيش صف في customer_sie_access — الحساب مش مفعّل على المحرك.');
            } else {
                const ok = access.is_enabled
                    && !(access.access_mode === 'quota' && access.messages_used >= (access.message_quota ?? 0))
                    && !(access.access_mode === 'expiration' && access.expires_at && new Date(access.expires_at) < new Date());
                stage('الرصيد (channel-entitlement)', ok,
                    `${access.access_mode} — مستهلك ${access.messages_used}/${access.message_quota ?? '∞'}`);
            }
        }
    }
}

// ── 8) المحرك نفسه ─────────────────────────────────────────────────
try {
    const { listActiveScenarios } = await import('../sie-integration/sie-runtime.js');
    const scenarios = await listActiveScenarios();
    stage('تحميل بيانات المحرك (sie-client)', scenarios.length > 0,
        `${scenarios.length} حالة اتحمّلت`,
        scenarios.length > 0 ? null : 'sie/scenarios/scenario-catalog.local.js');
} catch (err) {
    stage('تحميل بيانات المحرك (sie-client)', false, err.message,
        'sie/scenarios/scenario-catalog.local.js');
}

report();
