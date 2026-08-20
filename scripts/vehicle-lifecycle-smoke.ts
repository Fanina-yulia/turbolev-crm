import { deriveVehicleLifecycle } from "../src/domain/vehicle-lifecycle";

function expect(input: Parameters<typeof deriveVehicleLifecycle>[0], code: string, flags: string[] = []) {
  const result = deriveVehicleLifecycle(input, new Date("2026-08-20T12:00:00.000Z"));
  if (!result) throw new Error(`Expected ${code}, got null`);
  if (result.code !== code) throw new Error(`Expected ${code}, got ${result.code}`);
  for (const flag of flags) if (!result.flags.includes(flag as never)) throw new Error(`Expected ${code} to include ${flag}`);
  return result;
}

expect({ appointmentStatus: "BOOKED", appointmentPlannedEndAt: "2026-08-21T12:00:00.000Z" }, "PLANNED");
expect({ appointmentStatus: "ARRIVED", diagnosticStatus: "PENDING" }, "IN_WORK");
expect({ diagnosticStatus: "IN_PROGRESS" }, "IN_WORK");
expect({ diagnosticStatus: "IN_PROGRESS", diagnosticReviewState: "SUBMITTED" }, "DIAGNOSTIC_COMPLETED", ["WAITING_MANAGER"]);
expect({ diagnosticStatus: "IN_PROGRESS", diagnosticReviewState: "SUBMITTED", diagnosticReviewerUserId: "manager-1" }, "MANAGER_REVIEW", ["WAITING_MANAGER"]);
expect({ diagnosticStatus: "CONFIRMED", diagnosticCardSent: true }, "CLIENT_DECISION", ["WAITING_CLIENT"]);
expect({ workOrderStatus: "PARTS_REVIEW" }, "PARTS_SELECTION");
expect({ workOrderStatus: "PARTS_REVIEW", appointmentStatus: "BOOKED", hasFutureBookedWork: true }, "PLANNED");
expect({ workOrderStatus: "WAITING_APPROVAL" }, "WAITING_APPROVAL", ["WAITING_CLIENT"]);
expect({ workOrderStatus: "WAITING_PARTS" }, "WAITING_PARTS");
expect({ workOrderStatus: "READY_FOR_REPAIR" }, "READY_FOR_REPAIR");
expect({ workOrderStatus: "IN_REPAIR" }, "IN_REPAIR");
expect({ workOrderStatus: "PAUSED" }, "IN_REPAIR", ["PAUSED", "NEEDS_ATTENTION"]);
expect({ workOrderStatus: "REWORK" }, "IN_REPAIR", ["REWORK", "NEEDS_ATTENTION"]);
expect({ workOrderStatus: "WAITING_QC" }, "QUALITY_CONTROL");
expect({ workOrderStatus: "WAITING_PAYMENT" }, "WAITING_PAYMENT");
expect({ workOrderStatus: "READY_FOR_PICKUP" }, "READY_FOR_PICKUP");
expect({ workOrderStatus: "CLOSED" }, "DELIVERED");
expect({ workOrderStatus: "CANCELLED" }, "CANCELLED");
expect({ appointmentStatus: "IN_REPAIR", appointmentPlannedEndAt: "2026-08-20T10:00:00.000Z" }, "IN_REPAIR", ["OVERDUE", "NEEDS_ATTENTION"]);
const delivered = expect({ workOrderStatus: "CLOSED", appointmentPlannedEndAt: "2026-08-19T10:00:00.000Z" }, "DELIVERED");
if (delivered.flags.includes("OVERDUE")) throw new Error("Delivered vehicle must not be overdue");

console.log("vehicle lifecycle smoke: OK");
