import assert from "node:assert/strict";
import {
  calculateCapacityUtilization,
  calculateEmployeeEconomics,
  calculateRequiredFte,
  calculateRoleStatus,
  findBreakEvenAt,
  splitByActualMinutes,
} from "../src/domain/employee-economics";

const mechanic = calculateEmployeeEconomics({
  economicsMode: "DIRECT_ROI",
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

const headOfSales = calculateEmployeeEconomics({
  economicsMode: "MANAGED_VALUE",
  fullCost: 55_000,
  directContribution: 20_000,
  managedValue: 500_000,
  kpiScore: 91,
  capacityUtilization: 86,
});
assert.equal(headOfSales.status, "EFFECTIVE");
assert.equal(headOfSales.roiPct, null);
assert.equal(headOfSales.breakEvenPct, null);

const accountant = calculateEmployeeEconomics({
  economicsMode: "SUPPORT_CAPACITY",
  fullCost: 35_000,
  directContribution: 0,
  kpiScore: 94,
  capacityUtilization: 82,
});
assert.equal(accountant.status, "EFFECTIVE");
assert.equal(accountant.roiPct, null);

const underloadedSupport = calculateEmployeeEconomics({
  economicsMode: "SUPPORT_CAPACITY",
  fullCost: 35_000,
  directContribution: 0,
  kpiScore: 95,
  capacityUtilization: 42,
});
assert.equal(underloadedSupport.status, "UNDERUTILIZED");

const weakLoadedSupport = calculateEmployeeEconomics({
  economicsMode: "SUPPORT_CAPACITY",
  fullCost: 35_000,
  directContribution: 0,
  kpiScore: 55,
  capacityUtilization: 88,
});
assert.equal(weakLoadedSupport.status, "NEEDS_ATTENTION");

assert.equal(calculateRequiredFte(450, 150), 3);
assert.equal(calculateRequiredFte(300, 120), 2.5);
assert.equal(calculateRequiredFte(300, 0), null);
assert.equal(calculateCapacityUtilization({ demand: 450, capacityPerFte: 150, actualFte: 3 }), 100);
assert.equal(calculateCapacityUtilization({ demand: 450, capacityPerFte: 150, actualFte: 4 }), 75);

assert.equal(
  calculateRoleStatus({
    economicsMode: "DIRECT_ROI",
    actualFte: 3,
    requiredFte: 3.6,
    fullCost: 130_000,
    directContribution: 250_000,
    utilizationPct: 120,
  }),
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
