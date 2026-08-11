import assert from "node:assert/strict";
import { SIEQuotaService, quotaMetrics } from "../sie-quota-service.js";

const service = new SIEQuotaService();
const user = await service.getQuota("current-user");
assert.equal(user.total, 10_000_000);
assert.equal(user.used, 0);
assert.equal(user.remaining, 10_000_000);
assert.equal(user.percentage, 0);
assert.equal(user.status, "normal");

await service.addTokens("usr-1002", 500_000);
const extended = (await service.getUsersQuotas()).find((item) => item.userId === "usr-1002");
assert.equal(extended.total, 5_500_000);
assert.equal(extended.status, "warning");

await service.resetUsage("usr-1003");
const reset = (await service.getUsersQuotas()).find((item) => item.userId === "usr-1003");
assert.equal(reset.used, 0);
assert.equal(reset.status, "normal");
assert.equal(quotaMetrics({ total: 100, used: 100, disabled: false }).status, "exhausted");
assert.equal(quotaMetrics({ total: 100, used: 0, disabled: true }).status, "disabled");

console.log("SIE quota service tests passed");
