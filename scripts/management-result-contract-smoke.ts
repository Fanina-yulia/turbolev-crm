import assert from "node:assert/strict";
import {
  allocateMoneyByWeight,
  gapToPlan,
  managementGrossFromSnapshot,
  planProgressPercent,
  weekKeys,
} from "@/src/domain/management-result";

const week = weekKeys("2026-09-17");
assert.equal(week.start, "2026-09-14");
assert.equal(week.end, "2026-09-20");
assert.equal(week.endExclusive, "2026-09-21");
assert.deepEqual(week.days, ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"]);

const equal = allocateMoneyByWeight(100_000, [{ id: "lift-1", weight: 1 }, { id: "lift-2", weight: 1 }]);
assert.deepEqual(equal, [{ id: "lift-1", amount: 50_000 }, { id: "lift-2", amount: 50_000 }]);
const uneven = allocateMoneyByWeight(100, [{ id: "a", weight: 1 }, { id: "b", weight: 2 }, { id: "c", weight: 3 }]);
assert.equal(uneven.reduce((sum, row) => sum + row.amount, 0), 100);

assert.equal(managementGrossFromSnapshot({ laborRevenue: 80_000, partsRevenue: 70_000, partsCost: 50_000 }), 100_000);
assert.equal(managementGrossFromSnapshot({ laborRevenue: 80_000, partsRevenue: 20_000, partsCost: 10_000, discountAmount: 10_000 }), 80_000);
assert.equal(managementGrossFromSnapshot({ laborRevenue: 80_000, partsRevenue: 20_000, externalRevenue: 50_000, partsCost: 10_000 }), 90_000);
assert.equal(planProgressPercent(50_000, 100_000), 50);
assert.equal(gapToPlan(100_000, 78_400), 21_600);
assert.equal(gapToPlan(100_000, 105_000), 0);

console.log("Management result contract smoke: OK");
