import assert from "node:assert/strict";
import {
  calculateEmployeeEconomics,
  calculateRequiredFte,
  calculateRoleStatus,
  findBreakEvenAt,
  splitByActualMinutes,
} from "../src/domain/employee-economics";

const mechanic = calculateEmployeeEconomics({
  fullCost: 45_000,
  directContribution: 81_000,
  managedValue: 200_000,
  influencedValue: 50_000,
  kpiScore: 92,
  capacityUtilization: 88,
});
assert.equal(mechanic.breakEvenPct, 180);
assert.equal(mechanic.roiPct, 80);
assert.equal(mechanic.status, "PROFITABLE");

const managedOnly = calculateEmployeeEconomics({
  fullCost: 55_000,
  directContribution: 20_000,
  managedValue: 500_000,
});
assert.equal(managedOnly.status, "BELOW_BREAK_EVEN");
assert.equal(managedOnly.roiPct, -63.64);

assert.equal(calculateRequiredFte(450, 150), 3);
assert.equal(calculateRequiredFte(300, 120), 2.5);
assert.equal(calculateRequiredFte(300, 0), null);

assert.equal(
  calculateRoleStatus({ actualFte: 3, requiredFte: 3.6, fullCost: 130_000, directContribution: 250_000 }),
  "CAPACITY_CONSTRAINED",
);

const split = splitByActualMinutes([
  { id: "ivan", minutes: 70 },
  { id: "petro", minutes: 50 },
]);
assert.deepEqual(split.map((item) => item.share), [0.5833, 0.4167]);

const breakEvenAt = findBreakEvenAt(45_000, [
  { occurredAt: "2026-08-05T12:00:00Z", attributionType: "DIRECT", economicValue: 12_000, additiveContribution: true },
  { occurredAt: "2026-08-08T12:00:00Z", attributionType: "MANAGED", economicValue: 100_000, additiveContribution: false },
  { occurredAt: "2026-08-11T12:00:00Z", attributionType: "DIRECT", economicValue: 20_000, additiveContribution: true },
  { occurredAt: "2026-08-13T12:00:00Z", attributionType: "DIRECT", economicValue: 14_000, additiveContribution: true },
]);
assert.equal(breakEvenAt?.toISOString(), "2026-08-13T12:00:00.000Z");

console.log("Employee economics smoke tests passed");
