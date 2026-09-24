/**
 * pack-guard.js
 * ------------------------------------------------------------
 * حارس الحزم — what a pack file is allowed to contain, checked when it is
 * loaded, before anything in it reaches the engine.
 *
 * WHY A PACK NEEDS ITS OWN GUARD
 * Pack answers are AUTHORED content: the egress guard deliberately leaves
 * authored text untouched (it neutralises user-derived spans only), and the
 * Telegram channel renders replies as Markdown. So whoever can change a pack
 * file speaks in the brand's voice. Packs ship as JSON from a pinned commit,
 * which makes tampering a supply-chain event rather than a customer action —
 * but the engine should not have to trust the file to stay safe. This guard
 * makes a tampered or malformed pack degrade to "that item is skipped", never
 * to "the engine sends a phishing link" or "one turn scores 10,000 tokens".
 *
 * THREE KINDS OF CHECK
 *   structure   ids and token names are plain identifiers; weights positive
 *               and bounded; signatures, alternatives, questions and options
 *               bounded in count (a 10,000-token signature is a CPU attack)
 *   size        answers, labels and patterns bounded in length
 *   content     answer text carries no links, no markup, no instruction to
 *               hand over a credential (lintAnswerText — also run over the
 *               core in CI, sie/editions/tests/pack-security.test.mjs)
 *
 * Every check returns reasons instead of throwing; the loader skips the item
 * and records a warning, so one bad entry never takes an edition down.
 */

export const PACK_LIMITS = Object.freeze({
    idPattern: /^[a-z0-9_]{3,80}$/,
    tokenPattern: /^[a-z0-9_]{2,64}$/,
    maxSignatureTokens: 6,
    maxWeight: 1000,
    maxAlternatives: 6,
    maxQuestions: 5,
    maxOptions: 8,
    maxAnswerChars: 3000,
    maxLabelChars: 160,
    maxPatterns: 40,
    maxPatternChars: 60,
    maxPatternWords: 5
});

/** Hosts an answer may name in plain text. Anything else is refused. */
const ALLOWED_HOSTS = /^(?:[a-z0-9-]+\.)*mad3oom\.(?:com|online)$/i;

const ICONS = /\[\[icon:[a-z_]+\]\]/g;

/**
 * Content rules for any authored answer text.
 * @param {string} text
 * @returns {string[]} reasons (empty = acceptable)
 */
export function lintAnswerText(text) {
    const reasons = [];
    const t = String(text ?? '').replace(ICONS, '');
    if (/\[[^\]]*\]\([^)]*\)/.test(t)) reasons.push('markdown link');
    // Real tag names only: «<token>» and «<number>» are placeholders in
    // authored help text, not markup.
    if (/<\s*\/?\s*(?:a|script|img|iframe|div|span|br|p|style|form|input|svg|link|meta|object|embed|button|body|html)\b[^>]*>/i.test(t)) reasons.push('html tag');
    for (const m of t.matchAll(/\b(?:https?:\/\/|www\.)([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
        const host = m[1].replace(/^www\./i, '').toLowerCase();
        if (!ALLOWED_HOSTS.test(host)) reasons.push(`link to ${host}`);
    }
    // Bare domains ("evil.example/login") outside the allow-list.
    for (const m of t.matchAll(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|app|xyz|online|site|info|me|co))\b/gi)) {
        const host = m[1].toLowerCase();
        if (!ALLOWED_HOSTS.test(host)) reasons.push(`domain ${host}`);
    }
    // Asking the customer to hand over a secret. «ماتبعتش كلمة المرور» is the
    // safe instruction and must not match; «ابعتلي كلمة المرور» must.
    // Secrets only — «قولي الكود» about a COUPON code is a legitimate ask.
    if (/(?:^|[\s،.])(?:ابعتلي|ابعت لي|اكتبلي|اكتب لي|قولي|قولّي)\s+(?:كلمة المرور|كلمة السر|الباسورد|رمز التحقق|كود التحقق|رمز الاستعادة|رقم الكارت|الرقم السري)/.test(t)) {
        reasons.push('asks for a credential');
    }
    if (/\b(?:send|tell|give)\s+me\s+(?:your\s+)?(?:password|otp|verification code|2fa code|card number|secret)\b/i.test(t)) {
        reasons.push('asks for a credential (en)');
    }
    return reasons;
}

function signatureReasons(sig, where) {
    const out = [];
    if (!Array.isArray(sig) || sig.length === 0) return [`${where}: empty`];
    if (sig.length > PACK_LIMITS.maxSignatureTokens) out.push(`${where}: ${sig.length} tokens > ${PACK_LIMITS.maxSignatureTokens}`);
    for (const e of sig) {
        if (!PACK_LIMITS.tokenPattern.test(String(e?.token ?? ''))) out.push(`${where}: bad token name`);
        const w = e?.weight;
        if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0 || w > PACK_LIMITS.maxWeight) out.push(`${where}: bad weight`);
    }
    return out;
}

/**
 * @param {Object} s   one pack scenario (already shaped like a catalog entry)
 * @returns {string[]} reasons it must be skipped
 */
export function checkPackScenario(s) {
    const r = [];
    if (!s || typeof s !== 'object') return ['not an object'];
    if (!PACK_LIMITS.idPattern.test(String(s.id ?? ''))) r.push('bad id');
    for (const lang of ['ar', 'en']) {
        if (String(s.label?.[lang] ?? '').length > PACK_LIMITS.maxLabelChars) r.push(`label.${lang} too long`);
    }
    r.push(...signatureReasons(s.evidenceSignature, 'signature'));
    const alts = s.alternativeSignatures || [];
    if (!Array.isArray(alts) || alts.length > PACK_LIMITS.maxAlternatives) r.push('too many alternative signatures');
    else alts.forEach((a, i) => r.push(...signatureReasons(a, `alternative ${i}`)));
    const qs = s.discriminatingQuestions || [];
    if (!Array.isArray(qs) || qs.length > PACK_LIMITS.maxQuestions) r.push('too many questions');
    else for (const q of qs) if ((q?.options || []).length > PACK_LIMITS.maxOptions) r.push('too many options');
    const text = s.resolution?.text;
    for (const lang of ['ar', 'en']) {
        const t = text?.[lang];
        if (t == null) continue;
        if (String(t).length > PACK_LIMITS.maxAnswerChars) r.push(`answer.${lang} too long`);
        for (const why of lintAnswerText(t)) r.push(`answer.${lang}: ${why}`);
    }
    return r;
}

/**
 * @param {Object} e   one glossary-layer entry
 * @returns {string[]}
 */
export function checkPackGlossaryEntry(e) {
    const r = [];
    if (!PACK_LIMITS.tokenPattern.test(String(e?.canonical ?? ''))) r.push('bad canonical');
    const pats = e?.patterns;
    if (!Array.isArray(pats) || pats.length === 0) r.push('no patterns');
    else {
        if (pats.length > PACK_LIMITS.maxPatterns) r.push('too many patterns');
        for (const p of pats) {
            const s = String(p ?? '');
            if (!s.trim() || s.length > PACK_LIMITS.maxPatternChars || s.trim().split(/\s+/).length > PACK_LIMITS.maxPatternWords) {
                r.push('bad pattern');
                break;
            }
        }
    }
    return r;
}
