/**
 * Max · آخر فجوة في سطح مدعوم الموجّه للعميل — MAD3OOM-SPECIFIC.
 *
 * The coverage map (docs/editions-engineering-report.md §15) walked every
 * customer-facing page of Mad3oom against core + Pro. Everything else was
 * covered or is staff-only (status page, activity SDK, workflow builder,
 * send-e-mail, WhatsApp sender, customer history, support board) or never
 * reaches the customer (the Turnstile CAPTCHA is not loaded by login.html).
 *
 * Facts (Mad3oom, read 2026-09-24): footer.html and index.html link
 * «سياسة الخصوصية» (privacy.html), «شروط الاستخدام» (terms.html) and — in the
 * footer — «سياسة الكوكيز» (cookies.html).
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_legal_pages', 'صفحات الشروط والخصوصية', 'terms and privacy pages', ['شروط الاستخدام', 'شروط الاستخدام والخصوصية', 'الشروط والاحكام', 'سياسة الخصوصية', 'سياسه الخصوصيه', 'terms of use', 'terms and conditions', 'privacy policy']),
        T('entity_policy_word', 'سياسة', 'policy', ['سياسة', 'سياسه', 'السياسة', 'السياسه', 'policy'])
    ],
    scenarios: [
        S('legal_pages_where', 'legal/pages/where', 'inquiry',
            'فين شروط الاستخدام وسياسة الخصوصية؟', 'Where are the terms of use and the privacy policy?',
            'entity_legal_pages:860 atom_where:139',
            `روابطهم في أسفل صفحات الموقع العامة: «سياسة الخصوصية»، «شروط الاستخدام»، و«سياسة الكوكيز».\n\nولو سؤالك عن حاجة معيّنة — زي البيانات اللي بتتحفظ عنك — قولّي عليها.`,
            `Their links are at the bottom of the site's public pages: "Privacy policy", "Terms of use" and "Cookie policy".\n\nIf your question is about something specific — such as what data is kept about you — tell me.`,
            { alt: ['entity_legal_pages:1', 'entity_policy_word:3 entity_cache:2'] })
    ]
};
