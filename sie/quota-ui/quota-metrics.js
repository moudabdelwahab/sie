export const quotaStatus = {
  normal: { label: "طبيعي", tone: "success" },
  warning: { label: "قريب من الحد", tone: "warning" },
  almost: { label: "شبه مستنفد", tone: "danger" },
  exhausted: { label: "مستنفد", tone: "danger" },
  disabled: { label: "معطل", tone: "neutral" },
  expired: { label: "انتهت الصلاحية", tone: "danger" },
  unavailable: { label: "غير مفعّل", tone: "neutral" },
};

export function quotaMetrics(access, tokensUsed = null) {
  if (!access) return { access: null, total: null, used: 0, remaining: null, percentage: 0, status: "unavailable", tokensUsed };
  const total = access.access_mode === "quota" ? Math.max(0, Number(access.message_quota) || 0) : null;
  const used = Math.max(0, Number(access.messages_used) || 0);
  const expired = access.access_mode === "expiration" && access.expires_at && new Date(access.expires_at).getTime() <= Date.now();
  const percentage = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const remaining = total === null ? null : Math.max(0, total - used);
  const status = !access.is_enabled ? "disabled" : expired ? "expired" : total !== null && used >= total ? "exhausted" : percentage >= 95 ? "almost" : percentage >= 80 ? "warning" : "normal";
  return { ...access, total, used, remaining, percentage, status, tokensUsed };
}
