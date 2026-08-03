/**
 * request-verify.js
 * ------------------------------------------------------------
 * أدوات التحقق المشتركة بين كل القنوات.
 *
 * These are generic HTTP and comparison helpers, not the property of any
 * one channel. They live in core because three adapters need them and
 * none of them should import from another adapter's directory — a
 * WhatsApp adapter reaching into telegram/ for a header reader would make
 * Telegram a dependency of WhatsApp, which is exactly the coupling this
 * layer exists to prevent.
 *
 * Each channel's actual verification POLICY stays in that channel's own
 * files: Telegram checks an echoed secret, Meta checks a body signature.
 * Only the primitives are shared.
 */

/**
 * Compares two strings without leaking their contents through timing.
 *
 * A plain `===` on secrets returns as soon as it finds a differing
 * character, so the time it takes reveals how many leading characters
 * were correct. Repeated across requests that is enough to recover a
 * secret one character at a time. This compares every character
 * regardless, so the running time depends only on length.
 *
 * Length is compared first and short-circuits, which is safe: the length
 * of a secret is not the secret.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function constantTimeEquals(a, b) {
    const left = String(a ?? '');
    const right = String(b ?? '');
    if (left.length !== right.length) return false;

    let difference = 0;
    for (let i = 0; i < left.length; i += 1) {
        difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
    }
    return difference === 0;
}

/**
 * Reads a header case-insensitively from either a plain object or a
 * Headers instance.
 *
 * Both shapes genuinely occur: Deno's Request gives a Headers, and tests
 * pass object literals. Handling both here means no adapter has to.
 *
 * @param {Object|Headers} headers
 * @param {string} name
 * @returns {string|null}
 */
export function readHeader(headers, name) {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(name);

    const target = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === target) return value;
    }
    return null;
}
