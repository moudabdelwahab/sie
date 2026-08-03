/**
 * theme-toggle.js — self-contained light/dark toggle for sie-admin
 * ------------------------------------------------------------
 * Standalone replacement for the platform's /theme-manager.js, which
 * isn't reachable from this origin. Runs synchronously (plain
 * <script>, not a module) so it sets data-theme before first paint —
 * same reasoning the platform version had, just reimplemented locally.
 * Persists the choice per-browser and falls back to the OS preference
 * on first visit.
 */
(function () {
    var KEY = 'sie-admin-theme';
    var stored = null;
    try {
        stored = localStorage.getItem(KEY);
    } catch (e) {
        // localStorage can throw in some privacy modes — fall back silently.
    }
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);

    window.toggleSieAdminTheme = function () {
        var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try {
            localStorage.setItem(KEY, next);
        } catch (e) {}
    };
})();
