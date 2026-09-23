/**
 * corpora/behavior.mjs
 * ------------------------------------------------------------
 * مدوّنة السلوك — the message set every edition is compared on.
 *
 * The comparator in this directory answered "does vNext change decisions?"
 * on a few hundred messages. Growing the catalog from 650 to 1,500 is a much
 * bigger change, and the question it has to answer is sharper: for EVERY
 * message the Free engine handles today, what does each edition do, and is
 * the difference an improvement, a regression, or new ambiguity?
 *
 * That needs a corpus that (a) reaches every scenario and every glossary
 * phrase, (b) contains the shapes real traffic takes rather than only the
 * friendliest probe, and (c) is deterministic, so a diff between two runs is
 * a diff in the engine and never in the corpus.
 *
 * ------------------------------------------------------------
 * THE STRATA — each one labelled, so results can be reported per stratum
 *
 *   phrase      every glossary pattern, alone. The vocabulary as written.
 *   probe       per scenario, its own strongest words combined the way people
 *               combine them ("X و Y", "Y X", with a carrier). `expect` is the
 *               scenario the words were taken from.
 *   noisy       a deterministic sample of probes with the damage real
 *               messages carry: a dropped letter, a stretched letter, an
 *               attached conjunction (و/ف/ب), a trailing emoji, an English
 *               word swapped in.
 *   repo        Arabic messages from this repository's own non-adversarial
 *               tests — written by people describing real cases.
 *   production  the production traces.
 *
 * `expect` exists only where it is honest: for a probe, the scenario whose
 * words built it. It is an INTENDED target, not ground truth — a probe for a
 * general scenario that a more specific one answers is not automatically a
 * regression, and the comparator reports those separately.
 *
 * @no-legitimate-corpus — generated messages, not a sample of real traffic.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION } from './index.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const CARRIERS = [
    (x) => x,
    (x) => `عندي مشكلة ${x}`,
    (x) => `لو سمحت ${x}`,
    (x) => `${x} من امبارح`,
    (x) => `ممكن تساعدني ${x}`
];

/** A realistic defect applied to one message, chosen by the generator. */
const NOISE = [
    { kind: 'drop_letter', apply: (t, r) => { const w = t.split(' '); const i = Math.floor(r() * w.length); if (w[i].length > 4) { const k = 1 + Math.floor(r() * (w[i].length - 2)); w[i] = w[i].slice(0, k) + w[i].slice(k + 1); } return w.join(' '); } },
    { kind: 'stretch', apply: (t) => t.replace(/([اويه])/, '$1$1$1') },
    { kind: 'attached_waw', apply: (t) => `و${t}` },
    { kind: 'attached_fa', apply: (t) => `ف${t}` },
    { kind: 'emoji', apply: (t) => `${t} 😡😡` },
    { kind: 'question_marks', apply: (t) => `${t}؟؟؟` },
    { kind: 'english_mix', apply: (t) => `please ${t} asap` },
    { kind: 'no_spaces_punct', apply: (t) => t.replace(/ /g, '،') }
];

function patternsOf(glossary) {
    return new Map(glossary.map((e) => [e.canonical, e.patterns || []]));
}

/**
 * @param {Object} params
 * @param {Array} params.catalog       the catalog whose scenarios get probes
 * @param {Array} params.glossary      glossary entries (all layers in play)
 * @param {number} [params.seed]
 * @param {number} [params.probesPerScenario]
 * @param {number} [params.noiseRate]  fraction of probes that also get a noisy twin
 * @returns {Array<{id: string, text: string, stratum: string, expect?: string, noise?: string}>}
 */
export function buildBehaviorCorpus({ catalog, glossary, seed = 20260923, probesPerScenario = 3, noiseRate = 0.5, includeRepo = true }) {
    const rand = lcg(seed);
    const patterns = patternsOf(glossary);
    const out = [];
    const seen = new Set();
    const push = (item) => {
        const key = item.text.trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        out.push(item);
    };

    // phrase — every pattern of every canonical some scenario ranks on.
    const used = new Set();
    for (const s of catalog) for (const e of s.evidenceSignature || []) used.add(e.token);
    for (const entry of glossary) {
        if (!used.has(entry.canonical)) continue;
        (entry.patterns || []).forEach((p, i) => push({ id: `phrase:${entry.canonical}:${i}`, text: p, stratum: 'phrase' }));
    }

    // probe + noisy
    for (const s of catalog) {
        const sig = [...(s.evidenceSignature || [])].sort((a, b) => b.weight - a.weight);
        if (!sig.length) continue;
        for (let k = 0; k < probesPerScenario; k++) {
            const words = [];
            const take = k === 0 ? Math.min(2, sig.length) : Math.min(sig.length, 1 + Math.floor(rand() * sig.length));
            for (const e of sig.slice(0, take)) {
                const ps = patterns.get(e.token) || [];
                if (ps.length) words.push(ps[Math.floor(rand() * ps.length)]);
            }
            if (!words.length) continue;
            if (k % 2 === 1) words.reverse();
            const core = words.join(k === 2 ? ' ' : ' و');
            const text = CARRIERS[Math.floor(rand() * CARRIERS.length)](core);
            const id = `probe:${s.id}:${k}`;
            push({ id, text, stratum: 'probe', expect: s.id });
            if (rand() < noiseRate) {
                const noise = NOISE[Math.floor(rand() * NOISE.length)];
                push({ id: `noisy:${s.id}:${k}`, text: noise.apply(text, rand), stratum: 'noisy', expect: s.id, noise: noise.kind });
            }
        }
    }

    if (includeRepo) for (const [i, text] of repoMessages().entries()) push({ id: `repo:${i}`, text, stratum: 'repo' });

    for (const conv of PRODUCTION) {
        conv.turns.forEach((t, i) => push({ id: `production:${conv.id}:${i}`, text: t.text, stratum: 'production' }));
    }
    return out;
}

// ------------------------------------------------------------
// Repository messages — same exclusion rules as the trust layer's
// legitimate corpus (sie/trust/tests/adversarial.test.mjs), so attack
// strings never masquerade as ordinary customer text here either.
// ------------------------------------------------------------

const ARABIC = /[؀-ۿ]/;
const STRING_LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.)*)`/g;
const LOOKS_LIKE_CODE = /=>|\bfunction\b|\bconst \w|\}\s*\)|;\s*$|^\s*[{\[]/m;
const TRUST_IMPORT = /['"][^'"]*\/trust\/[^'"]*['"]/;
const OPTED_OUT = /@no-legitimate-corpus/;

function filesUnder(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) filesUnder(full, out);
        else if (/\.m?js$/.test(entry.name)) out.push(full);
    }
    return out;
}

export function repoMessages() {
    const files = ['sie', 'sie-integration', 'channels']
        .flatMap((d) => filesUnder(path.join(ROOT, d)))
        .filter((f) => f.includes(`${path.sep}tests${path.sep}`));
    const corpus = new Set();
    for (const file of files) {
        if (file.includes(`${path.sep}trust${path.sep}`)) continue;
        const source = fs.readFileSync(file, 'utf8');
        if (OPTED_OUT.test(source) || TRUST_IMPORT.test(source)) continue;
        for (const m of source.matchAll(STRING_LITERAL)) {
            const raw = m[1] ?? m[2] ?? m[3];
            if (!raw || !ARABIC.test(raw) || raw.length < 2 || raw.length > 400 || LOOKS_LIKE_CODE.test(raw)) continue;
            corpus.add(raw.replace(/\\n/g, '\n'));
        }
    }
    return [...corpus].sort();
}
