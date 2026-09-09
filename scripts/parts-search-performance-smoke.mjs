import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = {
  client: await readFile(resolve(root, "app/parts-catalog.tsx"), "utf8"),
  route: await readFile(resolve(root, "app/api/parts/search/route.ts"), "utf8"),
  fitment: await readFile(resolve(root, "src/services/parts-fitment.service.ts"), "utf8"),
  registry: await readFile(resolve(root, "src/services/suppliers/registry.ts"), "utf8"),
  bm: await readFile(resolve(root, "src/services/suppliers/bm-parts.adapter.ts"), "utf8"),
  unitrade: await readFile(resolve(root, "src/services/suppliers/unique-trade.adapter.ts"), "utf8"),
};

const checks = [
  ["client uses one combined search", /includeSuppliers["']?,\s*["']1["']|params\.set\(["']includeSuppliers["'],\s*["']1["']\)/u.test(files.client)],
  ["client does not waterfall into supplier route", !files.client.includes("/api/parts/suppliers?")],
  ["combined route protects supplier access", /authorizeScopedLocation[\s\S]*includeSuppliers/u.test(files.route)],
  ["fitment cache exists", /FITMENT_CACHE_TTL_MS[\s\S]*fitmentInFlight/u.test(files.fitment)],
  ["fitment lookup shares in-flight promise", /const running = fitmentInFlight\.get\(key\)/u.test(files.fitment)],
  ["supplier adapter budget exists", /SUPPLIER_REQUEST_TIMEOUT_MS/u.test(files.registry)],
  ["supplier fan-out is settled", /Promise\.allSettled\(searchable\.map/u.test(files.registry)],
  ["BM vehicle queries are parallel and bounded", /MAX_VEHICLE_QUERY_CANDIDATES[\s\S]*Promise\.allSettled\(boundedFilters/u.test(files.bm)],
  ["BM HTTP timeout is bounded", /REQUEST_TIMEOUT_MS = 5_000/u.test(files.bm)],
  ["Unique Trade auth is deduplicated", /authenticationInFlight/u.test(files.unitrade)],
  ["Unique Trade HTTP timeout is bounded", /REQUEST_TIMEOUT_MS = 5_000/u.test(files.unitrade)],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (failed.length) process.exit(1);
console.log(`Parts search performance contract: PASS (${checks.length} checks)`);
