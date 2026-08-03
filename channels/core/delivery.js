/**
 * delivery.js
 * ------------------------------------------------------------
 * إعادة المحاولة عند فشل إرسال الرسالة.
 *
 * ------------------------------------------------------------
 * WHY RETRIES ARE WORTH THE COMPLEXITY HERE
 *
 * By the time an adapter calls send(), the turn has already cost the
 * customer a message from their quota and the engine has already written
 * the reply to chat_messages. Dropping it on one flaky HTTP call means
 * the customer is charged for an answer they never saw, and the database
 * says they did see it. That is the worst failure this layer can produce,
 * and it is exactly the one a retry prevents.
 *
 * ------------------------------------------------------------
 * WHAT IS AND IS NOT RETRIED
 *
 * Retrying a request the server has already rejected on its merits is
 * pure harm: it delays the inevitable, multiplies load, and on a
 * rate-limited API digs the hole deeper. So:
 *
 *   RETRY      network failures, timeouts, 429, and 5xx — all conditions
 *              where the same request may well succeed shortly.
 *   DO NOT     4xx other than 429 — a malformed request, a blocked bot,
 *              a chat that no longer exists. These fail identically
 *              forever.
 *
 * Backoff is exponential with full jitter. Without jitter, a burst of
 * failures retries in lockstep and re-creates the spike that caused the
 * failure; jitter spreads them. `Retry-After` is honoured when the server
 * sends it, because a server telling you when to come back is better
 * information than any local guess.
 */

/** Defaults tuned for a webhook: a channel usually redelivers after ~60s, so all attempts must fit well inside that. */
export const DEFAULT_RETRY = Object.freeze({
    attempts: 3,
    baseDelayMs: 300,
    maxDelayMs: 5000
});

/**
 * A failure that carries whether retrying could plausibly help.
 *
 * Adapters throw this from their transport so the policy lives in one
 * place instead of each adapter reimplementing "is a 502 worth another
 * go".
 */
export class DeliveryError extends Error {
    /**
     * @param {string} message
     * @param {{retryable?: boolean, status?: number|null, retryAfterMs?: number|null}} [options]
     */
    constructor(message, { retryable = false, status = null, retryAfterMs = null } = {}) {
        super(message);
        this.name = 'DeliveryError';
        this.retryable = retryable;
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}

/**
 * Classifies an HTTP status into "worth another attempt" or not.
 *
 * @param {number} status
 * @returns {boolean}
 */
export function isRetryableStatus(status) {
    if (status === 429) return true;
    return status >= 500 && status <= 599;
}

/**
 * Exponential backoff with full jitter, capped.
 *
 * Full jitter (a uniform draw from [0, window]) rather than a fixed
 * multiple: it is what actually decorrelates concurrent retriers, and the
 * shorter average wait is a bonus rather than the point.
 *
 * @param {number} attempt - 1-based
 * @param {{baseDelayMs: number, maxDelayMs: number}} config
 * @param {() => number} [random] - injectable so tests are deterministic
 * @returns {number}
 */
export function backoffDelay(attempt, config, random = Math.random) {
    const window = Math.min(config.baseDelayMs * 2 ** (attempt - 1), config.maxDelayMs);
    return Math.round(random() * window);
}

/**
 * Runs an operation, retrying only what is worth retrying.
 *
 * @param {() => Promise<*>} operation
 * @param {Object} [options]
 * @param {Object} [options.retry] - overrides for DEFAULT_RETRY
 * @param {Object} [options.logger]
 * @param {string} [options.label] - what is being attempted, for the log line
 * @param {(ms: number) => Promise<void>} [options.sleep] - injectable so tests do not actually wait
 * @param {() => number} [options.random]
 * @returns {Promise<*>}
 */
export async function withRetry(operation, {
    retry = DEFAULT_RETRY,
    logger = null,
    label = 'operation',
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random
} = {}) {
    const config = { ...DEFAULT_RETRY, ...retry };
    let lastError;

    for (let attempt = 1; attempt <= config.attempts; attempt += 1) {
        try {
            return await operation();
        } catch (err) {
            lastError = err;

            const retryable = err instanceof DeliveryError ? err.retryable : false;
            const isLastAttempt = attempt === config.attempts;

            if (!retryable || isLastAttempt) {
                logger?.error(`${label} failed`, {
                    attempt,
                    of: config.attempts,
                    retryable,
                    status: err?.status ?? null,
                    error: err?.message
                });
                throw err;
            }

            // A server-supplied Retry-After beats any local guess.
            const delay = err.retryAfterMs ?? backoffDelay(attempt, config, random);
            logger?.warn(`${label} failed, retrying`, {
                attempt,
                of: config.attempts,
                inMs: delay,
                status: err?.status ?? null,
                error: err?.message
            });
            await sleep(delay);
        }
    }

    throw lastError;
}

/**
 * ذاكرة قصيرة للرسايل اللي اتعالجت، عشان إعادة الإرسال من القناة
 * ماتتعالجش مرتين.
 *
 * In-memory and bounded. An Edge Function instance is short-lived, so
 * this catches the case that actually happens — the channel redelivering
 * within seconds because our reply took too long — without needing a
 * table. A cross-instance guarantee would need shared storage; this is
 * documented as the limit rather than implied to be more.
 *
 * @param {{max?: number, ttlMs?: number}} [options]
 */
export function createMemoryDeduplicator({ max = 500, ttlMs = 10 * 60 * 1000 } = {}) {
    const seen = new Map();

    const prune = () => {
        const cutoff = Date.now() - ttlMs;
        for (const [key, at] of seen) {
            if (at < cutoff) seen.delete(key);
        }
        // Insertion-ordered, so the oldest keys are the first out.
        while (seen.size > max) {
            const oldest = seen.keys().next().value;
            seen.delete(oldest);
        }
    };

    return {
        async seen(key) {
            prune();
            return seen.has(key);
        },
        async remember(key) {
            seen.set(key, Date.now());
            prune();
        },
        get size() {
            return seen.size;
        }
    };
}
