import assert from "node:assert/strict";
import { bmSearchMode, buildBmVehicleFilter, buildBmVehicleFilterCandidates, encodeBmCarFilter, rankBmModelNames } from "@/src/services/suppliers/bm-parts.adapter";
import { buildModelScopedProviderVehicle, normalizeCatalogNumber, normalizePartPosition } from "@/src/services/parts-fitment.service";
import { buildProviderPartQueryCandidates, resolvePartTerminology } from "@/src/services/parts-terminology.service";

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
assert.equal(encodeBmCarFilter("LEXUS>ES350/300H"), "LEXUS>ES350%2F300H");
assert.equal(bmSearchMode("Амортизатор передній"), "extended");
assert.equal(bmSearchMode("115906"), "strict");
assert.deepEqual(rankBmModelNames("ES350/300H", ["ES 300h (AVV60)", "RX 350", "ES 250"]), ["ES 300h (AVV60)", "ES 250"]);
assert.equal(buildBmVehicleFilter({ brand: null, model: "EMGRAND X7" }), "");
assert.equal(normalizeCatalogNumber("  SOLGY-211125 "), "SOLGY211125");
assert.equal(normalizePartPosition("Амортизатор передній лівий"), "FRONT_LEFT");
assert.equal(normalizePartPosition("rear right"), "REAR_RIGHT");

const wheelBearing = resolvePartTerminology({ query: "Підшипник ступиці передній", position: "FRONT" });
assert.equal(wheelBearing.definition?.code, "WHEEL_HUB_BEARING");
assert.deepEqual(wheelBearing.attributes, { axis: "FRONT", side: null, subPosition: null });

const hubAssembly = resolvePartTerminology({ query: "Ступиця в зборі" });
assert.equal(hubAssembly.definition?.code, "WHEEL_HUB_ASSEMBLY");

const rearControlArmBushing = resolvePartTerminology({ query: "Задній сайлентблок переднього важеля", position: "FRONT" });
assert.equal(rearControlArmBushing.definition?.code, "CONTROL_ARM_BUSHING");
assert.equal(rearControlArmBushing.attributes.axis, "FRONT");
assert.equal(rearControlArmBushing.attributes.subPosition, "REAR");

const bmQueries = buildProviderPartQueryCandidates({
  query: "Задній сайлентблок переднього важеля",
  provider: "BM_PARTS",
  position: "FRONT",
});
assert.equal(bmQueries[0], "Задній сайлентблок переднього важеля");
assert.equal(bmQueries[1], "задний сайлентблок переднего рычага");
assert.ok(bmQueries.some((query) => query.includes("сайлентблок переднего рычага задний")));

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
