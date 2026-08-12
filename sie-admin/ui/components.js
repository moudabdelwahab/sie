/**
 * ui/components.js — العناصر المشتركة للوحة SIE
 * ============================================================
 * الطبقة اللي بتمنع تكرار نفس الـUI في كل صفحة: التوستات، نوافذ
 * التأكيد، الترقيم، الحالات الفاضية، الهياكل العظمية، البادچات،
 * وتنسيق الأرقام والتواريخ.
 *
 * ── SCOPE ────────────────────────────────────────────────────
 * Presentation only. Nothing here talks to Supabase, reads a setting or
 * decides a permission — a component that knew about the engine would be
 * a component the next page cannot reuse.
 *
 * ── RETURN TYPES ─────────────────────────────────────────────
 * Builders return markup strings (the console renders with template
 * literals); controllers take a live element and wire behaviour to it.
 */
import { icon } from './icons.js';

/* ============================================================
   Escaping & formatting
   ============================================================ */

/** كل قيمة جاية من قاعدة البيانات بتعدي من هنا قبل ما تدخل الـHTML. */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * الأرقام بتتكتب بأرقام لاتينية جوه صفحة عربية — ده اللي فريق الدعم
 * بيقراه في قاعدة البيانات وفي أي تقرير، فتحويلها لأرقام هندية بيخلق
 * فرق بين الشاشة والمصدر.
 */
export const fmtNumber = (value) => Number(value ?? 0).toLocaleString('en-US');

const DATE_FMT = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    year: 'numeric', month: 'short', day: 'numeric'
});
const DATETIME_FMT = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
});

export function fmtDate(iso, { withTime = false } = {}) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return (withTime ? DATETIME_FMT : DATE_FMT).format(date);
}

/**
 * «من ساعتين» أوضح من تاريخ كامل لما يكون السؤال «ده حصل امتى تقريبًا»،
 * والتاريخ الكامل بيفضل موجود في الـtitle عشان اللي عايز الدقة.
 */
export function fmtRelative(iso) {
    if (!iso) return '—';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '—';

    const seconds = Math.round((Date.now() - then) / 1000);
    if (seconds < 60) return 'دلوقتي';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `من ${minutes} دقيقة`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `من ${hours} ساعة`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'إمبارح';
    if (days < 30) return `من ${days} يوم`;
    return fmtDate(iso);
}

/** أول حرفين من الاسم، أو من البريد لو مفيش اسم. */
export function initials(name, email = '') {
    const source = String(name || '').trim() || String(email || '').trim();
    if (!source) return '؟';
    const parts = source.replace(/[@._-]/g, ' ').split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '؟';
    if (parts.length === 1) return parts[0].slice(0, 2);
    return parts[0][0] + parts[1][0];
}

/* ============================================================
   Badges, meters, avatars
   ============================================================ */

/** @param {'neutral'|'primary'|'success'|'warning'|'danger'|'info'} tone */
export function badge(label, tone = 'neutral', { plain = false, iconName = null } = {}) {
    const glyph = iconName ? icon(iconName) : '';
    return `<span class="badge badge--${esc(tone)}${plain ? ' badge--plain' : ''}">${glyph}${esc(label)}</span>`;
}

/**
 * شريط نسبة. النسبة لوحدها مابتقولش «قرّب من الحد» — اللون هو اللي
 * بيقول، عشان كده الـtone مطلوب مش مشتق من الرقم هنا.
 */
export function meter(percent, tone = 'primary') {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    const cls = tone === 'primary' ? '' : ` is-${esc(tone)}`;
    return `<div class="meter" role="presentation"><div class="meter-fill${cls}" style="width:${clamped}%"></div></div>`;
}

export function avatar(name, email = '', { size = '' } = {}) {
    const cls = size ? ` avatar--${esc(size)}` : '';
    return `<span class="avatar${cls}" aria-hidden="true">${esc(initials(name, email))}</span>`;
}

/* ============================================================
   Empty / loading / error states
   ============================================================ */
export function emptyState({ iconName = 'inbox', title, text = '', action = '' }) {
    return `
      <div class="empty">
        <span class="empty-icon">${icon(iconName)}</span>
        <p class="empty-title">${esc(title)}</p>
        ${text ? `<p class="empty-text">${esc(text)}</p>` : ''}
        ${action || ''}
      </div>`;
}

export function errorState(message, { retryAttr = '' } = {}) {
    return `
      <div class="empty">
        <span class="empty-icon" style="background:var(--danger-soft);color:var(--danger-text)">${icon('alert')}</span>
        <p class="empty-title">مقدرناش نحمّل البيانات</p>
        <p class="empty-text">${esc(message)}</p>
        ${retryAttr ? `<button type="button" class="btn btn--secondary btn--sm" ${retryAttr}>${icon('refresh')} جرّب تاني</button>` : ''}
      </div>`;
}

/** صفوف وهمية بنفس شكل الجدول، بتتشال أول ما البيانات توصل. */
export function skeletonRows(rows = 5, cols = 5) {
    const cell = (i) => `<td><div class="skeleton skeleton-line" style="width:${i === 0 ? '70%' : '45%'}"></div></td>`;
    return Array.from({ length: rows }, () =>
        `<tr class="is-skeleton">${Array.from({ length: cols }, (_, i) => cell(i)).join('')}</tr>`).join('');
}

export function skeletonCards(count = 4) {
    return Array.from({ length: count }, () => `
      <div class="stat-card">
        <div class="skeleton skeleton-line" style="width:45%"></div>
        <div class="skeleton skeleton-line" style="width:60%;height:26px"></div>
        <div class="skeleton skeleton-line" style="width:35%"></div>
      </div>`).join('');
}

/* ============================================================
   Toasts
   ============================================================ */
const TOAST_ICON = { ok: 'checkCircle', err: 'alert', warn: 'alert', info: 'info' };

/**
 * @param {string} message
 * @param {'ok'|'err'|'warn'|'info'} [kind]
 */
export function toast(message, kind = 'ok') {
    const host = document.getElementById('toastHost');
    if (!host) return;

    const el = document.createElement('div');
    el.className = `toast toast--${kind}`;
    el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
    el.innerHTML = `${icon(TOAST_ICON[kind] || 'info')}<span>${esc(message)}</span>`;

    host.replaceChildren(el);
    clearTimeout(toast._timer);
    // الأخطاء بتقعد أطول: اللي بيقرا رسالة فشل محتاج وقت يفهمها.
    toast._timer = setTimeout(() => el.remove(), kind === 'err' ? 7000 : 4000);
}

/* ============================================================
   Dialogs — modal, drawer, confirmation
   ============================================================ */

/**
 * بيفتح `<dialog>` ويرجّع التركيز لمكانه بعد ما يتقفل.
 * الـ<dialog> نفسه بيتكفّل بحبس التركيز و Esc، فمفيش داعي نعيد تنفيذهم.
 */
export function openDialog(dialog) {
    if (!dialog || dialog.open) return;
    dialog._returnFocus = document.activeElement;
    dialog.showModal();
    // أول عنصر قابل للتركيز جوه الجسم، مش زرار «إغلاق» في الترويسة.
    const first = dialog.querySelector('.dialog-body [autofocus], .dialog-body input:not([type=hidden]):not([disabled]), .dialog-body select, .dialog-body textarea');
    if (first) first.focus({ preventScroll: true });
}

export function closeDialog(dialog) {
    if (!dialog?.open) return;
    dialog.close();
    if (dialog._returnFocus?.focus) dialog._returnFocus.focus({ preventScroll: true });
}

/**
 * حماية من الخروج بتغييرات مش متحفوظة.
 *
 * Esc on a <dialog> fires `cancel` before it closes, so this is the one
 * place that can stop a half-filled form from disappearing. The guard
 * asks; it never blocks silently.
 *
 * @param {HTMLDialogElement} dialog
 * @param {() => boolean} isDirty
 */
export function guardUnsaved(dialog, isDirty) {
    dialog.addEventListener('cancel', async (event) => {
        if (!isDirty()) return;
        event.preventDefault();
        const leave = await confirmAction({
            title: 'تسيب التغييرات؟',
            body: 'فيه تعديلات مااتحفظتش. لو قفلت دلوقتي هتضيع.',
            confirmLabel: 'اقفل من غير حفظ',
            tone: 'danger'
        });
        if (leave) closeDialog(dialog);
    });
}

/**
 * نافذة تأكيد حقيقية بدل confirm() المتصفح — عشان العمليات الحساسة
 * (تفعيل سيناريو، تصفير عدّاد، فك حظر) تبان بنفس لغة اللوحة وبنبرة
 * اللون الصح، ويكون واضح إيه اللي هيحصل بالظبط.
 *
 * @returns {Promise<boolean>}
 */
export function confirmAction({ title, body = '', confirmLabel = 'تأكيد', cancelLabel = 'إلغاء', tone = 'primary' }) {
    const dialog = document.getElementById('confirmDialog');
    if (!dialog) return Promise.resolve(window.confirm(`${title}\n${body}`));

    dialog.querySelector('[data-confirm-title]').textContent = title;
    dialog.querySelector('[data-confirm-body]').textContent = body;

    const okBtn = dialog.querySelector('[data-confirm-ok]');
    const cancelBtn = dialog.querySelector('[data-confirm-cancel]');
    okBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;
    okBtn.className = `btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}`;

    const iconBox = dialog.querySelector('[data-confirm-icon]');
    iconBox.className = `confirm-icon confirm-icon--${tone}`;
    iconBox.innerHTML = icon(tone === 'danger' ? 'alert' : 'info');

    return new Promise((resolve) => {
        const finish = (answer) => {
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            dialog.removeEventListener('close', onClose);
            closeDialog(dialog);
            resolve(answer);
        };
        const onOk = () => finish(true);
        const onCancel = () => finish(false);
        const onClose = () => finish(false);

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        dialog.addEventListener('close', onClose);
        openDialog(dialog);
        okBtn.focus({ preventScroll: true });
    });
}

/**
 * الضغط على الخلفية بيقفل النافذة — سلوك متوقع في كل SaaS، والـ
 * <dialog> لوحده مابيعملهوش.
 */
export function closeOnBackdrop(dialog, { guardDirty = null } = {}) {
    dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;      // نقرة جوه المحتوى
        if (guardDirty?.()) {
            // نفس مسار Esc، عشان الحماية تبقى واحدة.
            dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
            return;
        }
        closeDialog(dialog);
    });
}

/* ============================================================
   Pagination
   ============================================================ */

/**
 * أرقام الصفحات حوالين الصفحة الحالية، مع أول وآخر صفحة دايمًا.
 * كتالوج ٤٠٠ سيناريو = ١٦ صفحة، وطباعتهم كلهم بتحوّل العنصر لحيطة أرقام.
 */
export function pageWindow(current, pageCount) {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);

    const pages = new Set([1, pageCount, current, current - 1, current + 1]);
    const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);

    const withGaps = [];
    sorted.forEach((page, i) => {
        if (i > 0 && page - sorted[i - 1] > 1) withGaps.push('…');
        withGaps.push(page);
    });
    return withGaps;
}

/**
 * @param {HTMLElement} host
 * @param {{page: number, pageCount: number, onSelect: (page: number) => void}} options
 */
export function renderPager(host, { page, pageCount, onSelect }) {
    if (!host) return;
    if (pageCount <= 1) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;

    const step = (label, target, disabled, glyph) =>
        `<button type="button" class="pager-btn" data-page="${target}" ${disabled ? 'disabled' : ''}
                 aria-label="${esc(label)}">${icon(glyph, { cls: 'icon-flip' })}</button>`;

    host.innerHTML = [
        step('الصفحة السابقة', page - 1, page === 1, 'chevronRight'),
        ...pageWindow(page, pageCount).map((p) => p === '…'
            ? '<span class="pager-gap">…</span>'
            : `<button type="button" class="pager-btn ${p === page ? 'is-current' : ''}" data-page="${p}"${p === page ? ' aria-current="page"' : ''}>${p}</button>`),
        step('الصفحة التالية', page + 1, page === pageCount, 'chevronLeft')
    ].join('');

    host.querySelectorAll('[data-page]').forEach((button) =>
        button.addEventListener('click', () => onSelect(Number(button.dataset.page))));
}

/* ============================================================
   Misc helpers
   ============================================================ */

/** زرار بيوقف عن الشغل ويورّي مؤشر أثناء عملية شبكة. */
export async function withBusy(button, task) {
    if (!button) return task();
    const wasDisabled = button.disabled;
    button.dataset.busy = 'true';
    button.disabled = true;
    try {
        return await task();
    } finally {
        delete button.dataset.busy;
        button.disabled = wasDisabled;
    }
}

/** بحث بيستنى الكتابة تهدى — الجداول الكبيرة مابتترسمش على كل حرف. */
export function debounce(fn, wait = 180) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}
