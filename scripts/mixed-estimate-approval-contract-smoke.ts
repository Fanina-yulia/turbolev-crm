import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const scope = read("src/services/work-order-estimate-approval-scope.service.ts");
const service = read("src/services/mixed-estimate-approval.service.ts");
const route = read("app/api/work-orders/[id]/estimate/mixed-decision/route.ts");
const portal = read("src/services/client-portal-vehicle.service.ts");

assert.match(scope, /mixedPending/);
assert.match(scope, /decisionCount/);
assert.match(scope, /selectionMode/);
assert.match(service, /confirmMixedEstimateApproval/);
assert.match(service, /requestMixedEstimateRevision/);
assert.match(service, /status: "CANCELLED"/);
assert.match(service, /ensureEstimateSnapshotTx/);
assert.match(service, /pg_advisory_xact_lock/);
assert.match(route, /REQUEST_REVISION/);
assert.match(route, /PERMISSIONS\.WORK_ORDERS_ESTIMATE/);
assert.match(portal, /managerReviewRequired/);

console.log("mixed-estimate-approval-contract-smoke: ok");
