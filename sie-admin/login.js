/**
 * login.js — SIE admin sign-in (standalone)
 * ------------------------------------------------------------
 * Identical auth/authorization logic to the original sie-admin/login.js
 * (same is_chat_engine_staff()/is_sie_admin() checks via
 * sie-integration/sie-runtime.js, same fail-closed posture). The only
 * change: the Supabase client comes from ./supabase-client.js (a local
 * client pointed at the same project) instead of the platform's
 * /api-config.js, which isn't reachable from this origin.
 *
 * sie-integration/sie-runtime.js is imported with a relative path
 * on purpose — it lives in the same `sie` repo/deployment as this file,
 * so that import resolves fine on this origin. It's only imports that
 * reach OUTSIDE the `sie` repo (platform files) that needed replacing.
 */
import { supabase } from './supabase-client.js';
import { isCurrentUserEngineStaff, isCurrentUserSieAdmin } from '/sie-integration/sie-runtime.js';

const form = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const submitBtn = document.getElementById('submitBtn');
const alertBox = document.getElementById('authAlert');
const pwToggle = document.getElementById('pwToggle');

const SETTINGS_PAGE = './settings.html';
// Absolute URL on purpose: the platform's customer dashboard lives on a
// different origin than this standalone admin page, so a relative path
// here would 404 on THIS origin instead of reaching the real page.
// TODO: confirm this is the correct live platform domain.
const PLATFORM_HOME = 'https://mad3oom.online/customer-dashboard.html';

function showAlert(message, kind = 'error') {
    alertBox.textContent = message;
    alertBox.className = `auth-alert auth-alert--${kind}`;
    alertBox.hidden = false;
}

function clearAlert() {
    alertBox.hidden = true;
}

function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.querySelector('.btn-label').textContent = busy ? 'جارِ التحقق…' : 'تسجيل الدخول';
    submitBtn.querySelector('.spinner').hidden = !busy;
}

/**
 * A hung network request must not leave the button spinning forever with
 * no explanation — the user needs to know they can retry.
 */
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${label} استغرق وقتًا طويلًا. جرّب تاني.`)), ms)
        )
    ]);
}

/**
 * Decides where a signed-in user belongs. Staff and SIE admins reach the
 * settings page; everyone else goes back to the platform.
 */
async function routeAfterSignIn() {
    const [isStaff, isSieAdmin] = await Promise.all([
        isCurrentUserEngineStaff(supabase),
        isCurrentUserSieAdmin(supabase)
    ]);

    if (isStaff || isSieAdmin) {
        window.location.replace(SETTINGS_PAGE);
        return true;
    }

    // Signed in, but not authorized here. Sign back out so an unprivileged
    // session is not left sitting on an admin origin, then send them home.
    await supabase.auth.signOut();
    showAlert(
        'الحساب ده مش من فريق العمل، فمالوش وصول للوحة إعدادات المحرك. ' +
        'هنحوّلك لمنصة مدعوم…',
        'info'
    );
    setTimeout(() => window.location.replace(PLATFORM_HOME), 2200);
    return false;
}

/** Already signed in? Skip the form entirely. */
(async function resumeExistingSession() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            setBusy(true);
            await routeAfterSignIn();
            setBusy(false);
        }
    } catch {
        // A broken stored session is not worth surfacing — just show the form.
    }
})();

pwToggle.addEventListener('click', () => {
    const showing = passwordInput.type === 'text';
    passwordInput.type = showing ? 'password' : 'text';
    pwToggle.textContent = showing ? 'إظهار' : 'إخفاء';
    pwToggle.setAttribute('aria-label', showing ? 'إظهار كلمة المرور' : 'إخفاء كلمة المرور');
    passwordInput.focus();
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAlert();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        showAlert('اكتب البريد الإلكتروني وكلمة المرور.');
        return;
    }

    setBusy(true);
    try {
        const { error } = await withTimeout(
            supabase.auth.signInWithPassword({ email, password }),
            15000,
            'تسجيل الدخول'
        );

        if (error) {
            // Deliberately does not distinguish "no such account" from "wrong
            // password": telling them apart lets anyone probe which addresses
            // are registered.
            const message = /invalid login credentials/i.test(error.message || '')
                ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
                : /email not confirmed/i.test(error.message || '')
                    ? 'الحساب لسه مش مفعّل. راجع بريدك لتفعيل الحساب الأول.'
                    : `تعذّر تسجيل الدخول: ${error.message}`;
            showAlert(message);
            setBusy(false);
            return;
        }

        const routed = await routeAfterSignIn();
        if (!routed) setBusy(false);
    } catch (err) {
        showAlert(err?.message || 'حصل خطأ غير متوقع. جرّب تاني.');
        setBusy(false);
    }
});
