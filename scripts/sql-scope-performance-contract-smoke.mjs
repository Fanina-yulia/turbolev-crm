import assert from "node:assert/strict";
import fs from "node:fs";

const scope = fs.readFileSync("src/security/work-order-scope.ts", "utf8");
const dashboard = fs.readFileSync("app/api/dashboard/route.ts", "utf8");
const attention = fs.readFileSync("src/services/station-vehicle-attention.service.ts", "utf8");
const analytics = fs.readFileSync("app/api/analytics/route.ts", "utf8");
const ownerFacts = fs.readFileSync("app/api/analytics/owner-dashboard-facts/route.ts", "utf8");
const workOrdersRoute = fs.readFileSync("app/api/work-orders/route.ts", "utf8");
const locationQueries = fs.readFileSync("src/services/location-work-order-query.service.ts", "utf8");
const financeCenter = fs.readFileSync("src/services/financial-center-v2.service.ts", "utf8");

assert.match(scope, /\$queryRaw/);
assert.match(scope, /EXISTS \(/);
assert.match(scope, /LIMIT \$\{limit\}/);
assert.equal(/serviceMechanic\.findMany/.test(scope), false);
assert.equal(/lead\.findMany/.test(scope), false);
assert.equal(/visibleIds\.includes\(workOrderId\)/.test(scope), false);
assert.match(scope, /workOrderId, limit: 1/);

assert.match(workOrdersRoute, /resolveVisibleWorkOrderIds[\s\S]*limit:/);
assert.match(workOrdersRoute, /status: canonicalStatus/);

assert.match(attention, /locationScope\?: string \| string\[\] \| null/);
assert.match(attention, /locationId: \{ in: locationIds \}/);
assert.match(dashboard, /listStationAttentionVehicles\(new Date\(\), scopedLocationIds\)/);
assert.equal(/diagnosticAssignment\.findMany/.test(dashboard), false);
assert.match(dashboard, /"DiagnosticAssignment"/);
assert.match(dashboard, /EXISTS \(/);

assert.equal(/const leadIds = leads\.map/.test(analytics), false);
assert.equal(/let scopedWorkOrderIds/.test(analytics), false);
assert.match(analytics, /COUNT\(DISTINCT l\."id"\)/);
assert.match(analytics, /findLocationScopedClosedWorkOrders/);
assert.match(analytics, /findLocationScopedCompletedLaborLines/);

assert.equal(/scopedWorkOrderRows/.test(ownerFacts), false);
assert.equal(/scopedWorkOrderIds/.test(ownerFacts), false);
assert.match(ownerFacts, /findLocationScopedOpenWorkOrderIds/);
assert.match(ownerFacts, /findLocationScopedClosedWorkOrders/);
assert.match(ownerFacts, /findLocationScopedClosedClientIdsBefore/);

assert.ok((locationQueries.match(/EXISTS \(/g) || []).length >= 4);
assert.match(locationQueries, /Prisma\.join/);

assert.equal(/const completedFinancialLines/.test(financeCenter), false);
assert.equal(/take:\\s*5000/.test(financeCenter), false);
assert.match(financeCenter, /FROM "WorkOrderLine" wol/);
assert.match(financeCenter, /FROM "ServiceAppointment" sa/);
assert.match(financeCenter, /FROM "EmployeeRoleAssignment" era/);

console.log("[sql-scope-hotpaths] EXISTS/JOIN scopes, bounded ID pages and location-first hot paths OK.");
