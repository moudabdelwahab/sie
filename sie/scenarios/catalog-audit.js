/**
 * catalog-audit.js
 * ------------------------------------------------------------
 * تدقيق الكتالوج — does every scenario add something the catalog did not
 * already have?
 *
 * Pure: no I/O, no clock, no randomness. Takes the catalog (and optionally the
 * glossary that feeds it) and returns findings. Used three ways:
 *
 *   1. `catalog-uniqueness.test.mjs` — the CI gate that makes adding a
 *      duplicate scenario fail the build.
 *   2. `scripts/catalog-audit.mjs` — the human-readable inventory and report.
 *   3. `bench/` — reachability and ambiguity per edition.
 *
 * ------------------------------------------------------------
 * WHY THE CORE CHECK IS EXACT, NOT SAMPLED
 *
 * A scenario's confidence is
 *
 *     conf(s, M) = Σ_{t ∈ sig(s) ∩ M} w(s,t)  /  Σ_{t ∈ sig(s)} w(s,t)
 *
 * for a message M, taking every present token at the same presence. Two facts
 * follow, and together they make "can this scenario ever win?" decidable
 * without generating a single probe sentence:
 *
 *   (a) A token outside sig(s) never raises conf(s). It can only raise a
 *       COMPETITOR. So the best case for s is a message whose tokens are a
 *       subset of sig(s).
 *   (b) sig(s) has at most a handful of tokens (≤ 5 enforced below), so its
 *       non-empty subsets number at most 31.
 *
 * So s is reachable IF AND ONLY IF some non-empty T ⊆ sig(s) makes s the
 * unique top scorer over the WHOLE catalog. That is checked exhaustively
 * here, against every competitor, using the same inverted index production
 * retrieval uses. A scenario that fails it is dead: no customer message, in
 * any wording, can make the engine choose it — the only way it is ever
 * "chosen" is the alphabetical tie-break, which is not a choice.
 *
 * Presence is taken as uniform because a uniform presence scales every
 * scenario's confidence by the same factor and cannot change an ordering.
 *
 * The same enumeration answers the stronger question the decision engine
 * actually asks: is there a message on which s is not just top, but
 * ANSWERABLE — confidence at or above the answer threshold, and far enough
 * ahead of the runner-up that R6_AMBIGUOUS does not fire?
 *
 * ------------------------------------------------------------
 * WHAT THE EXACT CHECK CANNOT SEE, AND WHAT COVERS IT
 *
 * Two scenarios built on DIFFERENT tokens that MEAN the same thing — e.g. a
 * "trial extension" scenario under `entity_trial` and another under a
 * `social_trial_extension` token — are distinct to the engine and duplicates
 * to a customer. No arithmetic on signatures finds that. The semantic pass
 * below scores every pair on four independent signals (label, English label,
 * answer text, and the vocabulary behind their tokens), and a pair above the
 * bar must be either redesigned or explicitly justified in the reviewed
 * allowlist. The test fails on any flagged pair that is not.
 */
import { normalizeArabicToken } from '../language/dialect-normalizer.js';
import { rankHypotheses } from '../ranking/ranking-engine.js';
import { computeScenarioConfidence } from '../diagnostics/hypothesis-tracker.js';
import { scenarioSignatures } from './scenario-types.js';

/** Mirrors the engine's defaults. Exported so tests can assert they match. */
export const AUDIT_DEFAULTS = Object.freeze({
    answerThreshold: 0.6,      // settings.answer_confidence default
    ambiguityMargin: 0.1,      // ranking-engine AMBIGUITY_MARGIN
    activationThreshold: 0.15, // hypothesis-tracker ACTIVATION_THRESHOLD
    maxSignatureTokens: 5
});

// ------------------------------------------------------------
// Signatures
// ------------------------------------------------------------

/** token -> normalized weight (sums to 1). Duplicate tokens are merged. */
export function normalizedSignature(scenarioOrSignature) {
    const signature = Array.isArray(scenarioOrSignature) ? scenarioOrSignature : (scenarioOrSignature.evidenceSignature || []);
    const out = new Map();
    let total = 0;
    for (const e of signature) {
        if (!e || typeof e.token !== 'string') continue;
        const w = typeof e.weight === 'number' && e.weight > 0 ? e.weight : 0;
        out.set(e.token, (out.get(e.token) || 0) + w);
        total += w;
    }
    if (total > 0) for (const [t, w] of out) out.set(t, w / total);
    return out;
}

function primaryToken(scenario) {
    let best = null;
    for (const e of scenario.evidenceSignature || []) {
        if (!best || e.weight > best.weight) best = e;
    }
    return best ? best.token : null;
}

function buildIndex(catalog) {
    // One normalized vector per signature ("row"); postings map a token to
    // the rows using it. Rows of one scenario share its index in `rowOf`.
    const rows = [];
    const rowOf = [];
    catalog.forEach((scenario, i) => {
        for (const signature of scenarioSignatures(scenario)) {
            rows.push(normalizedSignature(signature));
            rowOf.push(i);
        }
    });
    const postings = new Map();
    rows.forEach((sig, r) => {
        for (const [t, w] of sig) {
            if (!postings.has(t)) postings.set(t, []);
            postings.get(t).push([r, w]);
        }
    });
    const rowsOfScenario = catalog.map(() => []);
    rowOf.forEach((i, r) => rowsOfScenario[i].push(r));
    return { rows, rowOf, rowsOfScenario, postings };
}

/** Non-empty subsets of an array, smallest first. */
function subsets(items) {
    const out = [];
    const n = items.length;
    for (let mask = 1; mask < (1 << n); mask++) {
        const s = [];
        for (let b = 0; b < n; b++) if (mask & (1 << b)) s.push(items[b]);
        out.push(s);
    }
    return out.sort((a, b) => a.length - b.length);
}

// ------------------------------------------------------------
// 1. Exact reachability
// ------------------------------------------------------------

/**
 * For every scenario: the best outcome any message can produce for it.
 *
 *   decisive     some message makes it top, ≥ answerThreshold, and clear of
 *                the runner-up by the ambiguity margin — the engine answers it
 *   ambiguous    it can be top, but never clear of a competitor — the engine
 *                can only ever ask a question or hand off when it is meant
 *   weak         it can be top and clear, but never reaches the answer
 *                threshold on its own words
 *   tied         never strictly top; it only ever ties (tie-break decides)
 *   shadowed     some other scenario always scores strictly higher
 *
 * `rivals` names the competitors that block the best subset, which is what
 * someone fixing the finding actually needs.
 */
export function analyzeReachability(catalog, options = {}) {
    const opts = { ...AUDIT_DEFAULTS, ...options };
    const { rows, rowOf, rowsOfScenario, postings } = buildIndex(catalog);
    const RANK = { decisive: 4, weak: 3, ambiguous: 2, tied: 1, shadowed: 0 };
    const results = [];

    for (let i = 0; i < catalog.length; i++) {
        let best = null;
        // Every signature of the scenario is an independent way in: the
        // scenario is reachable if ANY subset of ANY of its signatures wins.
        for (const r of rowsOfScenario[i]) {
            for (const subset of subsets([...rows[r].keys()])) {
                const presences = new Map(subset.map((t) => [t, 1]));
                // Touched scenarios, then scored with the ENGINE'S scorer and
                // ranked by the ENGINE'S ranking. The audit must not carry its
                // own copy of either: a copy is a second implementation, and
                // the day they drift the audit certifies behaviour the engine
                // does not have.
                const touched = new Set();
                for (const t of subset) for (const [row] of postings.get(t) || []) touched.add(rowOf[row]);
                const hypotheses = [...touched].map((j) => {
                    const scored = computeScenarioConfidence(catalog[j], presences);
                    return {
                        scenarioId: catalog[j].id,
                        confidence: scored.confidence,
                        supportingEvidenceTokens: scored.supportingEvidenceTokens,
                        missingEvidenceTokens: scored.missingEvidenceTokens
                    };
                });
                const ranking = rankHypotheses(hypotheses, catalog, {
                    activationThreshold: opts.activationThreshold,
                    specificity: opts.specificity !== false
                });
                const own = hypotheses.find((h) => h.scenarioId === catalog[i].id)?.confidence || 0;
                const topId = ranking.topHypothesis?.hypothesis.scenarioId;
                const rival = ranking.rival?.hypothesis;
                let outcome;
                if (topId !== catalog[i].id) {
                    const topConf = ranking.topHypothesis?.hypothesis.confidence ?? 0;
                    outcome = Math.abs(topConf - own) <= 1e-12 ? 'tied' : 'shadowed';
                } else if (rival && Math.abs(rival.confidence - own) <= 1e-12) {
                    outcome = 'tied';
                } else if (ranking.isAmbiguous) {
                    outcome = 'ambiguous';
                } else if (own < opts.answerThreshold - 1e-12) {
                    outcome = 'weak';
                } else {
                    outcome = 'decisive';
                }
                const blockers = topId !== catalog[i].id ? [topId] : (rival ? [rival.scenarioId] : []);
                const candidate = {
                    outcome,
                    subset,
                    confidence: own,
                    runnerUp: rival ? rival.confidence : 0,
                    rivals: blockers.filter(Boolean)
                };
                if (!best || RANK[outcome] > RANK[best.outcome] ||
                    (RANK[outcome] === RANK[best.outcome] && own - candidate.runnerUp > best.confidence - best.runnerUp)) {
                    best = candidate;
                }
                if (best.outcome === 'decisive') break;
            }
            if (best?.outcome === 'decisive') break;
        }
        results.push({ id: catalog[i].id, ...(best || { outcome: 'shadowed', subset: [], confidence: 0, runnerUp: 0, rivals: [] }) });
    }
    const counts = { decisive: 0, weak: 0, ambiguous: 0, tied: 0, shadowed: 0 };
    for (const r of results) counts[r.outcome] += 1;
    return { results, counts };
}

// ------------------------------------------------------------
// 2. Structural duplicates
// ------------------------------------------------------------

/**
 * Pairs the engine can never tell apart, plus pairs whose signatures are so
 * close that one is a reweighting of the other.
 *
 *   identical_vector   same normalized weights on the same tokens. They tie
 *                      on EVERY message — a proof, not a heuristic: with
 *                      linear scores and equal vectors the difference is 0
 *                      for all inputs.
 *   same_token_set     same tokens, different weights — distinguishable only
 *                      by which of the shared words the customer happens to use
 *   near_signature     cosine ≥ 0.9 on normalized weights
 */
export function findStructuralDuplicates(catalog, { cosineBar = 0.9 } = {}) {
    const { rows, rowOf, postings } = buildIndex(catalog);
    const best = new Map(); // "i:j" -> strongest finding between any two of their signatures
    const STRENGTH = { identical_vector: 3, same_token_set: 2, near_signature: 1 };
    for (let r = 0; r < rows.length; r++) {
        const partners = new Set();
        for (const t of rows[r].keys()) for (const [q] of postings.get(t)) if (rowOf[q] > rowOf[r]) partners.add(q);
        for (const q of partners) {
            const a = rows[r];
            const b = rows[q];
            const sameSet = a.size === b.size && [...a.keys()].every((t) => b.has(t));
            let dot = 0; let na = 0; let nb = 0;
            for (const [t, w] of a) { na += w * w; if (b.has(t)) dot += w * b.get(t); }
            for (const w of b.values()) nb += w * w;
            const cosine = dot / Math.sqrt(na * nb);
            const identical = sameSet && [...a].every(([t, w]) => Math.abs(w - b.get(t)) < 1e-9);
            let kind = null;
            if (identical) kind = 'identical_vector';
            else if (sameSet) kind = 'same_token_set';
            else if (cosine >= cosineBar) kind = 'near_signature';
            if (!kind) continue;
            const key = `${rowOf[r]}:${rowOf[q]}`;
            const prior = best.get(key);
            if (!prior || STRENGTH[kind] > STRENGTH[prior.kind]) {
                best.set(key, { kind, a: catalog[rowOf[r]].id, b: catalog[rowOf[q]].id, cosine: round(cosine) });
            }
        }
    }
    return [...best.values()];
}

// ------------------------------------------------------------
// 3. Semantic duplicates
// ------------------------------------------------------------

function trigrams(text) {
    const s = ` ${text} `;
    const out = new Set();
    for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
    return out;
}
function jaccard(a, b) {
    if (a.size === 0 && b.size === 0) return 0;
    let inter = 0;
    const [small, big] = a.size < b.size ? [a, b] : [b, a];
    for (const x of small) if (big.has(x)) inter += 1;
    return inter / (a.size + b.size - inter);
}
function normAr(text) {
    return normalizeArabicToken(String(text || '').replace(/\[\[icon:[a-z_]+\]\]/g, ' '))
        .split(' ')
        // Strip the definite article so «التذكرة» and «تذكرة» compare equal.
        .map((w) => (w.startsWith('ال') && w.length > 4 ? w.slice(2) : w))
        .join(' ');
}
function normEn(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2);
}

/**
 * Scores every pair that shares a token OR a label word on four independent
 * signals, each in [0, 1]:
 *
 *   label     Arabic label, character trigrams after dialect normalization
 *   labelEn   English label, word overlap
 *   answer    resolution text (Arabic), character trigrams
 *   lexicon   the glossary vocabulary behind each scenario's tokens — two
 *             scenarios whose tokens are triggered by the same words are
 *             reached by the same messages even if the tokens differ
 *
 * `score` is the mean of the signals that exist for both. A pair is flagged
 * when score ≥ bar, or when two strong signals agree (label ≥ 0.6 and one of
 * answer/lexicon ≥ 0.5), which catches the "same case, different words"
 * duplicate a single averaged number dilutes.
 */
export function findSemanticNearDuplicates(catalog, { glossary = null, bar = 0.55 } = {}) {
    const patternWords = new Map();
    if (glossary) {
        for (const entry of glossary) {
            const words = new Set();
            for (const p of entry.patterns || []) for (const w of normAr(p).split(' ')) if (w.length > 2) words.add(w);
            patternWords.set(entry.canonical, words);
        }
    }
    const prepared = catalog.map((s) => {
        const lex = new Set();
        const primary = primaryToken(s);
        // The primary token carries the scenario's identity; context tokens
        // (entity_whatsapp, intent_how_to, ...) are shared by design and
        // would make every scenario in a family look alike.
        for (const w of patternWords.get(primary) || []) lex.add(w);
        return {
            id: s.id,
            primary,
            label: trigrams(normAr(s.label?.ar)),
            labelWords: new Set(normAr(s.label?.ar).split(' ').filter((w) => w.length > 2)),
            labelEn: new Set(normEn(s.label?.en)),
            answer: s.resolution?.text?.ar ? trigrams(normAr(s.resolution.text.ar)) : null,
            lex
        };
    });

    // Candidate pairs: share a signature token, or share a label word. Pairs
    // that share neither cannot be confused by anyone, and skipping them keeps
    // this near-linear at 1,500.
    const byKey = new Map();
    const add = (k, i) => { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(i); };
    catalog.forEach((s, i) => {
        add(`p:${prepared[i].primary}`, i);
        for (const w of prepared[i].labelWords) add(`w:${w}`, i);
        for (const w of prepared[i].lex) add(`x:${w}`, i);
    });
    const pairs = new Set();
    for (const list of byKey.values()) {
        if (list.length > 400) continue; // a word in 400+ labels identifies nothing
        for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
            const [i, j] = list[x] < list[y] ? [list[x], list[y]] : [list[y], list[x]];
            pairs.add(i * 100000 + j);
        }
    }

    const findings = [];
    for (const key of pairs) {
        const i = Math.floor(key / 100000);
        const j = key % 100000;
        const A = prepared[i];
        const B = prepared[j];
        const signals = {
            label: jaccard(A.label, B.label),
            labelEn: jaccard(A.labelEn, B.labelEn)
        };
        if (A.answer && B.answer) signals.answer = jaccard(A.answer, B.answer);
        if (A.lex.size && B.lex.size) signals.lexicon = jaccard(A.lex, B.lex);
        const values = Object.values(signals);
        const score = values.reduce((a, b) => a + b, 0) / values.length;
        const corroborated = signals.label >= 0.6 && ((signals.answer ?? 0) >= 0.5 || (signals.lexicon ?? 0) >= 0.5);
        const samePrimary = A.primary === B.primary && signals.label >= 0.5;
        if (score >= bar || corroborated || samePrimary) {
            findings.push({
                a: A.id < B.id ? A.id : B.id,
                b: A.id < B.id ? B.id : A.id,
                score: round(score),
                signals: Object.fromEntries(Object.entries(signals).map(([k, v]) => [k, round(v)])),
                reason: samePrimary ? 'same_primary_similar_label' : corroborated ? 'corroborated' : 'score'
            });
        }
    }
    return findings.sort((x, y) => y.score - x.score);
}

// ------------------------------------------------------------
// 4. Glossary checks that matter for duplication
// ------------------------------------------------------------

/**
 * Two canonicals that are triggered by (mostly) the same phrases are the same
 * token under two names — and two scenarios built on them are duplicates the
 * signature checks cannot see. Reported when the normalized pattern sets
 * overlap by ≥ `bar` of the smaller set.
 */
export function findSynonymTokens(glossary, { bar = 0.5, onlyCanonicals = null } = {}) {
    const sets = glossary.map((e) => ({
        canonical: e.canonical,
        patterns: new Set((e.patterns || []).map((p) => normAr(p)).filter(Boolean))
    }));
    const byPattern = new Map();
    sets.forEach((s, i) => { for (const p of s.patterns) { if (!byPattern.has(p)) byPattern.set(p, []); byPattern.get(p).push(i); } });
    const pairs = new Map();
    for (const list of byPattern.values()) {
        for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
            const k = `${Math.min(list[x], list[y])}:${Math.max(list[x], list[y])}`;
            pairs.set(k, (pairs.get(k) || 0) + 1);
        }
    }
    const out = [];
    for (const [k, shared] of pairs) {
        const [i, j] = k.split(':').map(Number);
        const smaller = Math.min(sets[i].patterns.size, sets[j].patterns.size) || 1;
        const overlap = shared / smaller;
        if (overlap < bar) continue;
        if (onlyCanonicals && !onlyCanonicals.has(sets[i].canonical) && !onlyCanonicals.has(sets[j].canonical)) continue;
        out.push({ a: sets[i].canonical, b: sets[j].canonical, shared, overlap: round(overlap) });
    }
    return out;
}

// ------------------------------------------------------------
// 5. Inventory
// ------------------------------------------------------------

/** One row per scenario: what it is, what it reacts to, what it does. */
export function inventory(catalog) {
    return catalog.map((s) => {
        const p = primaryToken(s);
        return {
            id: s.id,
            family: s.id.split('_')[0],
            category: s.category,
            label: s.label?.ar,
            primaryToken: p,
            signalKind: p ? p.split('_')[0] : null,
            tokens: [...new Set(scenarioSignatures(s).flat().map((e) => e.token))],
            resolution: s.resolution?.hasAutoResolution ? 'answer' : (s.requiresTicketIfUnresolved ? 'ticket' : 'handoff'),
            questions: (s.discriminatingQuestions || []).length,
            knowledgeSource: s.resolution?.knowledgeSource || null
        };
    });
}

/**
 * Everything, in one call. `baseIds` marks which scenarios a pack is being
 * checked AGAINST, so a report can say "new vs existing" rather than just
 * "pair".
 */
export function auditCatalog(catalog, { glossary = null, ...options } = {}) {
    const reachability = analyzeReachability(catalog, options);
    return {
        size: catalog.length,
        reachability,
        structural: findStructuralDuplicates(catalog, options),
        semantic: findSemanticNearDuplicates(catalog, { glossary, ...options }),
        oversizedSignatures: catalog
            .filter((s) => scenarioSignatures(s).some((sig) => sig.length > (options.maxSignatureTokens || AUDIT_DEFAULTS.maxSignatureTokens)))
            .map((s) => s.id)
    };
}

function round(x) { return Math.round(x * 1000) / 1000; }
