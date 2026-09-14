import assert from "node:assert/strict";
import {
  blendedHistoricalProbability,
  calculateStationManagerBonus,
  deriveManagementDeviations,
  gapClosingRecommendations,
  paceForecast,
  shiftAvailableMinutes,
  weightedPipelineForecast,
} from "@/src/domain/management-intelligence";

assert.equal(shiftAvailableMinutes({ status: "DAY_OFF", locationOpenMinute: 540, locationCloseMinute: 1080 }), 0);
assert.equal(shiftAvailableMinutes({ status: "ON_SHIFT", locationOpenMinute: 540, locationCloseMinute: 1080 }), 540);
assert.equal(shiftAvailableMinutes({ status: "PARTIAL_SHIFT", startMinute: 600, endMinute: 900, locationOpenMinute: 540, locationCloseMinute: 1080 }), 300);
assert.equal(paceForecast(50_000, 1_000, 2_000), 100_000);
assert.equal(weightedPipelineForecast(20_000, [{ status: "IN_REPAIR", amount: 50_000 }, { status: "WAITING_APPROVAL", amount: 10_000 }], { IN_REPAIR: 1, WAITING_APPROVAL: 0.5 }), 75_000);
const historical = blendedHistoricalProbability({ status: "WAITING_APPROVAL", completed: 8, eligible: 10, priorStrength: 10 });
assert.ok(historical > 0.7 && historical < 0.8);

const bonus = calculateStationManagerBonus({
  target: 100_000,
  fact: 110_000,
  breakEven: 70_000,
  scheme: { basis: "ABOVE_BREAK_EVEN", activationThresholdPct: 90, basePercent: 3, tier2ThresholdPct: 100, tier2Percent: 4, minMarginPct: 20, maxWarrantyRatePct: 10, minDataQualityPct: 85 },
  quality: { grossMarginPct: 35, warrantyRatePct: 2, overdueReceivablePct: 0, dataQualityPct: 96 },
});
assert.equal(bonus.activated, true);
assert.equal(bonus.qualityPass, true);
assert.equal(bonus.appliedPercent, 4);
assert.equal(bonus.basisAmount, 40_000);
assert.equal(bonus.payoutAmount, 1_600);

const blocked = calculateStationManagerBonus({
  target: 100_000,
  fact: 120_000,
  breakEven: 70_000,
  scheme: { basis: "ABOVE_BREAK_EVEN", activationThresholdPct: 90, basePercent: 5, maxWarrantyRatePct: 5 },
  quality: { grossMarginPct: 35, warrantyRatePct: 8, overdueReceivablePct: 0, dataQualityPct: 100 },
});
assert.equal(blocked.qualityPass, false);
assert.equal(blocked.payoutAmount, 0);

const deviations = deriveManagementDeviations({ target: 100_000, fact: 20_000, weightedForecast: 45_000, gap: 55_000, booked: 10, arrived: 5, noShow: 2, waitingApproval: 3, waitingParts: 2, unassignedActive: 1, activeMechanics: 2, averageMechanicUtilizationPct: 40, freeLiftHours: 12, warrantyRatePct: 7, partsMarginPct: 15, averageCheck: 3_000, previousAverageCheck: 4_000 });
assert.ok(deviations.some((row) => row.code === "BOOKING_ARRIVAL_CONVERSION"));
assert.ok(deviations.some((row) => row.code === "APPROVAL_DELAY"));
assert.ok(deviations.some((row) => row.code === "MECHANIC_UNDERLOAD"));
assert.ok(deviations.some((row) => row.code === "LOW_PARTS_MARGIN"));
assert.ok(gapClosingRecommendations(deviations, 55_000).length > 0);

console.log("Management intelligence contract smoke: OK");
