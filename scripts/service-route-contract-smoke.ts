import assert from "node:assert/strict";
import {
  deriveServiceRoute,
  requiredStagesForServiceRoute,
  SERVICE_ROUTE_KINDS,
  SERVICE_ROUTE_LABELS,
} from "@/src/domain/workflow";

assert.deepEqual(SERVICE_ROUTE_KINDS, ["DIAGNOSTICS_ONLY", "REPAIR_ONLY", "DIAGNOSTICS_TO_REPAIR"]);
assert.equal(SERVICE_ROUTE_LABELS.DIAGNOSTICS_ONLY, "Лише діагностика");
assert.equal(deriveServiceRoute({ hasDiagnostic: true, hasRepair: false }), "DIAGNOSTICS_ONLY");
assert.equal(deriveServiceRoute({ hasDiagnostic: false, hasRepair: true }), "REPAIR_ONLY");
assert.equal(deriveServiceRoute({ hasDiagnostic: true, hasRepair: true }), "DIAGNOSTICS_TO_REPAIR");

assert.deepEqual(requiredStagesForServiceRoute("DIAGNOSTICS_ONLY"), [
  "diagnostics",
  "diagnostic_confirmed",
  "diagnostic_card_final",
]);
assert.deepEqual(requiredStagesForServiceRoute("REPAIR_ONLY"), [
  "work_order",
  "repair_completed",
  "qc",
  "finance_actual",
  "payment",
  "closed",
]);
assert.equal(requiredStagesForServiceRoute("DIAGNOSTICS_TO_REPAIR").includes("estimate"), true);
assert.equal(requiredStagesForServiceRoute("DIAGNOSTICS_TO_REPAIR").includes("approval"), true);

console.log("Real service route contract smoke: OK");
