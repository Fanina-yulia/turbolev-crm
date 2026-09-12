import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const service = await readFile(join(process.cwd(), "src/services/finance-settlement.service.ts"), "utf8");
const schema = await readFile(join(process.cwd(), "prisma/finance-settlement.prisma"), "utf8");
const settlementsRoute = await readFile(join(process.cwd(), "app/api/finance/settlements/route.ts"), "utf8");
const payablesRoute = await readFile(join(process.cwd(), "app/api/finance/payables/route.ts"), "utf8");
const advancesRoute = await readFile(join(process.cwd(), "app/api/finance/advances/route.ts"), "utf8");

assert.match(schema, /model FinancialSettlement \{/);
assert.match(schema, /model FinancialSettlementAllocation \{/);
assert.match(schema, /FinancialSettlementType/);
assert.match(service, /postFinancialSettlement/);
assert.match(service, /reverseFinancialSettlement/);
assert.match(service, /receiveCustomerAdvance/);
assert.match(service, /applyCustomerAdvanceSettlement/);
assert.match(service, /refundCustomerAdvanceSettlement/);
assert.match(service, /pg_advisory_xact_lock/);
assert.match(service, /financialSettlementAllocation/);
assert.match(settlementsRoute, /PERMISSIONS\.FINANCE_WRITE/);
assert.match(settlementsRoute, /REVERSE/);
assert.match(payablesRoute, /direction: "PAYABLE"/);
assert.match(advancesRoute, /APPLY/);
assert.match(advancesRoute, /REFUND/);

console.log("finance-settlement-contract-smoke: ok");
