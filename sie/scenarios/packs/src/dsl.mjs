/**
 * dsl.mjs
 * ------------------------------------------------------------
 * The authoring form of a scenario pack. Compiled by scripts/build-packs.mjs
 * into the SAME JSON shape as the core catalog, which is what the engine
 * loads — the engine never imports this file, so packs stay data.
 *
 *   T(canonical, labelAr, labelEn, patterns)            a glossary-layer token
 *   Y(baseCanonical, patterns)                           a SYNONYM: more words for an
 *                                                        existing BASE token (Max vocabulary track)
 *   S(id, intent, category, labelAr, labelEn, sig, answerAr, answerEn, opts)
 *
 * `sig` is "token:weight token:weight …". A null answer makes the scenario a
 * collect-and-hand-off one (opens a ticket unless opts.noTicket).
 * opts.alt = ["token:w token:w", …] adds alternative signatures.
 * opts.q = [Q(...)] adds discriminating questions.
 *
 * @no-legitimate-corpus — authored scenario content, not customer messages.
 */

export function T(canonical, ar, en, patterns) {
    return { canonical, labels: { ar, en }, patterns };
}

/**
 * A synonym entry: words the BASE glossary leaves unresolved that mean an
 * existing base token (colloquial, Arabizi, English, spelling variants).
 * Applied only to unresolved words (normalizer.applyGlossaryLayers), so it
 * can give a meaning to a word Free ignores but can never change the meaning
 * of a word Free understands. The target must exist in the base glossary —
 * the normalizer drops a synonym that points anywhere else, and the audit
 * reports it (synonym_unknown_target).
 */
export function Y(canonical, patterns) {
    return { canonical, synonym: true, labels: { ar: canonical, en: canonical }, patterns };
}

function parseSig(sig) {
    return sig.trim().split(/\s+/).map((pair) => {
        const [token, weight] = pair.split(':');
        const w = Number(weight);
        if (!token || !Number.isFinite(w) || w <= 0) throw new Error(`bad signature entry "${pair}"`);
        return { token, weight: w, source: 'text' };
    });
}

export function S(id, intent, category, labelAr, labelEn, sig, answerAr, answerEn, opts = {}) {
    const auto = typeof answerAr === 'string';
    if (auto && typeof answerEn !== 'string') throw new Error(`${id}: an Arabic answer needs an English one`);
    const scenario = {
        id,
        intent,
        label: { ar: labelAr, en: labelEn },
        category,
        evidenceSignature: parseSig(sig),
        discriminatingQuestions: opts.q || [],
        resolution: auto ? { hasAutoResolution: true, text: { ar: answerAr.trim(), en: answerEn.trim() } } : { hasAutoResolution: false },
        requiresTicketIfUnresolved: auto ? false : opts.noTicket !== true
    };
    if (opts.alt) scenario.alternativeSignatures = opts.alt.map(parseSig);
    if (opts.knowledgeSource) scenario.resolution.knowledgeSource = opts.knowledgeSource;
    return scenario;
}

/** Q(id, promptAr, promptEn, resolves, [[labelAr, labelEn, value, implies], …]) */
export function Q(id, promptAr, promptEn, resolves, options) {
    return {
        id,
        prompt: { ar: promptAr, en: promptEn },
        resolvesEvidence: resolves.split(/\s+/),
        options: options.map(([ar, en, value, implies]) => ({
            label: { ar, en },
            value,
            impliesEvidence: implies ? implies.split(/\s+/) : []
        }))
    };
}
