/**
 * ui/app-shell.js — هيكل التطبيق: القائمة الجانبية، الشريط العلوي، التنقل
 * ============================================================
 * الشِل ده مسؤول عن حاجة واحدة: إن المستخدم يعرف هو فين، ويوصل لأي
 * قسم من غير ما يعيد تحميل الصفحة. مابيعرفش أي حاجة عن السيناريوهات
 * ولا المستخدمين ولا الإعدادات — بياخد وصف الأقسام وبيرجّع أحداث.
 *
 * ── ROUTING ──────────────────────────────────────────────────
 * `location.hash` هو مصدر الحقيقة (#/users مثلاً). ده بيخلي زرار
 * «رجوع» في المتصفح شغّال، والرابط قابل للمشاركة — واللوحة صفحة
 * واحدة، فمن غير كده كل تنقل بيبوّظ التاريخ.
 *
 * ── RTL ──────────────────────────────────────────────────────
 * القائمة على اليمين في العربي وعلى الشمال في الإنجليزي من غير أي
 * قاعدة خاصة: الشبكة بتستخدم أعمدة منطقية، والدرج بينزلق من الجهة
 * الصح لأن الترجمة نسبية للاتجاه.
 */
import { icon } from './icons.js';
import { esc } from './components.js';

const SIDEBAR_KEY = 'sie-admin-sidebar';

/**
 * @typedef {Object} ShellView
 * @property {string} id            معرّف القسم (= آخر الـhash)
 * @property {string} label         الاسم في القائمة
 * @property {string} iconName      أيقونة القائمة
 * @property {string} title         عنوان الصفحة في الشريط العلوي
 * @property {string} [desc]        سطر توضيحي تحت العنوان
 * @property {string} [group]       اسم مجموعة القائمة
 * @property {string} [searchId]    حقل البحث اللي زرار البحث بيركّز عليه
 * @property {boolean} [hidden]     قسم موجود بس مش في القائمة
 */

/**
 * @param {{views: ShellView[], onNavigate?: (view: ShellView, previousId: string|null) => void}} config
 */
export function createAppShell({ views, onNavigate }) {
    const shell = document.getElementById('appShell');
    const navHost = document.getElementById('sidebarNav');
    const pageTitle = document.getElementById('pageTitle');
    const pageDesc = document.getElementById('pageDesc');
    const crumbSection = document.getElementById('crumbSection');
    const searchBtn = document.getElementById('topSearchBtn');

    let currentId = null;

    /* ── القائمة الجانبية ─────────────────────────────────── */
    const groups = [];
    for (const view of views.filter((v) => !v.hidden)) {
        const name = view.group || '';
        const last = groups[groups.length - 1];
        if (last && last.name === name) last.items.push(view);
        else groups.push({ name, items: [view] });
    }

    navHost.innerHTML = groups.map((group) => `
        <div class="nav-group">
          ${group.name ? `<p class="nav-group-title">${esc(group.name)}</p>` : ''}
          <ul class="nav-list">
            ${group.items.map((view) => `
              <li>
                <a class="nav-item" href="#/${esc(view.id)}" data-view="${esc(view.id)}"
                   data-tip="${esc(view.label)}">
                  <span class="nav-icon">${icon(view.iconName)}</span>
                  <span class="nav-label">${esc(view.label)}</span>
                  <span class="nav-badge" data-nav-badge="${esc(view.id)}" hidden></span>
                </a>
              </li>`).join('')}
          </ul>
        </div>`).join('');

    /* ── التنقل ───────────────────────────────────────────── */
    function viewFromHash() {
        const id = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
        return views.find((v) => v.id === id) || views[0];
    }

    function activate(view, { push = false } = {}) {
        if (!view || view.id === currentId) {
            if (view && push) location.hash = `#/${view.id}`;
            return;
        }
        const previousId = currentId;
        currentId = view.id;

        document.querySelectorAll('[data-view-panel]').forEach((panel) => {
            panel.classList.toggle('is-active', panel.dataset.viewPanel === view.id);
        });
        navHost.querySelectorAll('.nav-item').forEach((item) => {
            const active = item.dataset.view === view.id;
            item.classList.toggle('is-active', active);
            if (active) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });

        pageTitle.textContent = view.title;
        pageDesc.textContent = view.desc || '';
        pageDesc.hidden = !view.desc;
        crumbSection.textContent = view.label;

        if (searchBtn) {
            searchBtn.hidden = !view.searchId;
            searchBtn.dataset.searchTarget = view.searchId || '';
        }

        closeMobileNav();
        // القسم الجديد لازم يبدأ من فوق: التمرير المتبقي من القسم اللي
        // قبله بيخلي الصفحة تفتح في نصّها.
        document.getElementById('pageScroll')?.scrollTo({ top: 0, behavior: 'auto' });
        if (push && location.hash !== `#/${view.id}`) location.hash = `#/${view.id}`;

        onNavigate?.(view, previousId);
    }

    navHost.addEventListener('click', (event) => {
        const link = event.target.closest('.nav-item');
        if (!link) return;
        event.preventDefault();
        activate(views.find((v) => v.id === link.dataset.view), { push: true });
    });

    window.addEventListener('hashchange', () => activate(viewFromHash()));

    /* ── طي القائمة (سطح المكتب) ──────────────────────────── */
    const collapseBtn = document.getElementById('sidebarToggle');
    const setCollapsed = (collapsed) => {
        shell.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
        collapseBtn?.setAttribute('aria-expanded', String(!collapsed));
        collapseBtn?.setAttribute('aria-label', collapsed ? 'وسّع القائمة' : 'اطوِ القائمة');
        try { localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded'); } catch { /* خصوصية */ }
    };
    let storedSidebar = null;
    try { storedSidebar = localStorage.getItem(SIDEBAR_KEY); } catch { /* خصوصية */ }
    setCollapsed(storedSidebar === 'collapsed');
    collapseBtn?.addEventListener('click', () => setCollapsed(shell.dataset.sidebar !== 'collapsed'));

    /* ── درج القائمة (الموبايل) ───────────────────────────── */
    const scrim = document.getElementById('navScrim');
    const menuBtn = document.getElementById('mobileNavToggle');

    function openMobileNav() {
        shell.dataset.nav = 'open';
        menuBtn?.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
        navHost.querySelector('.nav-item')?.focus({ preventScroll: true });
    }
    function closeMobileNav() {
        if (shell.dataset.nav !== 'open') return;
        shell.dataset.nav = 'closed';
        menuBtn?.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
    }
    menuBtn?.addEventListener('click', () =>
        (shell.dataset.nav === 'open' ? closeMobileNav() : openMobileNav()));
    scrim?.addEventListener('click', closeMobileNav);

    /* ── القوائم المنسدلة في الشريط العلوي ────────────────── */
    const popovers = [...document.querySelectorAll('[data-popover]')].map((popover) => ({
        popover,
        trigger: document.querySelector(`[data-popover-for="${popover.dataset.popover}"]`)
    }));

    function closePopovers(except = null) {
        for (const { popover, trigger } of popovers) {
            if (popover === except) continue;
            popover.hidden = true;
            trigger?.setAttribute('aria-expanded', 'false');
        }
    }

    for (const { popover, trigger } of popovers) {
        trigger?.addEventListener('click', (event) => {
            event.stopPropagation();
            const willOpen = popover.hidden;
            closePopovers(popover);
            popover.hidden = !willOpen;
            trigger.setAttribute('aria-expanded', String(willOpen));
            if (willOpen) popover.querySelector('button, a')?.focus({ preventScroll: true });
        });
        popover.addEventListener('click', (event) => {
            if (event.target.closest('.menu-item')) closePopovers();
        });
    }
    document.addEventListener('click', (event) => {
        if (!event.target.closest('[data-popover], [data-popover-for]')) closePopovers();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        closePopovers();
        closeMobileNav();
    });

    /* ── اختصارات لوحة المفاتيح ───────────────────────────── */
    const focusSearch = () => {
        const target = searchBtn?.dataset.searchTarget;
        if (!target) return false;
        const input = document.getElementById(target);
        if (!input) return false;
        input.focus();
        input.select?.();
        return true;
    };
    searchBtn?.addEventListener('click', focusSearch);

    document.addEventListener('keydown', (event) => {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName)
            || event.target?.isContentEditable;
        if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === '/') {
            if (focusSearch()) event.preventDefault();
        }
    });

    /* ── الوضع الفاتح/الداكن ──────────────────────────────── */
    const themeBtn = document.getElementById('themeToggleBtn');
    const paintThemeButton = () => {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (!themeBtn) return;
        themeBtn.innerHTML = icon(dark ? 'sun' : 'moon');
        themeBtn.setAttribute('aria-label', dark ? 'الوضع الفاتح' : 'الوضع الداكن');
        themeBtn.dataset.tip = dark ? 'الوضع الفاتح' : 'الوضع الداكن';
    };
    themeBtn?.addEventListener('click', () => {
        window.toggleSieAdminTheme?.();
        paintThemeButton();
    });
    paintThemeButton();

    /* ── الواجهة اللي بترجع للصفحة ────────────────────────── */
    return {
        /** يبدأ التنقل من الـhash الحالي (أو أول قسم). */
        start() { activate(viewFromHash()); },

        go(viewId) { activate(views.find((v) => v.id === viewId), { push: true }); },

        get current() { return currentId; },

        /** رقم صغير جنب اسم القسم — لعدد المسودات مثلاً. */
        setBadge(viewId, value, tone = 'neutral') {
            const el = navHost.querySelector(`[data-nav-badge="${viewId}"]`);
            if (!el) return;
            const show = Boolean(value);
            el.hidden = !show;
            el.textContent = show ? String(value) : '';
            el.className = `nav-badge nav-badge--${tone}`;
        },

        /**
         * تنبيهات النظام: بتتبني من الحالة الحقيقية (محرك متوقف، عملاء
         * مستنفدين، مسودات مستنية) — مفيش أي إشعار مخترع هنا.
         * @param {Array<{tone: string, title: string, body?: string, viewId?: string}>} alerts
         */
        setAlerts(alerts) {
            const list = document.getElementById('notifList');
            const dot = document.getElementById('notifDot');
            const count = document.getElementById('notifCount');
            if (!list) return;

            dot.hidden = alerts.length === 0;
            count.textContent = alerts.length ? String(alerts.length) : '';

            list.innerHTML = alerts.length === 0
                ? '<p class="notif-empty">مفيش حاجة محتاجة انتباهك دلوقتي.</p>'
                : alerts.map((alert) => `
                    <button type="button" class="notif-item" ${alert.viewId ? `data-goto="${esc(alert.viewId)}"` : ''}>
                      <span class="notif-dot notif-dot--${esc(alert.tone)}"></span>
                      <span class="notif-text">
                        <b>${esc(alert.title)}</b>
                        ${alert.body ? `<span class="sub">${esc(alert.body)}</span>` : ''}
                      </span>
                    </button>`).join('');

            list.querySelectorAll('[data-goto]').forEach((button) =>
                button.addEventListener('click', () => {
                    closePopovers();
                    activate(views.find((v) => v.id === button.dataset.goto), { push: true });
                }));
        }
    };
}
