/**
 * ui/icons.js — نظام أيقونات SIE
 * ============================================================
 * كل الأيقونات SVG مرسومة على شبكة 24×24 بنفس سُمك الخط (1.75)
 * وبتاخد لونها من `currentColor`. مفيش إيموجي في أي مكان في اللوحة،
 * ومفيش مكتبة خارجية — الأيقونة اللي مش هنا مش بتتستخدم.
 *
 * ── WHY STRINGS AND NOT ELEMENTS ────────────────────────────
 * The console renders most of its surface with template literals, so an
 * icon has to be composable into a string. `icon()` returns markup, and
 * because every path here is written by hand there is no user input in
 * it — nothing to escape.
 */

/** المسارات بس؛ الغلاف بيتبني في icon(). */
const PATHS = {
    // ── التنقل ──────────────────────────────────────────────
    dashboard: '<rect x="3" y="3" width="7.5" height="8.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="2"/><rect x="13.5" y="11" width="7.5" height="10" rx="2"/><rect x="3" y="14" width="7.5" height="7" rx="2"/>',
    scenarios: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H18a2 2 0 0 1 2 2v12.5"/><path d="M4 5.5V18a3 3 0 0 0 3 3h13"/><path d="M8 8h8M8 12h5"/>',
    knowledge: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11v18H5.5A1.5 1.5 0 0 1 4 19.5z"/><path d="M20 4.5A1.5 1.5 0 0 0 18.5 3H13v18h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
    diagnostics: '<path d="M3 12h3.5l2-5 3 10 2.5-7 1.5 2H21"/>',
    users: '<path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20"/><circle cx="9.5" cy="7.5" r="3.5"/><path d="M17 4.2a3.5 3.5 0 0 1 0 6.6"/><path d="M21 20v-1.5a4 4 0 0 0-3-3.87"/>',
    usage: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M14.5 2.5A8 8 0 0 1 21.5 9.5h-7z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.08A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',

    // ── أفعال ───────────────────────────────────────────────
    search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5 16.7 16.7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M21 15v3.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5V15"/><path d="m7.5 9 4.5-4.5L16.5 9"/><path d="M12 4.5V16"/>',
    download: '<path d="M21 15v3.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5V15"/><path d="m7.5 11.5 4.5 4.5 4.5-4.5"/><path d="M12 16V4.5"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    check: '<path d="m4.5 12.5 5 5 10-11"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.2 2.8 2.8L16 9.5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    trash: '<path d="M3.5 6.5h17"/><path d="M8.5 6.5V5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5"/><path d="M6.5 6.5 7.5 20a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13.5"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3.5V9h-5.5"/>',
    play: '<path d="M6.5 4.8v14.4a1 1 0 0 0 1.53.85l11.2-7.2a1 1 0 0 0 0-1.7L8.03 3.95a1 1 0 0 0-1.53.85z"/>',
    filter: '<path d="M4 5h16l-6.2 7.4V19l-3.6 2v-8.6z"/>',
    sort: '<path d="M7 4v16M7 20l-3-3M7 20l3-3"/><path d="M17 20V4M17 4l-3 3M17 4l3 3"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5"/>',
    logout: '<path d="M9.5 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.5"/><path d="m15.5 16.5 4.5-4.5-4.5-4.5"/><path d="M20 12H9.5"/>',

    // ── حالة ───────────────────────────────────────────────
    bell: '<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5z"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>',
    alert: '<path d="M12 3.5 2.7 19.5a1 1 0 0 0 .87 1.5h16.86a1 1 0 0 0 .87-1.5L12 3.5z"/><path d="M12 9.5v4.5"/><path d="M12 17.5h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4.5"/><path d="M12 8h.01"/>',
    shield: '<path d="M12 2.8 4.5 6v6c0 4.5 3.1 8.4 7.5 9.7 4.4-1.3 7.5-5.2 7.5-9.7V6z"/><path d="m9.2 12.2 2 2 3.6-3.8"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    zap: '<path d="M13.5 2.5 4 14h7l-.5 7.5L20 10h-7z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
    gauge: '<path d="M20.5 15a9 9 0 1 0-17 0"/><path d="m15 10-3.2 3.6a1.6 1.6 0 1 0 2.3 2.2z"/>',
    sparkles: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4L4.5 10.8 10.2 9z"/><path d="M19 3v3M20.5 4.5h-3"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 10h17"/><path d="M8.5 3v4M15.5 3v4"/>',
    message: '<path d="M20.5 12a8 8 0 0 1-8.5 8 9 9 0 0 1-3.6-.7L3.5 21l1.4-4.4A8 8 0 0 1 12 4a8 8 0 0 1 8.5 8z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    inbox: '<path d="M3.5 13.5h4l1.5 3h6l1.5-3h4"/><path d="M5.4 5.4 3.5 13.5V18a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4.5L18.6 5.4A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.4z"/>',
    database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
    power: '<path d="M12 3.5v8"/><path d="M7.2 6.6a8 8 0 1 0 9.6 0"/>',

    // ── واجهة ───────────────────────────────────────────────
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
    chevronLeft: '<path d="m14.5 5.5-6 6.5 6 6.5"/>',
    chevronRight: '<path d="m9.5 5.5 6 6.5-6 6.5"/>',
    chevronsRight: '<path d="m7 6 6 6-6 6"/><path d="m14 6 6 6-6 6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
    moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
    dots: '<circle cx="12" cy="5.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18.5" r="1.4"/>',
    logo: '<circle cx="12" cy="12.5" r="6.5"/><circle cx="12" cy="3.6" r="1.6"/>'
};

/**
 * @param {keyof typeof PATHS} name
 * @param {{size?: number, cls?: string, filled?: boolean}} [options]
 * @returns {string} SVG markup
 */
export function icon(name, { size, cls = '', filled = false } = {}) {
    const d = PATHS[name];
    if (!d) return '';
    const dims = size ? ` width="${size}" height="${size}"` : '';
    return `<svg viewBox="0 0 24 24"${dims} class="${cls}" fill="${filled ? 'currentColor' : 'none'}"`
        + ' stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"'
        + ` aria-hidden="true">${d}</svg>`;
}

export const iconNames = Object.keys(PATHS);
