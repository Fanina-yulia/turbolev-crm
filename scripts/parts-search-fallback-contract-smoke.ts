import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const client = read("app/parts-catalog-legacy.tsx");
const registry = read("src/services/suppliers/registry.ts");
const selection = read("src/services/parts-selection.service.ts");
const knowledge = read("src/services/parts-knowledge.service.ts");
const build = read("scripts/build-production.mjs");
const spec = read("docs/TZ_PARTS_SEARCH_RECOVERY_V3.md");

assert.ok(client.includes('/api/parts/search?'), "picker must call the reference/fitment search route");
assert.ok(client.includes('/api/parts/suppliers?'), "picker must call supplier search after reference lookup");
assert.ok(!client.includes('if (vehicleScoped && resolvedFitment?.status !== "VERIFIED")'), "missing verified fitment must not hard-stop supplier API search");
assert.ok(client.includes("Supplier search is intentionally not blocked when exact OE fitment is missing"), "client must document non-blocking supplier fallback");
assert.ok(client.includes("manualConfirmation"), "manual confirmation gate must remain for unverified offers");
assert.ok(client.includes('offer.requiresManualConfirmation === true'), "offer-level compatibility review must remain enforced");

assert.ok(registry.includes('const useVehicleScopedSearch = vehicleScoped && context.fitmentStatus === "VERIFIED"'), "exact provider vehicle search must remain reserved for verified fitment");
assert.ok(registry.includes("otherwise run the\n  // ordinary article/name search"), "registry must explicitly fall back to ordinary supplier search");
assert.ok(registry.includes("blocked: false"), "supplier registry must not globally block fallback search");
assert.ok(registry.includes("bmPartsAdapter"), "BM Parts adapter must remain registered");
assert.ok(registry.includes("uniqueTradeAdapter"), "UniTrade adapter must remain registered");

assert.ok(selection.includes("MANUAL_CONFIRMATION") || selection.includes("manual"), "selection service must keep a manual compatibility gate");
assert.ok(knowledge.includes("export async function seedStaticPartKnowledge"), "canonical terminology seed must exist");
assert.ok(knowledge.includes("genericArticleAlias.upsert"), "canonical alias seed must be idempotent");
assert.ok(build.includes('run(["next", "build"]);'), "application build must complete before the production knowledge seed");
assert.ok(build.includes('run(["tsx", "scripts/parts-knowledge-seed.ts"]);'), "production release must seed canonical parts knowledge");
assert.ok(spec.includes("не створює `VehicleFitment`"), "spec must forbid fabricated fitment data");
assert.ok(spec.includes("search first, compatibility explicit"), "spec must define the non-blocking search principle");

console.log("Parts search fallback / canonical knowledge contract: PASS");
