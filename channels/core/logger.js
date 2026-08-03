/**
 * logger.js
 * ------------------------------------------------------------
 * تسجيل منظّم لكل قناة.
 *
 * Structured rather than free text because these lines are read in
 * Supabase's log viewer, where a message you can filter by channel and
 * chat id is the difference between finding one customer's broken
 * conversation and scrolling. Every line carries the channel name, so a
 * Telegram problem never has to be distinguished from a WhatsApp one by
 * guessing.
 *
 * NEVER LOG: bot tokens, webhook secrets, service-role keys, or the full
 * text of a customer's message. The first three are credentials; the last
 * is the customer's data, and support logs are not the place for it.
 * redact() below is applied to every payload as a backstop, but the real
 * defence is not passing them in.
 */

const SENSITIVE_KEYS = [
    'token', 'bot_token', 'botToken', 'secret', 'webhook_secret', 'webhookSecret',
    'authorization', 'apikey', 'api_key', 'apiKey', 'password', 'service_role',
    'serviceRoleKey', 'jwt', 'access_token', 'refresh_token'
];

/**
 * Replaces anything that looks like a credential with a marker.
 *
 * Matches on the key name rather than the value's shape: a token is only
 * recognisable by where it sits, and a value-based heuristic would either
 * miss short tokens or redact innocent text.
 *
 * @param {*} value
 * @param {number} [depth]
 * @returns {*}
 */
export function redact(value, depth = 0) {
    if (depth > 4 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

    const out = {};
    for (const [key, val] of Object.entries(value)) {
        const isSensitive = SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s.toLowerCase()));
        out[key] = isSensitive ? '[محجوب]' : redact(val, depth + 1);
    }
    return out;
}

/**
 * @param {string} channel
 * @param {{sink?: Object}} [options] - inject a sink in tests instead of spying on console
 * @returns {{info: Function, warn: Function, error: Function}}
 */
export function createLogger(channel, { sink = console } = {}) {
    const emit = (level, message, payload) => {
        const line = { channel, level, message, ...(payload ? { data: redact(payload) } : {}) };
        const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
        // One JSON object per line: greppable, and parseable by a log
        // pipeline later without changing any call site.
        sink[method](`[channel:${channel}] ${JSON.stringify(line)}`);
    };

    return {
        info: (message, payload) => emit('info', message, payload),
        warn: (message, payload) => emit('warn', message, payload),
        error: (message, payload) => emit('error', message, payload)
    };
}
