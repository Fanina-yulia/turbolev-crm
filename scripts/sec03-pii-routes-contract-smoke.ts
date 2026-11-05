/**
 * SEC-03 static contract: every listed route must authenticate/authorize BEFORE touching data.
 * Run: npx tsx scripts/sec03-pii-routes-contract-smoke.ts
 * This is a source-level contract (no DB/session); behavioural coverage of the shared guard lives in sec:r1:smoke.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes: Array<{ file: string; method: string; permission: string; scoped?: boolean }> = [
  { file: "communications/[id]/link-client", method: "POST", permission: "COMMUNICATIONS_WRITE" },
  { file: "communications/[id]/messages/[messageId]/retry", method: "POST", permission: "COMMUNICATIONS_WRITE" },
  { file: "communications/attachments/[attachmentId]", method: "GET", permission: "COMMUNICATIONS_READ" },
  { file: "users/active", method: "GET", permission: "OVERVIEW_READ" },
  { file: "supplier-quotes", method: "GET", permission: "PROCUREMENT_READ" },
  { file: "vehicles/status-summary", method: "GET", permission: "CLIENTS_READ" },
  { file: "vehicles/[id]/appearance", method: "PATCH", permission: "CLIENTS_WRITE" },
  { file: "vehicles/[id]/image/render", method: "GET", permission: "OVERVIEW_READ" },
  { file: "vehicles/vin", method: "GET", permission: "OVERVIEW_READ" },
  { file: "vehicles/vin/batch", method: "POST", permission: "OVERVIEW_READ" },
  { file: "vehicles/lookup", method: "GET", permission: "OVERVIEW_READ" },
  { file: "vehicles/lookup-year", method: "GET", permission: "OVERVIEW_READ" },
  { file: "vehicles/catalog", method: "GET", permission: "OVERVIEW_READ" },
  { file: "vehicles/configurations", method: "GET", permission: "OVERVIEW_READ" },
  { file: "planner/availability", method: "GET", permission: "PLANNER_READ", scoped: true },
  { file: "planner/edit-context", method: "GET", permission: "PLANNER_READ", scoped: true },
];

for (const r of routes) {
  const src = readFileSync(`app/api/${r.file}/route.ts`, "utf8");
  const start = src.indexOf(`export async function ${r.method}(`);
  assert.ok(start >= 0, `${r.file}: ${r.method} handler missing`);
  const body = src.slice(start);
  const gateRe = r.scoped ? /await authorizeScopedLocation\(/ : /await authorize\(/;
  const gate = body.search(gateRe);
  assert.ok(gate >= 0, `${r.file}: no authorization gate`);
  assert.ok(body.includes(`PERMISSIONS.${r.permission}`), `${r.file}: expected PERMISSIONS.${r.permission}`);
  // the gate must be the first awaited call and must precede any data access / request parsing
  const firstAwait = body.search(/\bawait\b/);
  assert.equal(firstAwait, gate, `${r.file}: authorization gate is not the first await in the handler`);
  const early = body.slice(0, gate);
  assert.ok(!/request\.(json|formData|text)\(|getPrisma\(|getSqlPool\(|fetch\(/.test(early), `${r.file}: data access/body parse before gate`);
  assert.ok(/access\.(allowed|ok)/.test(body), `${r.file}: gate result not checked`);
  assert.ok(src.includes('strict: true') || r.scoped, `${r.file}: strict flag missing`);
}
// station isolation of edit-context
const ec = readFileSync("app/api/planner/edit-context/route.ts", "utf8");
assert.ok(ec.includes("...access.locationWhere"), "edit-context must filter appointments by allowed stations");
console.log(`SEC-03 batch-1 contract smoke passed (${routes.length} routes)`);
