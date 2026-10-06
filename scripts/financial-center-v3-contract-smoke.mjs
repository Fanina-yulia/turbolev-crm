import assert from "node:assert/strict";
import fs from "node:fs";

const center = fs.readFileSync("app/financial-center-legacy.tsx","utf8");
const panels = fs.readFileSync("app/financial-center-v3-panels.tsx","utf8");
const expenses = fs.readFileSync("app/finance-expenses-v2.tsx","utf8");
const css = fs.readFileSync("app/financial-center-v2.module.css","utf8");

assert.match(center,/const PRIMARY_TABS: Tab\[\] = \["overview", "pnl", "cash", "plan", "calendar", "debts", "profitability", "expenses", "accounts"\]/);
assert.equal(/PRIMARY_TABS[^\n]*settings/.test(center),false,"settings must not remain a primary finance tab");
assert.match(center,/⚙ Фінансові правила/);
assert.match(center,/const periodSensitive = tab !== "accounts" && tab !== "settings"/);
assert.match(center,/data && tab === "overview" && <section className=\{styles\.kpiGrid\}/);
assert.equal(/data && <section className=\{styles\.kpiGrid\}/.test(center),false,"global KPI grid must not render on every tab");
assert.match(center,/FinanceContextKpis/);
assert.match(center,/FinanceDrilldownModal/);
assert.match(center,/FinancialControlPanel/);
assert.match(center,/onSummary=\{setExpenseSummary\}/);
assert.match(center,/НАРАХОВАНО VS ОТРИМАНО/);
assert.match(center,/Прогноз за темпом/);
assert.match(center,/Через 7 днів/);
assert.match(center,/Через 30 днів/);
assert.match(center,/Постійні витрати не задані/);
assert.match(center,/Поточні залишки по рахунках і касах · не залежать від вибраного періоду/);

for (const token of ["tab === \"pnl\"","tab === \"cash\"","tab === \"plan\"","tab === \"calendar\"","tab === \"debts\"","tab === \"profitability\"","tab === \"expenses\""]) {
  assert.ok(panels.includes(token),`context KPI contract missing: ${token}`);
}
assert.match(panels,/if \(tab === "overview" \|\| tab === "accounts" \|\| tab === "settings"\) return null/);
assert.match(panels,/financialControlIssues/);
assert.match(panels,/COGS_ZERO/);
assert.match(panels,/FIXED_COSTS_ZERO/);
assert.match(panels,/NO_BUDGETS/);
assert.match(panels,/NO_RECURRING/);
assert.match(panels,/Різниця між P&L і Cash Flow сама по собі не є помилкою/);
assert.match(panels,/currentCash: "Звідки взявся поточний залишок"/);
assert.match(panels,/revenue: "Звідки взялася виручка"/);
assert.match(panels,/forecastMinimum: "Мінімальна точка прогнозу"/);

assert.match(expenses,/export type FinanceExpenseSummary/);
assert.match(expenses,/onSummary\?:/);
assert.match(expenses,/overdueOutstanding/);
assert.match(expenses,/pendingApprovalCount/);
assert.match(expenses,/\+ Додати витрату/);

assert.match(css,/\.contextKpiGrid/);
assert.match(css,/\.controlIssue/);
assert.match(css,/\.emptyAction/);
assert.match(css,/\.forecastReason/);

console.log("[financial-center-v3] contextual tabs, drilldowns, control checks, plan pace and forecast UX contracts OK.");
