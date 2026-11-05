/**
 * SEC-04 static contract: prices, settings, workflow and supplier-integration routes must
 * authenticate/authorize BEFORE touching data or parsing the body.
 * Run: npx tsx scripts/sec04-settings-routes-contract-smoke.ts
 * Source-level contract (no DB/session).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Gate = "settings" | "integrations" | "pricing" | "parts";
const routes: Array<{ file: string; methods: Array<{ method: string; write: boolean }>; gate: Gate }> = [
  { file: "settings/operations", gate: "settings", methods: [{ method: "GET", write: false }, { method: "POST", write: true }] },
  { file: "settings/work-prices/[id]", gate: "settings", methods: [{ method: "PUT", write: true }, { method: "PATCH", write: true }, { method: "DELETE", write: true }] },
  { file: "settings/work-prices/catalog", gate: "settings", methods: [{ method: "GET", write: false }, { method: "PATCH", write: true }, { method: "POST", write: true }] },
  { file: "settings/work-prices/export", gate: "settings", methods: [{ method: "GET", write: false }] },
  { file: "settings/work-prices/import", gate: "settings", methods: [{ method: "POST", write: true }] },
  { file: "workflow/presentation", gate: "settings", methods: [{ method: "GET", write: false }, { method: "PUT", write: true }, { method: "DELETE", write: true }] },
  { file: "workflow/statuses", gate: "settings", methods: [{ method: "GET", write: false }] },
  { file: "workflow/transition/validate", gate: "settings", methods: [{ method: "POST", write: false }] },
  { file: "suppliers/status", gate: "integrations", methods: [{ method: "GET", write: false }] },
  { file: "suppliers/test", gate: "integrations", methods: [{ method: "POST", write: false }] },
  { file: "work-prices", gate: "pricing", methods: [{ method: "GET", write: false }, { method: "POST", write: false }] },
  { file: "parts/free-catalog", gate: "parts", methods: [{ method: "GET", write: false }] },
];

const gateCall: Record<Gate, (write: boolean) => RegExp> = {
  settings: (write) => new RegExp(`await guardSettings\\(request, ${write}\\)`),
  integrations: () => /await guardIntegrations\(request\)/,
  pricing: () => /await guardPricingCalculator\(request\)/,
  parts: () => /await authorize\(PERMISSIONS\.PARTS_READ, \{ strict: true, request, minimumScope: "LOCATION" \}\)/,
};

let handlers = 0;
for (const route of routes) {
  const source = readFileSync(`app/api/${route.file}/route.ts`, "utf8");
  for (const { method, write } of route.methods) {
    const start = source.search(new RegExp(`export async function ${method}\\(`));
    assert.ok(start >= 0, `${route.file}: ${method} handler missing`);
    const next = source.slice(start + 10).search(/\nexport async function /);
    const body = next >= 0 ? source.slice(start, start + 10 + next) : source.slice(start);
    const gate = body.search(gateCall[route.gate](write));
    assert.ok(gate >= 0, `${route.file} ${method}: expected gate ${route.gate} (write=${write})`);
    const firstAwait = body.search(/\bawait\b/);
    assert.equal(firstAwait, gate, `${route.file} ${method}: authorization gate is not the first await`);
    const early = body.slice(0, gate);
    assert.ok(!/request\.(json|formData|text)\(|getPrisma\(|getSqlPool\(|fetch\(|\.query\(/.test(early), `${route.file} ${method}: data access/body parse before gate`);
    assert.ok(/(guard|access)\.(ok|allowed)/.test(body), `${route.file} ${method}: gate result not checked`);
    handlers += 1;
  }
}

// Guard module contract: reads need SETTINGS.READ, writes SETTINGS.WRITE, both global scope; supplier tools need SETTINGS.INTEGRATIONS.
const guard = readFileSync("src/security/settings-route-guard.ts", "utf8");
assert.ok(/write \? PERMISSIONS\.SETTINGS_WRITE : PERMISSIONS\.SETTINGS_READ/.test(guard), "guardSettings must map write->SETTINGS_WRITE, read->SETTINGS_READ");
assert.ok(guard.includes('minimumScope: "ALL"'), "settings guard must require ALL scope");
assert.ok(guard.includes("PERMISSIONS.SETTINGS_INTEGRATIONS"), "integrations guard must use SETTINGS_INTEGRATIONS");
assert.ok(guard.includes("PERMISSIONS.WORK_ORDERS_ESTIMATE") && guard.includes("PERMISSIONS.LEADS_WRITE"), "pricing calculator must stay available to estimate/lead staff");
assert.ok(!/MECHANIC|PERMISSIONS\.OVERVIEW_READ/.test(guard), "pricing calculator must not be opened to every staff member");

// Audit trail must name the real actor.
const catalog = readFileSync("app/api/settings/work-prices/catalog/route.ts", "utf8");
assert.ok(!catalog.includes('actorName: "CRM / Налаштування прайсу"'), "price catalog audit must use the session actor");

console.log(`SEC-04 contract smoke passed (${handlers} handlers in ${routes.length} routes)`);
