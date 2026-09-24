/**
 * editions.js
 * ------------------------------------------------------------
 * إصدارات SIE — Free / Pro / Max as PROFILES of one engine.
 *
 * There is one engine. An edition is a small, validated set of limits and
 * capabilities that decides three things and nothing else:
 *
 *   1. WHICH scenarios are in scope — the packs it includes, capped at a
 *      scenario limit. Free = the core catalog; Pro adds the support pack;
 *      Max adds the general pack.
 *   2. WHICH vocabulary layers the language layer applies — the glossary
 *      layers that belong to those packs (see normalizer applyGlossaryLayers).
 *   3. HOW MUCH one customer may spend — message length, retrieval breadth,
 *      and the rate/usage limits enforced in the database.
 *
 * Everything downstream — trust boundary, evidence guard, decision rules,
 * action guard, egress guard — is the same code for every edition. No
 * scenario in any pack gets a path around them: packs are data, and data
 * cannot open a code path.
 *
 * ------------------------------------------------------------
 * TWO KINDS OF NUMBER, KEPT APART
 *
 *   HARD_LIMITS    engineering ceilings. Not settings, not editable from the
 *                  console, not overridable by a database row. They are what
 *                  keeps a mistaken configuration from taking the engine down.
 *   defaults       what an edition gets when nobody has configured it. Every
 *                  admin-editable value is clamped into HARD_LIMITS on read,
 *                  so a bad row degrades to the nearest safe value instead of
 *                  failing a turn.
 */

export const EDITION_IDS = Object.freeze(['free', 'pro', 'max']);

/** Packs are cumulative: each edition contains every pack of the one below. */
export const EDITION_PACKS = Object.freeze({
    free: Object.freeze(['core']),
    pro: Object.freeze(['core', 'pro']),
    max: Object.freeze(['core', 'pro', 'max'])
});

export const EDITION_LABELS = Object.freeze({
    free: { ar: 'SIE المجاني', en: 'SIE Free' },
    pro: { ar: 'SIE برو', en: 'SIE Pro' },
    max: { ar: 'SIE ماكس', en: 'SIE Max' }
});

/**
 * The product ceilings: the most scenarios an edition may ever carry.
 * The ACTUAL count is whatever distinct scenarios its packs hold, which may
 * be lower — the core holds 635 after the 2026-09 audit merged 15 duplicates.
 */
export const EDITION_SCENARIO_CEILINGS = Object.freeze({ free: 650, pro: 1000, max: 1500 });

/**
 * Engineering limits. The console cannot move these; the resolver clamps
 * every configured value into them.
 */
export const HARD_LIMITS = Object.freeze({
    /** Same constant normalize() enforces; a profile may only lower it. */
    maxMessageChars: Object.freeze({ min: 200, max: 8000 }),
    /** Candidates kept after exact scoring. Below 10 the ticket trail and the
     *  alternatives list lose entries the decision engine reads. */
    retrievalMaxCandidates: Object.freeze({ min: 10, max: 200 }),
    /** Distinct evidence tokens scored per turn. The trust layer's flood
     *  sensor fires at 18 on legitimate traffic's ceiling; 64 is far above
     *  any real message and far below anything that costs CPU. */
    maxEvidenceTokensPerTurn: Object.freeze({ min: 16, max: 64 }),
    rateLimitPerMinute: Object.freeze({ min: 10, max: 5000 }),
    rateLimitBurst: Object.freeze({ min: 0, max: 500 }),
    /** 0 = no monthly cap from the edition (the customer's own quota still applies). */
    monthlyMessages: Object.freeze({ min: 0, max: 1000000 }),
    /** Floor for a scenario limit: an edition configured below this is a
     *  mistake, not a product decision — a catalog that small answers
     *  almost nothing, and the fall-through is ticket spam. */
    minScenarios: 100
});

/**
 * Defaults. Free reproduces today's engine exactly: every scenario the core
 * holds, the same 8,000-character bound normalize() has always applied, and
 * no edition-level usage caps (the customer's own quota and the global rate
 * limit keep applying as before).
 */
export const EDITION_DEFAULTS = Object.freeze({
    free: Object.freeze({ maxScenarios: 650, maxMessageChars: 8000, retrievalMaxCandidates: 60, maxEvidenceTokensPerTurn: 64, rateLimitPerMinute: null, rateLimitBurst: null, monthlyMessages: 0 }),
    pro: Object.freeze({ maxScenarios: 1000, maxMessageChars: 8000, retrievalMaxCandidates: 80, maxEvidenceTokensPerTurn: 64, rateLimitPerMinute: null, rateLimitBurst: null, monthlyMessages: 0 }),
    max: Object.freeze({ maxScenarios: 1500, maxMessageChars: 8000, retrievalMaxCandidates: 100, maxEvidenceTokensPerTurn: 64, rateLimitPerMinute: null, rateLimitBurst: null, monthlyMessages: 0 })
});

/** Setting keys, one per edition per knob: `edition_<id>_<knob>`. */
export const EDITION_KNOBS = Object.freeze([
    'maxScenarios', 'maxMessageChars', 'retrievalMaxCandidates', 'maxEvidenceTokensPerTurn',
    'rateLimitPerMinute', 'rateLimitBurst', 'monthlyMessages'
]);

const SNAKE = { maxScenarios: 'max_scenarios', maxMessageChars: 'max_message_chars', retrievalMaxCandidates: 'retrieval_max_candidates', maxEvidenceTokensPerTurn: 'max_evidence_tokens', rateLimitPerMinute: 'rate_limit_per_minute', rateLimitBurst: 'rate_limit_burst', monthlyMessages: 'monthly_messages' };

export function editionSettingKey(edition, knob) {
    return `edition_${edition}_${SNAKE[knob]}`;
}

/** An unknown or missing edition is Free: the safe, smallest profile. */
export function normalizeEdition(value) {
    return EDITION_IDS.includes(value) ? value : 'free';
}

function clampInt(value, { min, max }, fallback) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(Math.round(n), min), max);
}

/**
 * The effective profile for an edition, from settings (possibly stored,
 * possibly malformed) and the pack sizes actually available.
 *
 * Never throws. Every value is clamped:
 *   maxScenarios        into [minScenarios, the edition's ceiling], and never
 *                       below the next-lower edition's effective limit — a Pro
 *                       customer is never offered less than Free
 *   everything else     into HARD_LIMITS
 *
 * @param {string} edition
 * @param {Object} [settings]   merged SIE settings (edition_* keys optional)
 * @returns {Object} frozen profile
 */
export function resolveEditionProfile(edition, settings = {}) {
    const id = normalizeEdition(edition);
    const read = (ed, knob) => {
        const stored = settings?.[editionSettingKey(ed, knob)];
        return stored === undefined || stored === null ? EDITION_DEFAULTS[ed][knob] : stored;
    };
    const scenarioLimit = (ed) => clampInt(read(ed, 'maxScenarios'),
        { min: HARD_LIMITS.minScenarios, max: EDITION_SCENARIO_CEILINGS[ed] },
        EDITION_DEFAULTS[ed].maxScenarios);

    // Monotone across editions: each is at least the one below it.
    let floor = 0;
    let maxScenarios = 0;
    for (const ed of EDITION_IDS) {
        maxScenarios = Math.max(scenarioLimit(ed), floor);
        floor = maxScenarios;
        if (ed === id) break;
    }

    // The edition's own rate: 0 (the stored "inherit") or null means the
    // global rate-limit settings apply, and then so does the global burst —
    // an edition burst without an edition rate would be a number with no
    // bucket to size.
    const rpmRaw = read(id, 'rateLimitPerMinute');
    const rateLimitPerMinute = rpmRaw === null || Number(rpmRaw) === 0 || !Number.isFinite(Number(rpmRaw))
        ? null : clampInt(rpmRaw, HARD_LIMITS.rateLimitPerMinute, null);
    const burstRaw = read(id, 'rateLimitBurst');
    const rateLimitBurst = rateLimitPerMinute === null || burstRaw === null
        ? null : clampInt(burstRaw, HARD_LIMITS.rateLimitBurst, null);

    return Object.freeze({
        edition: id,
        packs: EDITION_PACKS[id],
        maxScenarios,
        maxMessageChars: clampInt(read(id, 'maxMessageChars'), HARD_LIMITS.maxMessageChars, 8000),
        retrievalMaxCandidates: clampInt(read(id, 'retrievalMaxCandidates'), HARD_LIMITS.retrievalMaxCandidates, 60),
        maxEvidenceTokensPerTurn: clampInt(read(id, 'maxEvidenceTokensPerTurn'), HARD_LIMITS.maxEvidenceTokensPerTurn, 64),
        rateLimitPerMinute,
        rateLimitBurst,
        monthlyMessages: clampInt(read(id, 'monthlyMessages'), HARD_LIMITS.monthlyMessages, 0)
    });
}

/**
 * The sie_settings keys that belong to editions — `default_edition` and
 * `edition_<id>_<knob>`. Only the platform owner may write them (migration
 * 0010's guard uses the same pattern: sie_is_edition_setting_key).
 */
export function isEditionSettingKey(key) {
    return key === 'default_edition' || /^edition_(free|pro|max)_[a-z_]+$/.test(String(key ?? ''));
}

/** Setting key of an edition's on/off switch. Free has none: it cannot be switched off. */
export function editionEnabledKey(edition) {
    return `edition_${edition}_enabled`;
}

/**
 * Is an edition available to customers? Free always is. Pro/Max are unless
 * switched off — and anything other than `true` or "not set" counts as off,
 * so a malformed row fails closed. Mirrors sie_edition_available() (0010).
 */
export function isEditionAvailable(edition, settings = {}) {
    if (edition === 'free') return true;
    if (!EDITION_IDS.includes(edition)) return false;
    const v = settings?.[editionEnabledKey(edition)];
    return v === undefined || v === null || v === true;
}

/**
 * Which edition a customer is on. Their own row wins; then the configured
 * default; then Free. A value that is not a real edition id falls to Free —
 * never to a larger edition — so a corrupted row can only ever LOSE scope.
 * An edition that is switched off is Free at either step (never "the next
 * one down"). Mirrors sie_effective_edition() (0010).
 */
export function resolveCustomerEdition({ accessRow = null, settings = {} } = {}) {
    const own = accessRow?.edition ?? accessRow?.metadata?.edition;
    if (EDITION_IDS.includes(own)) return isEditionAvailable(own, settings) ? own : 'free';
    const fallback = normalizeEdition(settings?.default_edition);
    return isEditionAvailable(fallback, settings) ? fallback : 'free';
}
