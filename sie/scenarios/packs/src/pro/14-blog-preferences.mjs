/**
 * Pro · المدوّنة، وتفضيلات العرض.
 *
 * Facts (Mad3oom, read 2026-09-24):
 *  - BLOG_GUIDE_AR.md: /blog/ is public — search, categories, tags, a
 *    featured article, pagination; the reader has a table of contents,
 *    related articles and sharing. Writing is platform staff only
 *    (is_platform_staff); customers and company owners read published
 *    articles only. An ARCHIVED article leaves the index and its link keeps
 *    working for staff only; changing an article's slug after publishing
 *    breaks shared links. An empty category is not shown to visitors. Until
 *    the blog migration is applied the page says «تعذّر تحميل المقالات».
 *  - theme-manager.js: the theme is stored per browser (localStorage
 *    'theme-preference'); with nothing stored it follows the device
 *    (prefers-color-scheme). The toggle is the sidebar button «تبديل الوضع
 *    الليلي والنهاري» (customer and company sidebars).
 *
 * Deliberately NOT here: a CAPTCHA/Turnstile case (turnstile-config.js exists
 * but login.html does not load it — customers never see one), the send-e-mail
 * tool and the WhatsApp sender page (admin / developer tools), and the
 * interface language (the core's ui_language_wrong, corrected in
 * scripts/catalog-fixes/2026-09-core-audit.mjs to the same per-browser fact).
 *
 * @no-legitimate-corpus
 */
import { S, T } from '../dsl.mjs';

export default {
    tokens: [
        T('entity_blog', 'المدوّنة', 'the blog', ['المدونة', 'المدونه', 'مدونة', 'مدونه', 'blog', 'البلوج', 'بلوج']),
        T('entity_write_article', 'كتابة مقال', 'writing an article', ['اكتب مقال', 'اكتب مقالة', 'اكتب مقاله', 'انشر مقال', 'انشر مقالة', 'write an article', 'write a post']),
        T('entity_load_failed_msg', 'تعذّر التحميل', 'failed to load', ['تعذر تحميل', 'تعذّر تحميل', 'فشل تحميل', 'failed to load']),
        T('entity_dark_theme', 'الوضع الليلي أو النهاري', 'dark or light mode', ['الوضع الليلي', 'الوضع النهاري', 'الوضع الفاتح', 'الوضع الداكن', 'الدارك مود', 'dark mode', 'light mode', 'الليلي', 'النهاري'])
    ],
    scenarios: [
        S('blog_write_article_not_allowed', 'blog/write/not_allowed', 'inquiry',
            'ينفع أكتب مقال في المدوّنة؟', 'Can I write an article on the blog?',
            'entity_write_article:5 entity_blog:3',
            `المدوّنة بيكتبها فريق المنصة بس — العملاء والشركات بيقروا المقالات المنشورة، من غير ما يقدروا يضيفوا أو يعدّلوا.\n\nلو عندك تجربة أو سؤال عايز تشاركه مع الناس، انشره كموضوع في المنتدى. ولو عندك فكرة لمقال، قولّي وأنا أوصّلها للفريق.`,
            `The blog is written by the platform team only — customers and companies read published articles but cannot add or edit them.\n\nIf you have an experience or a question to share with others, post it as a topic in the forum. And if you have an idea for an article, tell me and I'll pass it to the team.`,
            { alt: ['entity_write_article:1'] }),
        S('blog_find_article', 'blog/search/how', 'inquiry',
            'أدوّر على مقال في المدوّنة إزاي', 'How to find an article on the blog',
            'entity_blog:5 entity_search:2 intent_how_to:1',
            `في صفحة المدوّنة:\n• خانة البحث فوق.\n• التصنيفات والوسوم بتفلتر المقالات حسب الموضوع — والتصنيف اللي مفيهوش مقالات مابيظهرش أصلًا.\n• في آخر كل مقال «مقالات ذات صلة».\n\nلو بتدوّر على خطوات استخدام ميزة معيّنة، مركز المساعدة غالبًا أقرب — أو اسألني هنا على طول.`,
            `On the blog page:\n• The search box at the top.\n• Categories and tags filter articles by topic — a category with no articles isn't shown at all.\n• At the end of each article, "Related articles".\n\nIf you're after the steps to use a specific feature, the help center is usually closer — or just ask me here.`,
            { alt: ['entity_blog:5 entity_article:2 intent_how_to:1'] }),
        S('blog_article_link_not_working', 'blog/article_link/not_working', 'technical',
            'رابط مقال في المدوّنة مش بيفتح', 'A blog article link does not open',
            'entity_blog:481 entity_article:259 symptom_blank_page:259',
            `لو رابط مقال في المدوّنة مابيفتحش:\n• ممكن يكون المقال اتأرشف — ساعتها بيختفي من المدوّنة ورابطه بيفضل شغال لفريق المنصة بس.\n• أو رابطه اتغيّر بعد ما اتنشر، فالرابط القديم اللي اتشارك وقف.\n\nدوّر عليه بعنوانه من خانة البحث في المدوّنة. ولو مش لاقيه، ابعتلي الرابط وأنا أبلّغ الفريق.`,
            `If a blog article link doesn't open:\n• The article may have been archived — it then leaves the blog, and its link keeps working for the platform team only.\n• Or its link was changed after publishing, so the old shared link stopped working.\n\nSearch for it by title in the blog. If you can't find it, send me the link and I'll let the team know.`,
            { alt: ['entity_blog:481 entity_article:259 symptom_not_working:259'] }),
        S('blog_articles_load_failed', 'blog/load/failed', 'technical',
            'المدوّنة مكتوب فيها «تعذّر تحميل المقالات»', 'The blog says "failed to load articles"',
            'entity_load_failed_msg:5 entity_article:3 entity_blog:2',
            `«تعذّر تحميل المقالات» معناها إن صفحة المدوّنة ماقدرتش تجيب المقالات.\n\nحدّث الصفحة بعد دقيقة واتأكد إن النت شغال. لو الرسالة فضلت، قولّي وأنا أبلّغ الفريق التقني.`,
            `"Failed to load articles" means the blog page could not fetch the articles.\n\nRefresh the page in a minute and check your connection. If the message stays, tell me and I'll report it to the technical team.`),
        S('pref_theme_not_kept', 'preferences/theme/per_browser', 'technical',
            'الوضع الليلي/الفاتح: فين وليه بيتغيّر', 'Dark/light mode: where it is and why it changes',
            'entity_dark_theme:860 atom_by_itself:139',
            `زرار «تبديل الوضع الليلي والنهاري» موجود في القائمة الجانبية.\n\nاختيارك بيتحفظ في المتصفح اللي انت عليه، مش في حسابك:\n• لو فتحت من جهاز أو متصفح تاني، العرض بيبدأ حسب إعداد الجهاز نفسه (فاتح أو داكن).\n• لو الوضع بيرجع لوحده، غالبًا المتصفح بيمسح بيانات المواقع، أو انت في التصفح الخفي.`,
            `The "toggle dark and light mode" button is in the sidebar.\n\nYour choice is saved in the browser you're using, not in your account:\n• On another device or browser, the display starts from that device's own setting (light or dark).\n• If the mode keeps switching back, your browser is probably clearing site data, or you're in private browsing.`)
    ]
};
