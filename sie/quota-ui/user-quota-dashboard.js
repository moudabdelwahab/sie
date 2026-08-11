import { sieQuotaService, quotaStatus } from "./sie-quota-service.js";
const number = new Intl.NumberFormat("en-US"); const date = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }); const $ = (id) => document.getElementById(id); const set = (id, value) => $(id).textContent = value;
function displayed(value) { return value === null || value === undefined ? "غير محدد" : number.format(value); }
async function render() {
  try {
    const quota = await sieQuotaService.getQuota(); const state = quotaStatus[quota.status];
    set("total", displayed(quota.total)); set("used", number.format(quota.used)); set("remaining", displayed(quota.remaining)); set("percentage", quota.total === null ? "—" : `${quota.percentage}%`);
    $("progress").style.width = `${quota.total === null ? 0 : quota.percentage}%`;
    $("progress").style.background = state.tone === "danger" ? "linear-gradient(90deg,#f97316,#dc2626)" : state.tone === "warning" ? "linear-gradient(90deg,#f59e0b,#ea580c)" : "linear-gradient(90deg,#4263eb,#6d5dfc)";
    const status = $("status"); status.textContent = state.label; status.className = `status-pill status-${state.tone}`;
    set("usage-copy", quota.access ? (quota.tokensUsed === null ? "سجل Tokens غير متاح لصلاحية حسابك الحالية." : `Tokens المسجلة فعليًا: ${number.format(quota.tokensUsed)}.`) : "لا يوجد استحقاق SIE مفعّل لهذا الحساب.");
    set("updated", quota.updated_at ? `آخر تحديث: ${date.format(new Date(quota.updated_at))}` : "لا يوجد سجل حصة");
  } catch (error) { $("data-mode").textContent = "تعذر تحميل البيانات"; set("usage-copy", error.message || "تعذر قراءة الحصة الحالية."); }
}
render();
