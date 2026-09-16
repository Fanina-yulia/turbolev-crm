import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function assertIncludes(path, needles) {
  const source = read(path);
  for (const needle of needles) {
    if (!source.includes(needle)) throw new Error(`[visit-finance] ${path} missing contract: ${needle}`);
  }
}
function assertExcludes(path, needles) {
  const source = read(path);
  for (const needle of needles) {
    if (source.includes(needle)) throw new Error(`[visit-finance] ${path} contains forbidden legacy behavior: ${needle}`);
  }
}

assertIncludes("src/services/visit-financial-state.service.ts", [
  'sourceEntity: "WALK_IN_DIAGNOSTIC"',
  'sourceEntity: "WALK_IN_DIAGNOSTIC_PAYMENT"',
  'direction: "RECEIVABLE"',
  'status: "POSTED"',
  'kind: "INFLOW"',
  'return "PREPAID"',
  'return "PARTIAL"',
  'return "PAID"',
  'SUSPENSION_MATRIX',
  "Do not\n  // manufacture an outstanding balance from an estimate",
]);
assertIncludes("app/api/vehicles/visit-financial-state/route.ts", [
  "PERMISSIONS.CLIENTS_READ",
  '"Cache-Control": "no-store"',
  "getVisitFinancialState",
]);
assertIncludes("app/planner-appointment-window-enhancer.tsx", [
  "/api/vehicles/visit-financial-state?appointmentId=",
  "Передплата",
  "Частково оплачено",
  "Нараховано",
  "Оплачено",
  "Залишок",
  'navigateCrm("Діагностика"',
]);
assertIncludes("app/vehicle-current-finance-card.tsx", [
  "/api/vehicles/visit-financial-state?vehicleId=",
  "Фінанси візиту",
  "Передплата",
  "Частково оплачено",
  "Остання оплата",
]);
assertIncludes("app/customer-cabinet-card.tsx", [
  "VehicleCurrentFinanceCard",
  "vehicleId ? <VehicleCurrentFinanceCard",
]);
assertIncludes("app/mechanic-walk-in-settlement.tsx", [
  "Що робимо з автомобілем?",
  "Завершити візит",
  "sendToRepairFlow",
  "setLocalData(next)",
]);
assertExcludes("app/mechanic-walk-in-settlement.tsx", [
  "window.setTimeout(() => (onFinished || onBack)(), 1800)",
  "Повертаю на головний екран…",
]);

console.log("[visit-finance] canonical Planner + Vehicle Card + prepayment + post-payment contracts OK");
