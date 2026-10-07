import assert from "node:assert/strict";
import fs from "node:fs";

const ui = fs.readFileSync("app/financial-center-legacy.tsx","utf8");
const controlUi = fs.readFileSync("app/financial-center-v3-control.tsx","utf8");
const service = fs.readFileSync("src/services/financial-center-v3-control.service.ts","utf8");
const financeCore = fs.readFileSync("src/services/financial-center-v2.service.ts","utf8");
const ownerCommand = fs.readFileSync("app/finance-owner-command-center.tsx","utf8");
const api = fs.readFileSync("app/api/finance/v2/route.ts","utf8");
const schema = fs.readFileSync("prisma/finance.prisma","utf8");
const migration = fs.readFileSync("prisma/migrations/20261006233000_financial_center_v3_cash_close/migration.sql","utf8");

assert.equal(/settings:\s*"Налаштування"/.test(ui), false, "Settings must not return to the main finance tab bar");
assert.match(ui,/FinanceContextKpis/);
assert.equal(/plan:\s*"План \/ факт"/.test(ui), false, "standalone Plan / fact tab must be removed");
assert.equal(/tab === "plan"/.test(ui), false, "Plan / fact must not render as a standalone screen");
assert.match(ui,/OwnerOverview/);
assert.match(ui,/Оборотка з послуг/);
assert.match(ui,/Маржа по деталях/);
assert.match(ui,/ЗП персоналу/);
assert.match(ui,/Валовий дохід/);
assert.match(ui,/Всі витрати/);
assert.match(ui,/Грошей у касі/);
assert.match(ui,/metric: "payroll" as FinanceDrilldownMetric/,"Payroll card must open payroll detail, not generic OPEX");
assert.match(ui,/metric: "totalExpenses" as FinanceDrilldownMetric/,"Total expenses card must open the same total-expense metric it displays");
assert.match(ui,/metric: "serviceTurnover" as FinanceDrilldownMetric/);
assert.match(ui,/metric: "partsMargin" as FinanceDrilldownMetric/);
assert.match(ui,/metric: "ownerGrossIncome" as FinanceDrilldownMetric/);
assert.match(ui,/metric: "ownerNetIncome" as FinanceDrilldownMetric/);
assert.match(ui,/Додаткові фінансові бюджети/,"standalone Plan / fact remains merged into Overview as supplementary budgets");
assert.equal(/data && <section className=\{styles\.kpiGrid\}>[\s\S]*currentCash/.test(ui), false, "global eight-KPI block must not be rendered outside tab context");
assert.match(ui,/tab !== "accounts"/,"Accounts must not inherit period controls");
assert.match(ui,/⚙ Налаштування/);
assert.match(ui,/financeTabsForPersona/);
assert.match(ui,/canSeeFullFinance/);
assert.match(ui,/\["overview", "cash", "debts", "accounts"\]/);
assert.match(ui,/\["overview", "cash", "debts", "profitability", "expenses", "accounts"\]/);
assert.match(ui,/FinanceOverviewControl/);
assert.match(ui,/FinanceAccrualBridge/);
assert.match(ui,/FinanceForecastReasons/);
assert.match(ui,/FinanceMarginControl/);
assert.match(ui,/FinanceProfitabilityHighlights/);
assert.match(ui,/FinanceCashClosePanel/);
assert.match(ui,/FinanceDrilldown/);
assert.match(ui,/Відкрити борги/);
assert.match(ui,/Відкрити правило/);
assert.match(ui,/v2Action\("SAVE_RECURRING"/);
assert.equal(/SAVE_РЕГУЛЯРНІ ОПЕРАЦІЇ/.test(ui),false,"technical API action names must never be translated");
assert.match(ui,/setSettingsHubOpen\(false\); setCategoryOpen\(true\)/);
assert.match(ui,/setSettingsHubOpen\(false\); setRecurringOpen\(true\)/);
assert.match(ui,/setSettingsHubOpen\(false\); setSettingsOpen\(true\)/);

for (const marker of [
  "Операційна картина",
  "ЗВІРКА ФІНАНСІВ",
  "Від послуги до грошей",
  "Маржа за напрямами",
  "План, факт і прогноз темпу",
  "Коли і чому зміниться залишок",
  "Звірити касу",
]) assert.match(controlUi,new RegExp(marker));

assert.match(controlUi,/persona === "CASHIER"/);
assert.match(controlUi,/persona === "STATION_MANAGER"/);
assert.match(controlUi,/const fullFinance = persona === "OWNER" \|\| persona === "FINANCE"/);
assert.match(controlUi,/if \(persona === "CASHIER" \|\| persona === "STANDARD"\) return null/);
assert.match(controlUi,/Net Cash Flow/);
assert.match(controlUi,/Очікувані надходження/);
assert.match(controlUi,/Майбутні виплати/);
assert.match(controlUi,/ЗП персоналу/);
assert.match(controlUi,/До виплати зараз/);
assert.match(controlUi,/ця сума завжди дорівнює картці на «Огляді»/);
assert.match(controlUi,/ownerNetIncome/);
assert.match(controlUi,/totalExpenses/);

assert.match(service,/getFinancialCenterV3Control/);
assert.match(service,/WALKIN_PAYMENT_WITHOUT_REVENUE/);
assert.match(service,/WALKIN_REVENUE_WITHOUT_RECEIVABLE/);
assert.match(service,/WALKIN_PAID_WITHOUT_CASH/);
assert.match(service,/OBLIGATION_STATE_MISMATCH/);
assert.match(service,/zonedDayRange/);
assert.match(service,/marginRow\("Діагностика"[\s\S]*false\)/);
assert.match(service,/closeFinanceCashDay/);
assert.match(service,/FINANCE_CASH_DAY_CLOSED/);
assert.match(service,/CASH_CLOSE_REASON_REQUIRED/);
assert.match(service,/acquireTransactionAdvisoryLock/);
assert.equal(/closeFinanceCashDay[\s\S]*cashTransaction\.create/.test(service),false,"cash close must never mutate ledger with an automatic cash transaction");

assert.match(financeCore,/const ownerSummary =/);
assert.match(financeCore,/payrollEmployees/);
assert.match(financeCore,/expenseBreakdown/);
assert.match(financeCore,/category\?\.code !== "COGS_PARTS"|partsCost/);
assert.match(financeCore,/payrollDue/);
assert.match(financeCore,/\"NET_INCOME\"/,"owner net-income plan must be accepted by finance budget service");
assert.match(financeCore,/metric === \"NET_INCOME\"/,"owner net-income budgets must use the authoritative owner summary actual");

assert.match(ownerCommand,/Скільки СТО реально заробило\?/);
assert.match(ownerCommand,/Де зараз гроші\?/);
assert.match(ownerCommand,/Кому ми винні\?/);
assert.match(ownerCommand,/Хто винен нам\?/);
assert.match(ownerCommand,/На чому заробляємо найбільше\?/);
assert.match(ownerCommand,/Чи вистачить грошей через 30 днів\?/);
assert.match(ownerCommand,/OWNER_PROFIT_PLAN_V2/);
assert.match(ownerCommand,/Місяць/);
assert.match(ownerCommand,/Квартал/);
assert.match(ownerCommand,/операційний внесок/);
assert.match(ownerCommand,/ЩО РОБИТИ ЗАРАЗ/);
assert.match(ownerCommand,/ЩО БУДЕ, ЯКЩО/);
assert.match(ui,/\/api\/management\/result/,"owner overview must reuse management intelligence for lift contribution and recommendations");
assert.match(ui,/OwnerProfitPlanDialog/);

assert.match(api,/getFinancialCenterV3Control/);
assert.match(api,/CLOSE_CASH_DAY/);
assert.match(api,/LOCATION_FORBIDDEN/);
assert.match(api,/financePersona/);
assert.match(api,/redactFinanceForPersona/);
assert.match(api,/isPayrollFinanceSource/);
assert.match(api,/STATION_MANAGER/);
assert.match(api,/CASHIER/);
assert.match(api,/grossProfit: 0/);
assert.match(api,/obligations,/);
assert.match(api,/ownerSummary: undefined/,"employee payroll drilldowns must be redacted from non-owner finance responses");

assert.match(schema,/model FinancialCashClose/);
assert.match(schema,/@@unique\(\[moneyAccountId, businessDate\]/);
assert.match(migration,/CREATE TABLE "FinancialCashClose"/);
assert.match(migration,/FOREIGN KEY \("moneyAccountId"\) REFERENCES "MoneyAccount"\("id"\)/);

console.log("[financial-center-v3] contextual KPI, drill-down, reconciliation, forecast, role and cash-close contracts OK.");
