import assert from "node:assert/strict";
import {
  APPOINTMENT_CANONICAL_STATUS_CODES,
  COMPATIBILITY_APPOINTMENT_STATUS_CODES,
  WORKFLOW_STATUS_CONTRACT_VERSION,
  appointmentLifecycleStatusAfterWorkOrder,
  deriveOperationalServiceState,
  getCanonicalWorkflowStatusCodes,
  isCanonicalWorkflowStatus,
  isCompatibilityWorkflowStatus,
} from "@/src/domain/workflow";

assert.equal(WORKFLOW_STATUS_CONTRACT_VERSION, "2.0.0");
assert.deepEqual(APPOINTMENT_CANONICAL_STATUS_CODES, ["RESERVE", "BOOKED", "ARRIVED", "NO_SHOW", "CANCELLED"]);
assert.equal(COMPATIBILITY_APPOINTMENT_STATUS_CODES.includes("IN_REPAIR"), true);
assert.equal(isCanonicalWorkflowStatus("APPOINTMENT", "ARRIVED"), true);
assert.equal(isCanonicalWorkflowStatus("APPOINTMENT", "IN_REPAIR"), false);
assert.equal(isCompatibilityWorkflowStatus("APPOINTMENT", "IN_REPAIR"), true);
assert.equal(isCanonicalWorkflowStatus("WORK_ORDER", "WAITING_PAYMENT"), true);
assert.equal(getCanonicalWorkflowStatusCodes("WORK_ORDER").includes("WAITING_PAYMENT"), true);

assert.deepEqual(
  deriveOperationalServiceState({
    appointmentStatus: "ARRIVED",
    diagnosticStatus: "CONFIRMED",
    workOrderStatus: "IN_REPAIR",
    purpose: "REPAIR",
  }),
  {
    code: "IN_REPAIR",
    label: "У ремонті",
    source: "WORK_ORDER",
    sourceStatus: "IN_REPAIR",
    compatibilityOnly: false,
  },
);

assert.equal(
  deriveOperationalServiceState({
    appointmentStatus: "BOOKED",
    purpose: "DIAGNOSTICS",
  }).code,
  "DIAGNOSTICS",
);
assert.equal(
  deriveOperationalServiceState({
    appointmentStatus: "IN_REPAIR",
    purpose: "REPAIR",
  }).compatibilityOnly,
  true,
);
assert.equal(appointmentLifecycleStatusAfterWorkOrder("IN_REPAIR"), null);
assert.equal(appointmentLifecycleStatusAfterWorkOrder("CLOSED"), "COMPLETED");
assert.equal(appointmentLifecycleStatusAfterWorkOrder("CANCELLED"), "CANCELLED");

console.log("Workflow status contract smoke: OK");
