import assert from "node:assert/strict";
import { quotaMetrics } from "../quota-metrics.js";

const normal = quotaMetrics({ is_enabled: true, access_mode: "quota", message_quota: 10, messages_used: 0 });
assert.equal(normal.total, 10);
assert.equal(normal.remaining, 10);
assert.equal(normal.status, "normal");
assert.equal(quotaMetrics({ is_enabled: true, access_mode: "quota", message_quota: 10, messages_used: 8 }).status, "warning");
assert.equal(quotaMetrics({ is_enabled: true, access_mode: "quota", message_quota: 10, messages_used: 10 }).status, "exhausted");
assert.equal(quotaMetrics({ is_enabled: false, access_mode: "unlimited", messages_used: 0 }).status, "disabled");
assert.equal(quotaMetrics(null).status, "unavailable");

console.log("SIE quota service tests passed");
