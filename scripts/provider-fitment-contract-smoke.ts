import assert from "node:assert/strict";
import { buildBmVehicleFilter } from "@/src/services/suppliers/bm-parts.adapter";
import { normalizeCatalogNumber, normalizePartPosition } from "@/src/services/parts-fitment.service";

const filter = buildBmVehicleFilter({
  brand: "GEELY",
  model: "EMGRAND X7",
});

assert.equal(filter, "GEELY>EMGRAND X7");
assert.equal(buildBmVehicleFilter({ brand: null, model: "EMGRAND X7" }), "");
assert.equal(normalizeCatalogNumber("  SOLGY-211125 "), "SOLGY211125");
assert.equal(normalizePartPosition("Амортизатор передній лівий"), "FRONT_LEFT");
assert.equal(normalizePartPosition("rear right"), "REAR_RIGHT");

console.log("Provider fitment contract smoke passed.");
