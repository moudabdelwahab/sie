/**
 * sie-content-import.js  —  INTERNAL TO SIE
 * ------------------------------------------------------------
 * قراءة ملف Markdown (أو نص مستخرج من PDF) وتحويله لسيناريوهات ومعرفة
 * بالشكل اللي المحرك بيفهمه.
 *
 * ⚠️ Not a public surface — Mad3oom imports sie-runtime.js.
 *
 * ------------------------------------------------------------
 * WHY A DOCUMENT FORMAT AT ALL
 *
 * The console's scenario dialog is one scenario at a time, with an
 * evidence row per token. That is the right shape for editing one thing
 * and the wrong shape for the way support knowledge actually arrives:
 * someone already wrote it down — in a doc, a handover file, a PDF from
 * the old vendor — and retyping forty of them into a modal is how a
 * catalog stays half-finished.
 *
 * So the import path takes the document as it is.
 *
 * ------------------------------------------------------------
 * WHY IT LIVES HERE AND NOT UNDER sie/
 *
 * It produces BOTH scenarios (Module 2) and knowledge entries (Module 7),
 * and validates each against that module's own validator. A file that
 * reaches across two modules cannot belong to either without making one
 * depend on the other. sie-integration/ is the layer already allowed to
 * see the whole graph, so it goes here — and the engine stays unaware
 * that a markdown format exists at all.
 *
 * ------------------------------------------------------------
 * THE PARSER IS DELIBERATELY FORGIVING
 *
 * Every input is a human writing Arabic prose, and half of them will
 * arrive via PDF text extraction, which mangles list bullets, drops `#`
 * markers, converts digits, and reorders nothing reliably except the
 * words themselves. A strict parser would reject documents whose meaning
 * is perfectly clear.
 *
 * So: headings work with or without `#`, field separators can be `:` or
 * `：` or `-` or `—`, bullets can be `-` `*` `+` `•` `–`, digits can be
 * Arabic-Indic, and every field name has several spellings. What is NOT
 * forgiving is the result — every parsed entry is run through the
 * engine's real validator, and anything that would not load is reported
 * with the line number it came from.
 */
import { validateScenario } from '../sie/scenarios/scenario-types.js';
import { validateStaticKnowledgeEntry } from '../sie/knowledge/knowledge-types.js';

// ═════════════════════════════════════════════════════════════
// التطبيع
// ═════════════════════════════════════════════════════════════

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/** ٥ و ۵ و 5 كلهم خمسة. PDF extraction turns these into each other freely. */
function normalizeDigits(text) {
    return String(text).replace(/[٠-٩۰-۹]/g, (d) => {
        const i = ARABIC_INDIC.indexOf(d);
        return String(i >= 0 ? i : EASTERN_ARABIC_INDIC.indexOf(d));
    });
}

/**
 * Folds a field NAME down to something matchable: no tashkeel, no hamza
 * variants, no punctuation, single spaces. Only ever applied to keys and
 * headings — never to the answer text, which must reach the customer
 * exactly as written.
 */
function foldKey(text) {
    return String(text || '')
        .replace(/[ً-ْٰـ]/g, '')   // تشكيل وتطويل
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/[*_`~#|]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

const BULLET = /^\s*[-*+•–—]\s*/;
const stripBullet = (line) => line.replace(BULLET, '');

// ═════════════════════════════════════════════════════════════
// المفردات: كل اسم ليه أكتر من صيغة
// ═════════════════════════════════════════════════════════════

/** A block starts here, and its type is decided by which list matched. */
const BLOCK_MARKERS = {
    scenario: ['سيناريو', 'السيناريو', 'حاله', 'الحاله', 'scenario', 'case'],
    knowledge: ['معرفه', 'المعرفه', 'معلومه', 'مقاله', 'knowledge', 'article', 'info']
};

const FIELD_ALIASES = {
    id: ['المعرف', 'الاسم البرمجي', 'الاسم بالانجليزي للنظام', 'المفتاح', 'id', 'key', 'slug'],
    category: ['القسم', 'التصنيف', 'category', 'section'],
    labelAr: ['الاسم', 'العنوان', 'الاسم بالعربي', 'label', 'title'],
    labelEn: ['الاسم بالانجليزي', 'العنوان بالانجليزي', 'label en', 'english name', 'english title'],
    ticket: ['لو مااتحلتش', 'التذكره', 'فتح تذكره', 'ticket', 'fallback'],
    notes: ['ملاحظه', 'ملاحظات', 'note', 'notes']
};

const SECTION_ALIASES = {
    evidence: [
        'الكلمات الداله', 'الكلمات', 'الادله', 'الكلمات المفتاحيه',
        'الكلمات اللي بيتعرف بيها', 'بيعرفها من', 'evidence', 'keywords', 'signals'
    ],
    answerAr: ['الرد', 'الحل', 'الرد بالعربي', 'الاجابه', 'المحتوي', 'النص', 'answer', 'reply', 'content'],
    answerEn: ['الرد بالانجليزي', 'الاجابه بالانجليزي', 'النص بالانجليزي', 'answer en', 'english answer'],
    question: ['سؤال توضيحي', 'سؤال', 'question']
};

/** Stored category codes are English because tickets.category is. */
const CATEGORY_ALIASES = {
    whatsapp: ['واتساب', 'الواتساب', 'واتس', 'whatsapp'],
    subscription: ['الاشتراكات والفلوس', 'الاشتراكات', 'الاشتراك', 'الفلوس', 'الدفع', 'الفواتير', 'subscription', 'billing'],
    login: ['الدخول والحساب', 'الدخول', 'الحساب', 'تسجيل الدخول', 'login', 'account'],
    api: ['الربط البرمجي', 'الربط', 'api', 'integration'],
    inquiry: ['استفسارات', 'استفسار', 'inquiry', 'question'],
    other: ['اخري', 'اخر', 'غير ذلك', 'other', 'misc']
};

/** «متقفلش تذكرة» has to beat «تذكرة» — negatives are checked first. */
const NO_TICKET_MARKERS = ['متقفلش', 'مش محتاج', 'من غير تذكره', 'بدون تذكره', 'لا', 'no', 'none', 'false'];

function matchAlias(folded, table) {
    for (const [code, names] of Object.entries(table)) {
        if (names.some((n) => folded === foldKey(n))) return code;
    }
    // A looser second pass so «الكلمات الدالة للسيناريو» is still the
    // evidence section. Anchored at the START on purpose: `includes` would
    // make «شرح حقل الرد» — a heading in the guide half of the template —
    // parse as the answer itself.
    for (const [code, names] of Object.entries(table)) {
        if (names.some((n) => folded.startsWith(`${foldKey(n)} `))) return code;
    }
    return null;
}

// ═════════════════════════════════════════════════════════════
// الأوزان الافتراضية
// ═════════════════════════════════════════════════════════════

/**
 * The ranking engine resolves a scenario when its confidence clears 0.60,
 * and confidence is the matched share of the signature's total weight. So
 * a signature whose two strongest tokens are together worth less than 60%
 * of the total CANNOT resolve, no matter what the customer writes — it
 * will ask a clarifying question forever.
 *
 * An author writing prose has no way to know that. When weights are left
 * out, these are chosen so the top two always clear the bar: 5 and 4 are
 * 9, so everything else may total at most 6.
 *
 * Past eight tokens no distribution works, and the parser says so rather
 * than silently producing a scenario that can never fire.
 */
const RESOLVE_THRESHOLD = 0.6;
const MAX_USEFUL_EVIDENCE = 8;

function defaultWeights(count) {
    if (count === 1) return [5];
    if (count === 2) return [5, 4];
    const rest = count - 2;
    const each = Math.max(1, Math.floor(6 / rest));
    return [5, 4, ...Array(rest).fill(each)];
}

/** The share the two strongest tokens carry — the number that decides resolvability. */
export function topTwoShare(weights) {
    const sorted = [...weights].filter((w) => w > 0).sort((a, b) => b - a);
    const total = sorted.reduce((a, b) => a + b, 0);
    if (!total) return 0;
    return sorted.slice(0, 2).reduce((a, b) => a + b, 0) / total;
}

// ═════════════════════════════════════════════════════════════
// تقطيع المستند
// ═════════════════════════════════════════════════════════════

/**
 * A heading is `# anything`, or — because PDF extraction eats the `#` —
 * a bare line that opens with a block marker word followed by a separator.
 *
 * @returns {{type: 'scenario'|'knowledge'|'section', title: string}|null}
 */
function readHeading(rawLine) {
    const line = rawLine.trim();
    if (!line) return null;

    const hashed = line.match(/^(#{1,6})\s*(.+?)\s*#*$/);
    const body = hashed ? hashed[2] : line;
    const folded = foldKey(body);

    // Does it open a new entry? «سيناريو: نسيان كلمة المرور»
    //
    // The colon is required, not decorative. Without it, a prose heading
    // like «المعرفة — إمتى تستخدمها بدل السيناريو» opens a block and
    // swallows everything under it. A colon after the marker word is what
    // the format documents and what an author actually types.
    const colon = body.match(/^([^:：]{1,30})[:：]\s*(.*)$/);
    if (colon) {
        const head = foldKey(colon[1]);
        for (const [type, markers] of Object.entries(BLOCK_MARKERS)) {
            if (markers.some((marker) => head === foldKey(marker))) {
                return { type, title: colon[2].trim() };
            }
        }
    }

    // Otherwise a `#` heading is a section inside the current entry. A bare
    // line is just prose and must NOT be treated as a heading, or every
    // sentence of an answer would end the answer.
    return hashed ? { type: 'section', title: body } : null;
}

/**
 * `المعرّف: forgot_password` — with the separator being any of the four
 * things a word processor might have turned a colon into.
 */
function readField(rawLine) {
    const line = stripBullet(rawLine).trim().replace(/^\*\*(.+?)\*\*/, '$1');
    const m = line.match(/^([^:：]{1,60})\s*[:：]\s*(.*)$/);
    if (!m) return null;
    const key = matchAlias(foldKey(m[1]), FIELD_ALIASES);
    return key ? { key, value: m[2].trim() } : null;
}

/**
 * `entity_whatsapp (5)` / `entity_whatsapp — ٥` / `entity_whatsapp = 5`
 * / `entity_whatsapp` — the weight is optional everywhere.
 */
function readEvidence(rawLine) {
    const line = normalizeDigits(stripBullet(rawLine).trim()).replace(/\*\*/g, '');
    if (!line) return null;

    const withWeight = line.match(/^(.+?)\s*(?:\(\s*(\d+)\s*\)|[:：=—–-]\s*(\d+))\s*$/);
    if (withWeight) {
        const token = withWeight[1].trim();
        const weight = Number(withWeight[2] ?? withWeight[3]);
        return token ? { token, weight } : null;
    }
    return { token: line, weight: null };
}

// ═════════════════════════════════════════════════════════════
// القراءة
// ═════════════════════════════════════════════════════════════

/**
 * Splits the document into blocks, one per `# سيناريو:` / `# معرفة:`
 * heading, keeping the line number each block started on so an error can
 * point at the place in the file rather than at "somewhere".
 */
function splitBlocks(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let current = null;
    let inFence = false;

    lines.forEach((line, i) => {
        // A fenced block is an EXAMPLE of the format, not an instance of
        // it. The template's own guide shows `# سيناريو: …` inside fences;
        // reading those would import the documentation.
        if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
        if (inFence) return;

        // `---` between blocks is a separator, not content.
        if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) return;

        const heading = readHeading(line);
        if (heading && heading.type !== 'section') {
            current = { type: heading.type, title: heading.title, line: i + 1, lines: [] };
            blocks.push(current);
            return;
        }
        if (current) current.lines.push(line);
    });

    return blocks;
}

/**
 * Walks one block's lines, collecting fields, sections and the free text
 * under each section heading.
 */
function readBlockBody(lines) {
    const fields = {};
    const sections = { evidence: [], answerAr: [], answerEn: [], question: [] };
    let section = null;

    for (const line of lines) {
        const heading = readHeading(line);
        if (heading?.type === 'section') {
            section = matchAlias(foldKey(heading.title), SECTION_ALIASES);
            continue;
        }

        // Fields are recognised anywhere EXCEPT inside answer text, which
        // is prose the customer reads verbatim. «ملاحظة: لو اللينك مجاش…»
        // is a sentence, not a metadata line, and lifting it out would
        // silently delete it from the answer.
        const inProse = section === 'answerAr' || section === 'answerEn';
        const field = inProse ? null : readField(line);
        if (field) {
            fields[field.key] = field.value;
            continue;
        }

        if (section) sections[section].push(line);
    }

    return { fields, sections };
}

/** Trims the blank lines a section accumulates without touching the inside. */
const joinText = (lines) => lines.join('\n').replace(/^\n+|\n+$/g, '').trim();

// ═════════════════════════════════════════════════════════════
// البناء
// ═════════════════════════════════════════════════════════════

/** `نسيان كلمة المرور` -> `nsyan_klm_almror` is useless; fall back to a stable slug. */
function slugFromTitle(title, index) {
    const ascii = String(title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return ascii || `imported_scenario_${index + 1}`;
}

function buildScenario(block, index, options) {
    const warnings = [];
    const { fields, sections } = readBlockBody(block.lines);

    const labelAr = (fields.labelAr || block.title || '').trim();
    const id = (fields.id || '').trim() || slugFromTitle(fields.labelEn || block.title, index);
    if (!fields.id) {
        warnings.push(`مافيش «المعرّف»، فاتولّد تلقائيًا: ${id}`);
    }

    // The schema wants a non-empty English label. An Arabic-only author has
    // none, and refusing the import over it would block the whole point of
    // the feature — so the Arabic falls in and the author is told, rather
    // than the document being rejected or an English string invented.
    const labelEn = (fields.labelEn || '').trim() || labelAr;
    if (!fields.labelEn && labelAr) {
        warnings.push('مافيش اسم بالإنجليزي — هيتحط الاسم العربي مكانه.');
    }

    const category = matchAlias(foldKey(fields.category || ''), CATEGORY_ALIASES) || 'other';
    if (fields.category && category === 'other' && foldKey(fields.category) !== foldKey('أخرى')) {
        warnings.push(`القسم «${fields.category}» مش معروف، فاتحسب «أخرى».`);
    }

    // Evidence -------------------------------------------------
    const parsed = sections.evidence.map(readEvidence).filter(Boolean);
    const resolveToken = options.resolveToken || ((t) => t);
    const evidenceSignature = parsed.map((e) => ({
        token: resolveToken(e.token),
        weight: e.weight,
        source: 'text'
    }));

    const anyWeightGiven = evidenceSignature.some((e) => e.weight !== null);
    if (!anyWeightGiven && evidenceSignature.length) {
        const defaults = defaultWeights(evidenceSignature.length);
        evidenceSignature.forEach((e, i) => { e.weight = defaults[i]; });
        warnings.push('مافيش أوزان، فاتحطت أوزان تخلي أقوى كلمتين يحسموا.');
    } else {
        evidenceSignature.forEach((e) => { if (e.weight === null) e.weight = 1; });
    }

    if (evidenceSignature.length > MAX_USEFUL_EVIDENCE) {
        warnings.push(
            `${evidenceSignature.length} كلمة كتير — أقوى كلمتين مش هيوصلوا لـ ${RESOLVE_THRESHOLD}، ` +
            'فالمحرك هيفضل يسأل من غير ما يحسم. قلّل الكلمات.'
        );
    }

    // Answer ---------------------------------------------------
    const answerAr = joinText(sections.answerAr);
    const answerEn = joinText(sections.answerEn) || answerAr;
    if (answerAr && !joinText(sections.answerEn)) {
        warnings.push('مافيش رد بالإنجليزي — العميل اللي بيكتب إنجليزي هيوصله الرد العربي.');
    }

    // Clarifying question --------------------------------------
    const questionLines = sections.question.filter((l) => l.trim());
    const discriminatingQuestions = [];
    if (questionLines.length) {
        const promptLine = questionLines.find((l) => !BULLET.test(l)) || questionLines[0];
        const optionLines = questionLines.filter((l) => BULLET.test(l));
        discriminatingQuestions.push({
            id: `${id}_q1`,
            prompt: { ar: promptLine.trim(), en: promptLine.trim() },
            resolvesEvidence: evidenceSignature.slice(0, 2).map((e) => e.token),
            options: optionLines.map((l, i) => ({
                label: { ar: stripBullet(l).trim(), en: stripBullet(l).trim() },
                value: `opt_${i + 1}`,
                impliesEvidence: []
            }))
        });
    }

    const ticketFolded = foldKey(fields.ticket || '');
    const requiresTicketIfUnresolved = ticketFolded
        ? !NO_TICKET_MARKERS.some((n) => ticketFolded.includes(foldKey(n)))
        : true;

    const scenario = {
        id,
        label: { ar: labelAr, en: labelEn },
        category,
        evidenceSignature,
        discriminatingQuestions,
        resolution: answerAr
            ? { hasAutoResolution: true, text: { ar: answerAr, en: answerEn } }
            : { hasAutoResolution: false },
        requiresTicketIfUnresolved
    };

    const { valid, errors } = validateScenario(scenario);

    // Structurally valid but unable to ever resolve is the failure mode
    // that would otherwise reach production and look like "the bot ignores
    // this case". It is an error, not a warning.
    const share = topTwoShare(evidenceSignature.map((e) => e.weight));
    const allErrors = [...errors];
    if (valid && share < RESOLVE_THRESHOLD) {
        allErrors.push(
            `التوقيع ده مش هيحسم أبدًا: أقوى كلمتين بيوصلوا ${share.toFixed(2)} ` +
            `والمطلوب ${RESOLVE_THRESHOLD.toFixed(2)}. قلّل الكلمات أو زوّد وزن أهمها.`
        );
    }

    return {
        kind: 'scenario',
        line: block.line,
        title: labelAr || id,
        value: scenario,
        valid: allErrors.length === 0,
        errors: allErrors,
        warnings
    };
}

function buildKnowledge(block, index, _options) {
    const warnings = [];
    const { fields, sections } = readBlockBody(block.lines);

    const key = (fields.id || '').trim() || slugFromTitle(fields.labelEn || block.title, index);
    if (!fields.id) warnings.push(`مافيش «المفتاح»، فاتولّد تلقائيًا: ${key}`);

    const ar = joinText(sections.answerAr);
    const en = joinText(sections.answerEn) || ar;
    if (ar && !joinText(sections.answerEn)) {
        warnings.push('مافيش نص بالإنجليزي — الرد العربي هيتبعت للاتنين.');
    }

    const entry = { key, text: { ar, en } };
    const { errors } = validateStaticKnowledgeEntry(entry);

    return {
        kind: 'knowledge',
        line: block.line,
        title: fields.labelAr || block.title || key,
        value: entry,
        valid: errors.length === 0,
        errors,
        warnings
    };
}

// ═════════════════════════════════════════════════════════════
// الواجهة
// ═════════════════════════════════════════════════════════════

/**
 * Parses a whole document.
 *
 * Never throws and never partially fails: a block that cannot be built is
 * reported with its errors and its line number, and the blocks around it
 * are still returned. Importing 30 scenarios must not be an all-or-nothing
 * bet on the worst-written one.
 *
 * @param {string} text - markdown, or text extracted from a PDF
 * @param {Object} [options]
 * @param {(token: string) => string} [options.resolveToken] - maps what the
 *   author wrote onto a canonical evidence token; identity by default
 * @returns {{entries: Array, scenarios: Array, knowledge: Array, errors: string[]}}
 */
export function parseContentDocument(text, options = {}) {
    const blocks = splitBlocks(text);
    if (blocks.length === 0) {
        return {
            entries: [],
            scenarios: [],
            knowledge: [],
            errors: ['مالقيتش أي سيناريو في الملف. كل سيناريو لازم يبدأ بسطر زي «# سيناريو: اسم الحالة».']
        };
    }

    const entries = blocks.map((block, i) =>
        block.type === 'knowledge' ? buildKnowledge(block, i, options) : buildScenario(block, i, options));

    // Two blocks with the same id would overwrite each other on save,
    // silently losing one. Caught here, where the line numbers are known.
    const seen = new Map();
    for (const entry of entries) {
        const id = entry.value.id || entry.value.key;
        if (seen.has(id)) {
            entry.valid = false;
            entry.errors.push(`المعرّف «${id}» مكرر — اتستخدم قبل كده في السطر ${seen.get(id)}.`);
        } else {
            seen.set(id, entry.line);
        }
    }

    return {
        entries,
        scenarios: entries.filter((e) => e.kind === 'scenario'),
        knowledge: entries.filter((e) => e.kind === 'knowledge'),
        errors: []
    };
}
