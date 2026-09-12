import assert from "node:assert/strict";
import { deriveServiceRouteFromServiceTypes, SERVICE_TYPE_CODES, SERVICE_TYPE_LABELS } from "../src/domain/workflow/service-routes";

assert.deepEqual(SERVICE_TYPE_CODES, ["DIAGNOSTIC", "REPAIR", "BOTH"]);
assert.equal(SERVICE_TYPE_LABELS.DIAGNOSTIC, "Діагностика");
assert.equal(SERVICE_TYPE_LABELS.REPAIR, "Ремонт");
assert.equal(SERVICE_TYPE_LABELS.BOTH, "Діагностика + ремонт");

assert.equal(deriveServiceRouteFromServiceTypes(["DIAGNOSTIC"], "REPAIR"), "DIAGNOSTICS_ONLY");
assert.equal(deriveServiceRouteFromServiceTypes(["REPAIR"], "DIAGNOSTICS"), "REPAIR_ONLY");
assert.equal(deriveServiceRouteFromServiceTypes(["DIAGNOSTIC", "REPAIR"], "REPAIR"), "DIAGNOSTICS_TO_REPAIR");
assert.equal(deriveServiceRouteFromServiceTypes(["BOTH"], "REPAIR"), "DIAGNOSTICS_TO_REPAIR");
assert.equal(deriveServiceRouteFromServiceTypes([], "DIAGNOSTICS"), "DIAGNOSTICS_ONLY");
assert.equal(deriveServiceRouteFromServiceTypes([], "REPAIR"), "REPAIR_ONLY");

console.log("Service type contract smoke passed");
