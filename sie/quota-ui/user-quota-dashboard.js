import { sieQuotaService, quotaStatus } from "./sie-quota-service.js";
const number = new Intl.NumberFormat("en-US");
const date = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" });
const $ = (id) => document.getElementById(id);
const setText = (id, value) => $(id).textContent = value;
const toneClass = (tone) => `status-${tone}`;

async function render() {
  const quota = await sieQuotaService.getQuota();
  const state = quotaStatus[quota.status];
  setText("total", number.format(quota.total));
  setText("used", number.format(quota.used));
  setText("remaining", number.format(quota.remaining));
  setText("percentage", `${quota.percentage}%`);
  $("progress").style.width = `${quota.percentage}%`;
  $("progress").style.background = state.tone === "danger" ? "linear-gradient(90deg,#f97316,#dc2626)" : state.tone === "warning" ? "linear-gradient(90deg,#f59e0b,#ea580c)" : "linear-gradient(90deg,#4263eb,#6d5dfc)";
  const status = $("status"); status.textContent = state.label; status.className = `status-pill ${toneClass(state.tone)}`;
  setText("usage-copy", quota.disabled ? "تم تعطيل وصولك إلى SIE مؤقتًا." : quota.percentage === 0 ? "لم تُستخدم أي Tokens حتى الآن." : `استخدمت ${quota.percentage}% من إجمالي حصتك.`);
  setText("updated", `آخر تحديث: ${date.format(new Date(quota.updatedAt))}`);
}
render();
