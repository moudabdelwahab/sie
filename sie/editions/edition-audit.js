/**
 * edition-audit.js
 * ------------------------------------------------------------
 * تدقيق الإصدارات — every check that decides whether a pack may ship.
 *
 * `catalog-audit.js` answers questions about ONE catalog. This answers the
 * questions that only exist once there are several, layered:
 *
 *   VOCABULARY
 *     layer_redefines_base   a layer token with a base token's name
 *     pattern_collision      a pattern another token already owns (after
 *                            normalization) — one of them is dead on arrival
 *     dead_pattern           a pattern that, run through the real layered
 *                            normalizer, does not produce its own token
 *                            (usually: it contains a word the base owns)
 *     unused_token           a layer token no scenario ranks on
 *     synonym_token          a new token triggered by mostly the same
 *                            phrases as an existing one — two names, one
 *                            meaning, and the seed of a duplicate scenario
 *   SCENARIOS
 *     duplicate_id / missing_intent / duplicate_intent
 *     unknown_token          a signature token no layer in scope produces
 *     invalid                fails the engine's own validator
 *     not_decisive           no message can make the engine answer it
 *                            cleanly (exact — see analyzeReachability)
 *     core_displaced         a CORE scenario that is decisive in Free but
 *                            not in this edition: the pack took something away
 *     structural_duplicate   identical or same-token-set signatures
 *     semantic_duplicate     flagged by the four-signal pass, not reviewed
 *     same_answer            two answers ≥ 0.8 alike — two scenarios, one
 *                            decision
 *     intent_overlap         same subject+act in two domains, not reviewed
 *     oversized_signature    more than 5 tokens
 *     single_token_competition
 *                            one word alone makes a pack scenario tie with or
 *                            outrank the best CORE reading of that word — the
 *                            bigger edition turns a message Free handled into
 *                            a new stand-off. Rule: for one token alone, a
 *                            pack scenario is either not a candidate at all
 *                            (below ACTIVATION_THRESHOLD) or at least
 *                            AMBIGUITY_MARGIN below the best core scenario;
 *                            on a pack-only token, at most one pack scenario
 *                            leads (no tie within the margin). Found by bench/edition-compare.mjs:
 *                            «مرفوض», «مشكلة», «تيليجرام» each became a Pro
 *                            ticket where Free asked a question.
 *
 * The reviewed allowlist (sie/scenarios/tests/fixtures/reviewed-pairs.json)
 * is the ONLY way a flagged pair ships, and every entry carries the reason a
 * human (or the author, in writing) decided they are different cases.
 */
import { normalize } from '../language/normalizer.js';
import { validateCatalog, scenarioTokens, scenarioSignatures } from '../scenarios/scenario-types.js';
import {
    analyzeReachability, findStructuralDuplicates, findSemanticNearDuplicates, findSynonymTokens
} from '../scenarios/catalog-audit.js';
import { normalizeArabicToken } from '../language/dialect-normalizer.js';
import { computeScenarioConfidence, ACTIVATION_THRESHOLD } from '../diagnostics/hypothesis-tracker.js';
import { AMBIGUITY_MARGIN } from '../ranking/ranking-engine.js';

function normPattern(p) {
    return String(p || '').split(/\s+/).map((w) => (/[؀-ۿ]/.test(w) ? normalizeArabicToken(w) : w.toLowerCase())).filter(Boolean).join(' ');
}

function trigrams(text) {
    const s = ` ${normalizeArabicToken(String(text || '').replace(/\[\[icon:[a-z_]+\]\]/g, ' '))} `;
    const out = new Set();
    for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
    return out;
}
function jaccard(a, b) {
    let inter = 0;
    for (const x of a) if (b.has(x)) inter += 1;
    return inter / (a.size + b.size - inter || 1);
}

const round3 = (x) => Math.round(x * 1000) / 1000;
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * @param {Object} params
 * @param {Array} params.core                 core scenarios
 * @param {Array} params.baseGlossary
 * @param {Object<string,{scenarios: Array, glossary: Array}>} params.packs  in edition order (pro, max)
 * @param {Object} params.providers           { arabiziProvider }
 * @param {Object<string,string>} [params.reviewed] pair -> reason
 * @returns {Promise<{findings: Array, stats: Object}>}
 */
export async function auditEditions({ core, baseGlossary, packs, providers, reviewed = {} }) {
    const findings = [];
    const add = (kind, detail) => findings.push({ kind, ...detail });
    const packNames = Object.keys(packs);

    // ---------------- vocabulary ----------------
    const baseCanonicals = new Set(baseGlossary.map((e) => e.canonical));
    const owner = new Map(); // normalized pattern -> canonical
    for (const e of baseGlossary) for (const p of e.patterns || []) { const k = normPattern(p); if (!owner.has(k)) owner.set(k, e.canonical); }

    const layers = [];
    const layerCanonicals = new Set();
    for (const name of packNames) {
        const glossary = packs[name].glossary || [];
        for (const e of glossary) {
            if (baseCanonicals.has(e.canonical)) add('layer_redefines_base', { pack: name, token: e.canonical });
            if (layerCanonicals.has(e.canonical)) add('layer_redefines_base', { pack: name, token: e.canonical, note: 'defined by an earlier layer' });
            layerCanonicals.add(e.canonical);
            for (const p of e.patterns || []) {
                const k = normPattern(p);
                const prior = owner.get(k);
                if (prior && prior !== e.canonical) add('pattern_collision', { pack: name, token: e.canonical, pattern: p, ownedBy: prior });
                if (!prior) owner.set(k, e.canonical);
            }
        }
        layers.push(glossary);
        // Dead patterns, through the REAL normalizer with the layers in scope.
        const stable = layers.slice();
        for (const e of glossary) {
            for (const p of e.patterns || []) {
                const out = await normalize(p, {
                    glossaryProvider: { getEntries: async () => baseGlossary },
                    arabiziProvider: providers.arabiziProvider,
                    glossaryLayers: stable
                });
                if (!out.normalizedTokens.some((t) => t.canonical === e.canonical)) {
                    add('dead_pattern', { pack: name, token: e.canonical, pattern: p, produced: out.normalizedTokens.map((t) => t.canonical).join(' ') });
                }
            }
        }
    }
    const allGlossary = [...baseGlossary, ...layers.flat()];
    for (const s of findSynonymTokens(allGlossary, { bar: 0.5, onlyCanonicals: layerCanonicals })) {
        if (!reviewed[pairKey(s.a, s.b)]) add('synonym_token', s);
    }

    // ---------------- scenarios ----------------
    const editions = [];
    let cumulative = [...core];
    const known = new Set(baseCanonicals);
    editions.push({ name: 'free', catalog: cumulative.slice() });
    const ids = new Map(core.map((s) => [s.id, 'core']));
    const intents = new Map(core.filter((s) => s.intent).map((s) => [s.intent, s.id]));
    for (const s of core) if (!s.intent) add('missing_intent', { id: s.id, pack: 'core' });

    for (const name of packNames) {
        const list = packs[name].scenarios || [];
        for (const e of packs[name].glossary || []) known.add(e.canonical);
        const { invalid } = validateCatalog(list);
        for (const { scenario, errors } of invalid) add('invalid', { pack: name, id: scenario?.id, errors });
        for (const s of list) {
            if (ids.has(s.id)) add('duplicate_id', { pack: name, id: s.id, firstIn: ids.get(s.id) });
            ids.set(s.id, name);
            if (!s.intent) add('missing_intent', { pack: name, id: s.id });
            else if (intents.has(s.intent)) add('duplicate_intent', { pack: name, id: s.id, intent: s.intent, other: intents.get(s.intent) });
            else intents.set(s.intent, s.id);
            for (const t of scenarioTokens(s)) if (!known.has(t)) add('unknown_token', { pack: name, id: s.id, token: t });
            if (scenarioSignatures(s).some((sig) => sig.length > 5)) add('oversized_signature', { pack: name, id: s.id });
        }
        cumulative = [...cumulative, ...list];
        editions.push({ name, catalog: cumulative.slice(), pack: list });
    }

    // Intent overlap: same subject+act under two domains.
    const bySubjectAct = new Map();
    for (const s of editions[editions.length - 1].catalog) {
        if (!s.intent) continue;
        const [, subject, act] = s.intent.split('/');
        const k = `${subject}/${act}`;
        if (!bySubjectAct.has(k)) bySubjectAct.set(k, []);
        bySubjectAct.get(k).push(s);
    }
    const packIds = new Set(packNames.flatMap((n) => (packs[n].scenarios || []).map((s) => s.id)));
    for (const list of bySubjectAct.values()) {
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            if (!packIds.has(list[i].id) && !packIds.has(list[j].id)) continue; // core-vs-core was reviewed in the audit
            if (!reviewed[pairKey(list[i].id, list[j].id)]) add('intent_overlap', { a: list[i].id, b: list[j].id, intents: [list[i].intent, list[j].intent] });
        }
    }

    // Reachability per edition; core displacement.
    const freeReach = analyzeReachability(editions[0].catalog);
    const freeDecisive = new Set(freeReach.results.filter((r) => r.outcome === 'decisive').map((r) => r.id));
    const stats = { editions: {} };
    for (const ed of editions) {
        const reach = ed.name === 'free' ? freeReach : analyzeReachability(ed.catalog);
        stats.editions[ed.name] = { size: ed.catalog.length, reachability: reach.counts };
        if (ed.name === 'free') continue;
        for (const r of reach.results) {
            if (r.outcome === 'decisive') continue;
            if (packIds.has(r.id)) add('not_decisive', { edition: ed.name, id: r.id, outcome: r.outcome, rivals: r.rivals, best: r.subset });
            else if (freeDecisive.has(r.id)) add('core_displaced', { edition: ed.name, id: r.id, outcome: r.outcome, rivals: r.rivals });
        }
    }

    // One word alone must not create a stand-off Free did not have.
    for (const ed of editions) {
        if (ed.name === 'free') continue;
        const coreSet = new Set(editions[0].catalog.map((sc) => sc.id));
        const tokens = new Set(ed.catalog.flatMap((sc) => [...scenarioTokens(sc)]));
        for (const t of tokens) {
            const presence = new Map([[t, 1]]);
            const coreRanked = [];
            const pack = [];
            for (const sc of ed.catalog) {
                const c = computeScenarioConfidence(sc, presence).confidence;
                // Below the activation bar a hypothesis is not a candidate and
                // cannot take part in a stand-off (ranking-engine isCandidate).
                if (c < ACTIVATION_THRESHOLD) continue;
                if (coreSet.has(sc.id)) coreRanked.push({ sc, c });
                else pack.push({ id: sc.id, c });
            }
            if (!pack.length) continue;
            coreRanked.sort((a, b) => b.c - a.c);
            const coreBest = coreRanked[0]?.c || 0;
            // Displacement: when the word's two best core readings already
            // tie and one of the top three carries a clarifying question, a
            // pack scenario must not enter the top three (the decision engine
            // takes its questions from there).
            const tied = coreRanked.length >= 3 && coreRanked[0].c - coreRanked[1].c < AMBIGUITY_MARGIN;
            const asks = coreRanked.slice(0, 3).some((x) => (x.sc.discriminatingQuestions || []).length > 0);
            const third = tied && asks ? coreRanked[2].c : 0;
            if (coreBest > 0) {
                for (const x of pack) {
                    if (x.c > coreBest - AMBIGUITY_MARGIN + 1e-9 || (third > 0 && x.c >= third - 1e-9)) {
                        add('single_token_competition', { edition: ed.name, token: t, id: x.id, confidence: round3(x.c), coreBest: round3(coreBest), ...(third ? { coreThird: round3(third) } : {}) });
                    }
                }
            } else {
                pack.sort((a, b) => b.c - a.c);
                if (pack.length > 1 && pack[0].c - pack[1].c < AMBIGUITY_MARGIN - 1e-9) {
                    const tied = pack.filter((x) => pack[0].c - x.c < AMBIGUITY_MARGIN - 1e-9).map((x) => x.id);
                    add('single_token_competition', { edition: ed.name, token: t, tied, confidence: round3(pack[0].c), coreBest: 0 });
                }
            }
        }
    }

    // Structural + semantic + answers over the largest edition.
    const all = editions[editions.length - 1].catalog;
    for (const d of findStructuralDuplicates(all)) {
        if (d.kind === 'near_signature') continue; // reachability above is the exact form of this check
        if (!(packIds.has(d.a) || packIds.has(d.b))) continue;
        if (!reviewed[pairKey(d.a, d.b)]) add('structural_duplicate', d);
    }
    for (const d of findSemanticNearDuplicates(all, { glossary: allGlossary })) {
        if (!(packIds.has(d.a) || packIds.has(d.b))) continue;
        if (!reviewed[pairKey(d.a, d.b)]) add('semantic_duplicate', d);
    }
    const answers = all.filter((s) => s.resolution?.text?.ar).map((s) => ({ id: s.id, g: trigrams(s.resolution.text.ar) }));
    const packAnswers = answers.filter((a) => packIds.has(a.id));
    for (const a of packAnswers) {
        for (const b of answers) {
            if (a.id === b.id || (packIds.has(b.id) && b.id < a.id)) continue;
            const sim = jaccard(a.g, b.g);
            if (sim >= 0.8 && !reviewed[pairKey(a.id, b.id)]) add('same_answer', { a: a.id, b: b.id, similarity: Math.round(sim * 1000) / 1000 });
        }
    }

    const used = new Set(all.flatMap((sc) => [...scenarioTokens(sc)]));
    for (const name of packNames) {
        for (const e of packs[name].glossary || []) if (!used.has(e.canonical)) add('unused_token', { pack: name, token: e.canonical });
    }

    stats.intents = intents.size;
    stats.layerTokens = layerCanonicals.size;
    return { findings, stats };
}
