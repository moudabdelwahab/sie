/**
 * SIEQuotaService — Frontend-only adapter.
 * Replace only this class' methods with API calls when the backend contract is ready.
 */
const formatDate = (value) => new Date(value).toISOString();

const seedQuotas = [
  { id: "quota-current-user", userId: "current-user", user: { name: "أحمد محمد", email: "ahmed@example.com", initials: "أم" }, total: 10_000_000, used: 0, disabled: false, updatedAt: formatDate("2026-08-11") },
  { id: "quota-1", userId: "usr-1001", user: { name: "نورا خالد", email: "noura@acme.com", initials: "نك" }, total: 20_000_000, used: 16_700_000, disabled: false, updatedAt: formatDate("2026-08-10") },
  { id: "quota-2", userId: "usr-1002", user: { name: "سالم الشمري", email: "salem@orbit.sa", initials: "سش" }, total: 5_000_000, used: 4_820_000, disabled: false, updatedAt: formatDate("2026-08-10") },
  { id: "quota-3", userId: "usr-1003", user: { name: "ليان عبدالعزيز", email: "layan@north.io", initials: "لع" }, total: 2_000_000, used: 2_000_000, disabled: false, updatedAt: formatDate("2026-08-09") },
  { id: "quota-4", userId: "usr-1004", user: { name: "فهد العتيبي", email: "fahad@blue.dev", initials: "فع" }, total: 15_000_000, used: 3_250_000, disabled: false, updatedAt: formatDate("2026-08-09") },
  { id: "quota-5", userId: "usr-1005", user: { name: "ريم حمد", email: "reem@pixel.co", initials: "رح" }, total: 10_000_000, used: 1_200_000, disabled: true, updatedAt: formatDate("2026-08-08") },
];

const seedLogs = {
  "usr-1001": [
    { id: "req_9c7b", endpoint: "مساعد المحادثة / دعم الفوترة", tokens: 420000, status: "مكتمل", createdAt: "2026-08-10T13:20:00Z" },
    { id: "req_a2e4", endpoint: "تحليل نية العميل", tokens: 180000, status: "مكتمل", createdAt: "2026-08-10T10:48:00Z" },
    { id: "req_f7a1", endpoint: "اقتراح رد SIE", tokens: 375000, status: "مكتمل", createdAt: "2026-08-09T17:15:00Z" },
  ],
  "usr-1002": [
    { id: "req_1f3a", endpoint: "مساعد المحادثة / إلغاء اشتراك", tokens: 265000, status: "مكتمل", createdAt: "2026-08-10T11:42:00Z" },
    { id: "req_2b91", endpoint: "تحليل نية العميل", tokens: 120000, status: "مكتمل", createdAt: "2026-08-09T15:20:00Z" },
  ],
  "usr-1003": [
    { id: "req_70d2", endpoint: "مساعد المحادثة / تصعيد دعم", tokens: 410000, status: "مكتمل", createdAt: "2026-08-09T09:11:00Z" },
    { id: "req_5e8c", endpoint: "اقتراح رد SIE", tokens: 210000, status: "مكتمل", createdAt: "2026-08-08T16:32:00Z" },
  ],
};

const copy = (value) => JSON.parse(JSON.stringify(value));

export function quotaMetrics(quota) {
  const total = Math.max(0, Number(quota.total) || 0);
  const used = Math.min(total, Math.max(0, Number(quota.used) || 0));
  const percentage = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const remaining = Math.max(0, total - used);
  const status = quota.disabled ? "disabled" : percentage >= 100 ? "exhausted" : percentage >= 95 ? "almost" : percentage >= 80 ? "warning" : "normal";
  return { ...quota, total, used, remaining, percentage, status };
}

export const quotaStatus = {
  normal: { label: "طبيعي", tone: "success" },
  warning: { label: "قريب من الحد", tone: "warning" },
  almost: { label: "شبه مستنفد", tone: "danger" },
  exhausted: { label: "مستنفد", tone: "danger" },
  disabled: { label: "معطل", tone: "neutral" },
};

export class SIEQuotaService {
  constructor() {
    this.quotas = copy(seedQuotas);
    this.logs = copy(seedLogs);
  }

  async getQuota(userId = "current-user") {
    const quota = this.quotas.find((item) => item.userId === userId);
    return quotaMetrics(copy(quota || seedQuotas[0]));
  }

  async getUsersQuotas() {
    return this.quotas.map((item) => quotaMetrics(copy(item)));
  }

  async getDashboardStats() {
    const rows = await this.getUsersQuotas();
    return {
      totalUsers: rows.length,
      allocated: rows.reduce((sum, row) => sum + row.total, 0),
      used: rows.reduce((sum, row) => sum + row.used, 0),
      remaining: rows.reduce((sum, row) => sum + row.remaining, 0),
      nearLimit: rows.filter((row) => ["warning", "almost"].includes(row.status)).length,
      exhausted: rows.filter((row) => row.status === "exhausted").length,
    };
  }

  async updateQuota(userId, total) {
    const row = this.quotas.find((item) => item.userId === userId);
    if (!row) throw new Error("لم يتم العثور على المستخدم.");
    row.total = Math.max(row.used, Number(total) || 0);
    row.updatedAt = new Date().toISOString();
    return quotaMetrics(copy(row));
  }

  async addTokens(userId, tokens) {
    const row = this.quotas.find((item) => item.userId === userId);
    if (!row) throw new Error("لم يتم العثور على المستخدم.");
    row.total += Math.max(0, Number(tokens) || 0);
    row.updatedAt = new Date().toISOString();
    return quotaMetrics(copy(row));
  }

  async resetUsage(userId) {
    const row = this.quotas.find((item) => item.userId === userId);
    if (!row) throw new Error("لم يتم العثور على المستخدم.");
    row.used = 0;
    row.updatedAt = new Date().toISOString();
    this.logs[userId] = [];
    return quotaMetrics(copy(row));
  }

  async getUsageLogs(userId) {
    return copy(this.logs[userId] || []);
  }
}

export const sieQuotaService = new SIEQuotaService();
