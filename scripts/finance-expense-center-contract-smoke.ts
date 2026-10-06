import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync("app/finance-expenses-v2.tsx", "utf8");
const inventory = readFileSync("src/services/finance-expense-center.service.ts", "utf8");
const route = readFileSync("app/api/finance/expense-center/route.ts", "utf8");
const supplierBridge = readFileSync("prisma/migrations/20260910110000_finance_supplier_payroll_bridge/migration.sql", "utf8");
const expenseService = readFileSync("src/services/finance-expenses.service.ts", "utf8");

for (const contract of [
  "Рух грошей",
  "Фінрезультат",
  "Закупили деталь",
  "Запас / актив, не P&amp;L-витрата",
  "Собівартість → COGS",
  "Гроші, заморожені в запасах",
  "Зобов'язання",
  "Зарплати",
]) {
  assert.ok(ui.includes(contract), `expense center UI must keep contract: ${contract}`);
}

assert.match(inventory, /reason"::text = 'RECEIPT'/, "inventory receipt must be measured separately");
assert.match(inventory, /reason"::text IN \('ISSUE','RESERVATION_CONSUME'\)/, "inventory issue must be measured separately");
assert.match(inventory, /LAST_FACTUAL_UNIT_COST/, "stock valuation method must stay explicit");
assert.match(route, /PERMISSIONS\.FINANCE_READ/, "expense-center inventory facts require finance read permission");
assert.match(supplierBridge, /SupplierOrder creates\/updates AP without P&L recognition/, "supplier purchase must remain AP/cash, not immediate P&L");
assert.match(supplierBridge, /PAYROLL_PERIOD_EMPLOYEE/, "closed payroll must keep canonical payroll source identity");
assert.match(expenseService, /sourceEntity: EXPENSE_PAYMENT_SOURCE/, "manual expense payment must be a cash fact");
assert.match(expenseService, /category\.pnlSection[\s\S]*financialEvent\.create/, "manual expense P&L recognition must remain category-driven");

console.log("[finance-expense-center] cash/P&L/inventory/payroll contracts OK");
