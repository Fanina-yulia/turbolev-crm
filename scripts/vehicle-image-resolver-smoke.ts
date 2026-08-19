import assert from "node:assert/strict";
import { normalizeVehicleImageQuery } from "../src/services/vehicle-images/normalize-vehicle-query";
import { resolveVehicleImageColor } from "../src/services/vehicle-images/vehicle-color.service";
import { resolveImaginImage } from "../src/services/vehicle-images/imagin.provider";
import { vehicleImageSignature } from "../src/services/vehicle-images/vehicle-image-signature";
import type { VehicleImageProviderConfig } from "../src/services/vehicle-images/types";

const volvo = normalizeVehicleImageQuery({
  vehicleId: "volvo-1",
  make: "VOLVO",
  model: "XC 90",
  year: 2020,
  bodyType: "SUV",
  realColorName: null,
  realColorConfirmed: false,
});
assert(volvo, "Volvo query must normalize");
assert.equal(volvo.make, "volvo");
assert.equal(volvo.model, "xc90");
assert.equal(volvo.bodyType, "suv");

const config: VehicleImageProviderConfig = {
  provider: "IMAGIN",
  customerId: "test-customer",
  baseUrl: "https://cdn.imagin.studio",
  angle: "23",
  width: 400,
  fileType: "webp",
  colorMode: "AUTO",
  fallbackPaint: "Imagin-orange",
};

const themeColor = resolveVehicleImageColor(volvo, "AUTO", "Imagin-orange", config.fallbackPaint);
assert.equal(themeColor.paintId, "Imagin-orange");
assert.equal(themeColor.source, "THEME");

const render = resolveImaginImage(volvo, config, themeColor);
const url = new URL(render.sourceUrl);
assert.equal(url.origin, "https://cdn.imagin.studio");
assert.equal(url.pathname, "/getImage");
assert.equal(url.searchParams.get("make"), "volvo");
assert.equal(url.searchParams.get("modelFamily"), "xc90");
assert.equal(url.searchParams.get("modelYear"), "2020");
assert.equal(url.searchParams.get("angle"), "23");
assert.equal(url.searchParams.get("width"), "400");
assert.equal(url.searchParams.get("paintId"), "Imagin-orange");
assert(render.confidence >= 85, "Make/model/year render must meet minimum confidence");

const realVolvo = normalizeVehicleImageQuery({
  vehicleId: "volvo-1",
  make: "Volvo",
  model: "XC90",
  year: 2020,
  bodyType: "crossover",
  realColorName: "Crystal White Pearl",
  realPaintCode: "707",
  realColorHex: "#F4F4F1",
  realColorConfirmed: true,
});
assert(realVolvo);
const realColor = resolveVehicleImageColor(realVolvo, "AUTO", "Imagin-orange", config.fallbackPaint);
assert.equal(realColor.paintId, "707");
assert.equal(realColor.paintDescription, "Crystal White Pearl");
assert.equal(realColor.source, "REAL");

const themeSignature = vehicleImageSignature(volvo, config, themeColor);
const realSignature = vehicleImageSignature(realVolvo, config, realColor);
assert.notEqual(themeSignature, realSignature, "Color change must invalidate render signature");

const nextYear = normalizeVehicleImageQuery({ ...volvo, vehicleId: "volvo-1", make: "Volvo", model: "XC90", year: 2021 });
assert(nextYear);
assert.notEqual(vehicleImageSignature(nextYear, config, themeColor), themeSignature, "Year change must invalidate render signature");

console.log("vehicle image resolver smoke: OK");
