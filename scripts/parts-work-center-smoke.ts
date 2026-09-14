import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const workspace = read("app/parts-catalog.tsx");
const legacy = read("app/parts-catalog-legacy.tsx");
const analyticsApi = read("app/api/analytics/parts/route.ts");
const procurementApi = read("app/api/procurement/route.ts");
const supplierPricing = read("src/services/suppliers/order.service.ts");
const spec = read("docs/TZ_PARTS_WORK_CENTER_V1.md");

assert.match(workspace, /type PartsView = "overview" \| "catalog" \| "analytics"/, "parts center must expose Overview/Catalog/Analytics modes");
assert.match(workspace, /\/api\/analytics\/parts/, "parts center must read canonical parts analytics");
assert.match(workspace, /\/api\/procurement/, "parts center must read the live procurement queue");
assert.match(workspace, /stockLedgerAvailable/, "parts center must respect stock-ledger availability");
assert.match(workspace, /LegacyPartsCatalog/, "existing diagnostic parts-selection flow must remain available");
assert.match(workspace, /navigateCrm\("Закупівлі та склад", \{ partsRequestId: card\.id \}\)/, "queue rows must drill into the exact PartsRequest");
assert.match(legacy, /\/api\/parts-selection\/select/, "legacy selection flow must still persist supplier selection");
assert.match(legacy, /Оригінали/, "legacy selection must retain OEM/original mode");
assert.match(legacy, /Аналоги/, "legacy selection must retain analog mode");
assert.match(analyticsApi, /prisma\.partsRequest\.findMany/, "analytics must be grounded in PartsRequest business facts");
assert.match(analyticsApi, /purchasePrice \* received/, "purchase value must be derived from received quantities");
assert.match(procurementApi, /requiredForRepair/, "procurement queue must expose repair-blocking part facts");
assert.match(supplierPricing, /const DEFAULT_MARKUP_PERCENT = 40/, "default supplier markup must remain 40 percent");
assert.match(spec, /жодних вигаданих/i, "spec must forbid fabricated KPIs");
assert.match(spec, /stockLedgerAvailable=false/, "spec must explicitly reject invented stock metrics without a ledger");

console.log("Parts work center / business-truth smoke: PASS");
