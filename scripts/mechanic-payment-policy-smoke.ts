import assert from "node:assert/strict";
import { mechanicPaymentBlockReason } from "../src/domain/mechanic-payment-policy";

const standalone = {
  purpose: "DIAGNOSTICS", appointmentWorkOrderId: null, diagnosticWorkOrderId: null,
  requiresDiagnosticFirst: false, status: "WAITING_PAYMENT", locationId: "station-a",
  mechanicLocationId: "station-a", vehicleMatches: true,
};
for (const status of ["ARRIVED", "DIAGNOSTICS", "WAITING_PAYMENT"]) {
  assert.equal(mechanicPaymentBlockReason({ ...standalone, status }), null);
}
for (const change of [
  { purpose: "REPAIR" }, { purpose: null }, { appointmentWorkOrderId: "repair" },
  { diagnosticWorkOrderId: "repair" }, { requiresDiagnosticFirst: true },
  { status: "IN_REPAIR" }, { status: "WAITING_CALCULATION" }, { status: "COMPLETED" },
  { status: "CANCELLED" }, { locationId: "station-b" }, { vehicleMatches: false },
]) {
  assert.ok(mechanicPaymentBlockReason({ ...standalone, ...change }), JSON.stringify(change));
}
console.log("Mechanic payment policy: 3 allowed and 11 blocked scenarios passed.");
