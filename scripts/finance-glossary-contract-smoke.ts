import assert from "node:assert/strict";
import { FINANCE_GLOSSARY } from "../src/domain/finance-glossary";

const required = [
  "currentCash",
  "revenue",
  "grossProfit",
  "grossMargin",
  "netProfit",
  "cashFlow",
  "receivables",
  "payables",
  "pnl",
  "minimumForecastCash",
  "breakEven",
  "profitability",
  "orderEconomics",
  "averageCheck",
  "duePayments",
  "paidToday",
  "overdueDebt",
  "paymentOutstanding",
] as const;

for (const key of required) {
  const entry = FINANCE_GLOSSARY[key];
  assert.ok(entry, `finance glossary must include ${key}`);
  assert.ok(entry.title.trim().length >= 2, `${key}: title is required`);
  assert.ok(entry.summary.trim().length >= 20, `${key}: summary must be meaningful`);
  assert.ok(entry.meaning.trim().length >= 20, `${key}: business meaning must be meaningful`);
  assert.ok(entry.source.trim().length >= 5, `${key}: source must be declared`);
}

assert.ok(Object.keys(FINANCE_GLOSSARY).length >= 30, "finance glossary should cover the core finance vocabulary");
assert.match(FINANCE_GLOSSARY.cashFlow.meaning, /не дорівнює прибутку/i);
assert.match(FINANCE_GLOSSARY.revenue.meaning, /не.*сум.*грош/i);
assert.match(FINANCE_GLOSSARY.receivables.meaning, /не є грошима/i);
assert.match(FINANCE_GLOSSARY.internalTransfer.meaning, /не є доходом або витратою/i);

console.log("finance-glossary-contract-smoke: ok");
