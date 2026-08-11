/**
 * SIEQuotaService — real frontend adapter.
 * Uses only existing tables and stable SIE runtime functions. No schemas,
 * RPCs, RLS policies, Edge Functions, or backend behavior are created here.
 */
import { supabase } from "/api-config.js";
import { adminResetUsage, adminSetAccess, getSieAccessStatus, isCurrentUserSieAdmin } from "/sie-integration/sie-runtime.js";
import { quotaMetrics, quotaStatus } from "./quota-metrics.js";

export { quotaMetrics, quotaStatus };

function friendlyError(error, fallback) {
  return new Error(error?.message || fallback);
}

function sumTokens(events) {
  return (events || []).reduce((sum, event) => sum + (Number(event.total_tokens) || 0), 0);
}

function withinTimeout(promise, milliseconds) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), milliseconds)),
  ]);
}

export class SIEQuotaService {
  constructor(client = supabase) { this.client = client; }

  async getCurrentUser() {
    const { data, error } = await this.client.auth.getUser();
    if (error) throw friendlyError(error, "تعذر قراءة جلسة المستخدم.");
    return data.user || null;
  }

  async getTokensUsed(userId) {
    const { data, error } = await this.client.from("ai_usage_events").select("total_tokens").eq("user_id", userId).limit(1000);
    if (error) return null; // Token events may intentionally be hidden by existing RLS.
    return sumTokens(data);
  }

  async getQuota(userId) {
    const current = userId || (await this.getCurrentUser())?.id;
    if (!current) return quotaMetrics(null, null);
    const [access, tokensUsed] = await Promise.all([getSieAccessStatus(this.client, current), this.getTokensUsed(current)]);
    return quotaMetrics(access, tokensUsed);
  }

  async getUsersQuotas() {
    const { data: accesses, error: accessError } = await this.client
      .from("customer_sie_access")
      .select("id,user_id,is_enabled,access_mode,message_quota,messages_used,expires_at,last_used_at,notes,updated_at")
      .order("updated_at", { ascending: false });
    if (accessError) throw friendlyError(accessError, "تعذر قراءة حصص SIE.");

    // الملفات وسجلات Tokens بيانات مساندة؛ لا يجب أن تمنع جدول الحصص إذا أخفاها RLS
    // أو تأخرت. جدول customer_sie_access هو مصدر البيانات الأساسي لهذه الصفحة.
    const [profilesResult, eventsResult] = await Promise.all([
      withinTimeout(this.client.from("profiles").select("id,full_name,email"), 4500),
      withinTimeout(this.client.from("ai_usage_events").select("user_id,total_tokens").limit(1000), 4500),
    ]);
    const profiles = profilesResult?.error ? [] : (profilesResult?.data || []);
    const events = eventsResult?.error ? [] : (eventsResult?.data || []);
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    const tokensByUser = new Map();
    for (const event of events) tokensByUser.set(event.user_id, (tokensByUser.get(event.user_id) || 0) + (Number(event.total_tokens) || 0));
    return (accesses || []).map((access) => ({
      ...quotaMetrics(access, eventsResult ? (tokensByUser.get(access.user_id) || 0) : null),
      user: profilesById.get(access.user_id) || { full_name: `مستخدم ${access.user_id.slice(0, 8)}`, email: "بيانات الملف غير متاحة" },
    }));
  }

  async getDashboardStats(existingRows) {
    const rows = existingRows || await this.getUsersQuotas();
    return {
      totalUsers: rows.length,
      quotaUsers: rows.filter((row) => row.total !== null).length,
      usedMessages: rows.reduce((sum, row) => sum + row.used, 0),
      remainingMessages: rows.reduce((sum, row) => sum + (row.remaining || 0), 0),
      nearLimit: rows.filter((row) => ["warning", "almost"].includes(row.status)).length,
      exhausted: rows.filter((row) => row.status === "exhausted").length,
      tokensUsed: rows.some((row) => row.tokensUsed === null) ? null : rows.reduce((sum, row) => sum + row.tokensUsed, 0),
    };
  }

  async getUsageLogs(userId) {
    const { data, error } = await this.client.from("ai_usage_events").select("request_id,source,mode,model_id,total_tokens,status,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(100);
    if (error) throw friendlyError(error, "لا تملك صلاحية قراءة سجلات Tokens لهذا المستخدم.");
    return data || [];
  }

  async canManageQuotas() { return isCurrentUserSieAdmin(this.client); }

  async saveAccess(userId, values) {
    const { error } = await adminSetAccess(this.client, {
      userId,
      isEnabled: values.isEnabled,
      accessMode: values.accessMode,
      messageQuota: values.accessMode === "quota" ? Number(values.messageQuota) || 0 : null,
      expiresAt: values.accessMode === "expiration" ? (values.expiresAt || null) : null,
      notes: values.notes || null,
    });
    if (error) throw error;
  }

  async resetUsage(userId) {
    const { error } = await adminResetUsage(this.client, userId);
    if (error) throw error;
  }
}

export const sieQuotaService = new SIEQuotaService();
