import { parseClientLookup, parseVinResponse } from "../app/new-request-wizard-v5.model";
import type { NewRequestClientLookupContract } from "../src/lib/contracts/new-request-wizard";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const full = parseClientLookup({
  id: "client_1",
  name: "Марія",
  phone: "+380671112233",
  vehicles: [
    {
      id: "vehicle_1",
      plateNumber: "AA1234BB",
      vin: "WVWZZZ1JZXW000001",
      brand: "Volkswagen",
      model: "Passat",
      year: 2018,
      mileageKm: 142000,
      engineName: "2.0 TDI",
      engineVolumeCm3: 1968,
      fuelType: "DIESEL",
      bodyType: "SEDAN",
      grossWeightKg: 2140,
      driveType: "FWD",
      vehicleType: "PASSENGER",
      turboLevClass: "L2",
      priceCoefficient: "1.10",
      classificationSource: "CRM",
      classificationConfidence: 95,
      manualClassOverride: false,
      vehicleDataSource: "MVS",
      vehicleDataConfidence: 90,
    },
  ],
});

assert(full !== null, "full client lookup should parse");
const typedFull: NewRequestClientLookupContract = full;
assert(typedFull.id === "client_1", "client id should be preserved");
assert(typedFull.vehicles.length === 1, "vehicle should be preserved");
assert(typedFull.vehicles[0].priceCoefficient === "1.10", "decimal price coefficient should be preserved");
assert(typedFull.vehicles[0].grossWeightKg === 2140, "lookup enrichment should be preserved");

const minimal = parseClientLookup({
  id: "client_2",
  name: null,
  phone: "+380671112244",
  vehicles: [{ id: "vehicle_2" }],
});

assert(minimal !== null, "minimal client lookup should parse");
assert(minimal.vehicles[0].plateNumber === null, "missing canonical vehicle fields should normalize to null");
assert(minimal.vehicles[0].priceCoefficient === null, "missing lookup price coefficient should normalize to null");
assert(minimal.vehicles[0].manualClassOverride === null, "missing manual override should normalize to null");

assert(
  parseClientLookup({ id: "client_bad", name: "Без телефону", vehicles: [] }) === null,
  "client lookup without phone should be rejected",
);

const registryVin = parseVinResponse({
  status: "FOUND",
  source: "MVS_INDEX",
  sourceDetail: "MVS_OPEN_DATA_COMPACT_BY_VIN_2021",
  confidence: 96,
  vehicle: {
    make: "VOLKSWAGEN",
    model: "PASSAT",
    year: 2004,
    engineVolumeL: 1.896,
    fuelType: "ДИЗЕЛЬНЕ ПАЛИВО",
  },
});
assert(registryVin?.vehicle?.make === "VOLKSWAGEN", "MVS VIN make should reach the wizard");
assert(registryVin.vehicle.model === "PASSAT", "MVS VIN model should reach the wizard");
assert(registryVin.source === "MVS_INDEX", "MVS VIN source should be preserved");

console.log("New request wizard contracts smoke: OK");
