import assert from "node:assert/strict";
import fs from "node:fs";

const owner = fs.readFileSync("src/services/owner-analytics-economics.service.ts", "utf8");
const ltv = fs.readFileSync("src/services/customer-ltv.service.ts", "utf8");
const ltvRoute = fs.readFileSync("app/api/analytics/client-ltv/[clientId]/route.ts", "utf8");
const management = fs.readFileSync("src/services/management-result.service.ts", "utf8");
const locationQueries = fs.readFileSync("src/services/location-work-order-query.service.ts", "utf8");
const importer = fs.readFileSync("scripts/import-mvs-open-data.py", "utf8");
const generationCatalog = fs.readFileSync("src/services/vehicle-images/vehicle-generation-catalog.service.ts", "utf8");

assert.equal(/let scopedWorkOrderIds/.test(owner), false, "owner economics must not materialize all-time scoped WorkOrder IDs");
assert.match(owner, /findLocationScopedClosedWorkOrders/);
assert.match(owner, /locationIds:\s*input\.effectiveLocationIds/);

assert.match(ltv, /locationIds\?: string\[\] \| null/);
assert.match(ltv, /findLocationScopedClosedWorkOrdersForClients/);
assert.match(ltv, /locationIds\s*\?\s*findLocationScopedClosedWorkOrdersForClients/);

assert.equal(/scopedWorkOrderIds: string\[\] \| null/.test(ltvRoute), false, "client LTV route must not build an all-time WorkOrder ID list");
assert.equal(/distinct:\s*\["workOrderId"\]/.test(ltvRoute), false, "client LTV route must not distinct-load WorkOrder IDs");
assert.match(ltvRoute, /serviceAppointment\.findFirst/);
assert.match(ltvRoute, /locationIds:\s*unrestricted \? null : context\.locationIds/);

assert.equal(/let scopedWorkOrderIds/.test(management), false, "management result must not materialize all-time scoped WorkOrder IDs");
assert.match(management, /findLocationScopedClosedWorkOrders/);
assert.match(management, /findLocationScopedCashInflows/);

assert.match(locationQueries, /findLocationScopedClosedWorkOrdersForClients/);
assert.match(locationQueries, /findLocationScopedCashInflows/);
assert.ok((locationQueries.match(/EXISTS \(/g) || []).length >= 6, "location helpers must keep PostgreSQL EXISTS scopes");
assert.match(locationQueries, /Prisma\.join/);

assert.equal(
  /SELECT count\(\*\) FROM "VehicleRegistryCompact"/.test(importer),
  false,
  "MVS importer must not run an exact full-registry count after every imported year",
);
assert.match(importer, /compact registry updated/);

assert.match(generationCatalog, /pg_try_advisory_xact_lock/);
assert.match(generationCatalog, /vehicle-model-popularity-refresh/);
assert.match(generationCatalog, /ALREADY_RUNNING/);

console.log("[db-hotpaths] LTV/owner/management scopes, MVS import and registry refresh contracts OK.");
