import assert from "node:assert/strict";
import { buildBmVehicleFilter, buildBmVehicleFilterCandidates } from "@/src/services/suppliers/bm-parts.adapter";
import { buildModelScopedProviderVehicle, normalizeCatalogNumber, normalizePartPosition } from "@/src/services/parts-fitment.service";

const filter = buildBmVehicleFilter({
  brand: "GEELY",
  model: "EMGRAND X7",
});

assert.equal(filter, "GEELY>EMGRAND X7");
assert.equal(buildBmVehicleFilter({ brand: "LEXUS", model: "LEXUS ES350/300H" }), "LEXUS>ES350/300H");
assert.deepEqual(buildBmVehicleFilterCandidates({ brand: "LEXUS", model: "LEXUS ES350/300H" }), [
  "LEXUS>ES350/300H",
  "LEXUS>LEXUS ES350/300H",
]);
assert.equal(buildBmVehicleFilter({ brand: null, model: "EMGRAND X7" }), "");
assert.equal(normalizeCatalogNumber("  SOLGY-211125 "), "SOLGY211125");
assert.equal(normalizePartPosition("Амортизатор передній лівий"), "FRONT_LEFT");
assert.equal(normalizePartPosition("rear right"), "REAR_RIGHT");

const modelScoped = buildModelScopedProviderVehicle({
  vehicleId: "vehicle-1",
  brand: "BYD",
  model: "YUAN UP",
  year: 2025,
  vin: null,
});
assert.equal(modelScoped?.vehicleKey, "CRM:BYD:YUAN UP");
assert.equal(modelScoped?.source, "CRM_VEHICLE_MODEL_FILTER");
assert.equal(modelScoped?.exact, false);
assert.equal(buildModelScopedProviderVehicle({
  vehicleId: "vehicle-2",
  brand: null,
  model: "YUAN UP",
  year: 2025,
}), null);

console.log("Provider fitment contract smoke passed.");
