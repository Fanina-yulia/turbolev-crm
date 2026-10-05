import assert from "node:assert/strict";
import fs from "node:fs";

const scope = fs.readFileSync("src/security/warranty-scope.ts","utf8");
const warranties = fs.readFileSync("app/api/warranties/route.ts","utf8");
const costs = fs.readFileSync("app/api/warranties/costs/route.ts","utf8");

assert.match(scope,/SELECT EXISTS/);
assert.match(scope,/ServiceAppointment/);
assert.match(scope,/findWarrantyLineIdsForRead/);
assert.match(scope,/Prisma\.join\(locationIds\)/);

assert.equal(/take:\s*5000/.test(warranties),false);
assert.equal(/distinct:\s*\["workOrderId"\]/.test(warranties),false);
assert.equal(/scopedWorkOrderIds/.test(warranties),false);
assert.match(warranties,/findWarrantyLineIdsForRead/);
assert.match(warranties,/canAccessWarrantyWorkOrder/);

assert.equal(/take:\s*10000/.test(costs),false);
assert.equal(/distinct:\s*\["workOrderId"\]/.test(costs),false);
assert.equal(/scopedWorkOrderIds/.test(costs),false);
assert.match(costs,/canAccessWarrantyWorkOrder/);

console.log("[warranty-scope] bounded SQL list scope and single-row authorization contracts OK.");
