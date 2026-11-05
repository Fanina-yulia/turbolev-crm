import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  compensationProjection,
  dailyBaseAmount,
  laborCompensation,
  minimumSalaryTopUp,
  partsCompensation,
  profitShareCompensation,
} from "../src/domain/compensation";

assert.equal(laborCompensation(7900, 30), 2370);
assert.equal(7900 - laborCompensation(7900, 30), 5530);

const parts = partsCompensation({
  sales: 10000,
  cost: 6000,
  salesPercent: 3,
  marginPercent: 10,
});
assert.deepEqual(parts, {
  sales: 10000,
  cost: 6000,
  margin: 4000,
  fromSales: 300,
  fromMargin: 400,
  total: 700,
});

assert.equal(profitShareCompensation(200000, 5), 10000);
assert.equal(profitShareCompensation(-1000, 5), 0);
assert.equal(minimumSalaryTopUp({ minimumSalary: 30000, earnedBeforeTopUp: 27400 }), 2600);
assert.equal(minimumSalaryTopUp({ minimumSalary: 30000, earnedBeforeTopUp: 32000 }), 0);
assert.equal(dailyBaseAmount(31000, 31), 1000);

const projection = compensationProjection({
  postedAccrued: 12000,
  postedBase: 5000,
  baseSalary: 15000,
  minimumSalary: 25000,
  estimatedProfitShare: 1000,
});
assert.deepEqual(projection, {
  postedAccrued: 12000,
  futureBase: 10000,
  estimatedProfitShare: 1000,
  estimatedMinimumTopUp: 2000,
  total: 25000,
});

const financeService = readFileSync(new URL("../src/services/financial-center-v2.service.ts", import.meta.url), "utf8");
assert.equal(financeService.includes("const completedFinancialLines"), false);
assert.equal(financeService.includes("take: 5000"), false);
assert.match(financeService, /FROM "WorkOrderLine" wol/);
assert.match(financeService, /FROM "ServiceAppointment" sa/);
assert.match(financeService, /FROM "EmployeeRoleAssignment" era/);

console.log("compensation-finance-contract-smoke: ok");
