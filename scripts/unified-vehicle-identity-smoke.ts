import assert from "node:assert/strict";
import { parseVehicleIdentityInput } from "@/src/lib/vehicle-identity";
import { resolveUnifiedVehicleIdentity } from "@/src/services/vehicle-lookup-unified.service";

const vin = "WVWZZZ1JZXW000001";

const parsedPlate = parseVehicleIdentityInput("КА 7584 СІ");
assert.equal(parsedPlate.type, "PLATE");
assert.equal(parsedPlate.normalized, "KA7584CI");
assert.equal(parsedPlate.masked, "KA••••CI");

const parsedVin = parseVehicleIdentityInput(vin);
assert.equal(parsedVin.type, "VIN");
assert.equal(parsedVin.normalized, vin);
assert.match(parsedVin.masked, /^WVW•+0001$/);

assert.throws(() => parseVehicleIdentityInput("123"), /державний номер або VIN/);

let plateLookupCalls = 0;
let vinDecodeCalls = 0;
const plateThenVin = await resolveUnifiedVehicleIdentity(
  "КА 7584 СІ",
  {},
  {
    lookupByPlate: (async () => {
      plateLookupCalls += 1;
      return {
        status: "FOUND",
        lookupLevel: "CRM",
        plate: "KA7584CI",
        vehicle: {
          id: "internal-vehicle-id",
          clientId: "private-client-id",
          clientName: "PRIVATE NAME",
          clientPhone: "+380000000000",
          vin,
          make: "VOLKSWAGEN",
          model: "PASSAT",
          year: 2018,
          mileageKm: 120000,
          engine: "2.0 TDI",
          engineVolumeCm3: 1968,
          engineVolumeL: 1.968,
          fuelType: "DIESEL",
          bodyType: "SEDAN",
          grossWeightKg: null,
          driveType: "FWD",
          vehicleType: "PASSENGER",
          turboLevClass: "STANDARD",
          turboLevClassLabel: "STANDARD",
          priceCoefficient: 1,
          classificationSource: "CRM",
          classificationConfidence: 100,
          classificationReason: "fixture",
          manualClassOverride: false,
          vehicleDataSource: "CRM",
          vehicleDataConfidence: 100,
        },
      };
    }) as any,
    decodeVin: (async (inputVin: string) => {
      vinDecodeCalls += 1;
      assert.equal(inputVin, vin);
      return {
        status: "FOUND",
        vin,
        source: "CACHE",
        sourceDetail: "VIN_CACHE_FIXTURE",
        confidence: 97,
        fieldConfidence: {},
        validation: {},
        warning: null,
        cached: true,
        vehicle: {
          vin,
          wmi: "WVW",
          region: "EUROPE",
          make: "VOLKSWAGEN",
          model: "PASSAT",
          year: 2018,
          trim: null,
          series: null,
          bodyType: "SEDAN",
          vehicleType: "PASSENGER",
          engine: "2.0 TDI",
          engineVolumeL: 1.968,
          cylinders: 4,
          fuelType: "DIESEL",
          secondaryFuelType: null,
          driveType: "FWD",
          transmission: "AUTOMATIC",
          plantCountry: null,
          plantCompany: null,
          manufacturer: "VOLKSWAGEN",
        },
      };
    }) as any,
  } as any,
);

assert.equal(plateLookupCalls, 1);
assert.equal(vinDecodeCalls, 1);
assert.equal(plateThenVin.inputType, "PLATE");
assert.equal(plateThenVin.state, "PARTIAL");
assert.equal(plateThenVin.vinAvailable, true);
assert.equal(plateThenVin.exactFitmentReady, false);
assert.equal(plateThenVin.vehicle?.model, "PASSAT");
assert.ok(!JSON.stringify(plateThenVin).includes(vin), "public result must not contain full VIN");
assert.ok(!JSON.stringify(plateThenVin).includes("PRIVATE NAME"), "public result must not contain client name");
assert.ok(!JSON.stringify(plateThenVin).includes("private-client-id"), "public result must not contain clientId");
assert.ok(!JSON.stringify(plateThenVin).includes("+380000000000"), "public result must not contain client phone");

const plateWithoutVin = await resolveUnifiedVehicleIdentity(
  "AA1234BC",
  {},
  {
    lookupByPlate: (async () => ({
      status: "FOUND",
      lookupLevel: "MVS_INDEX",
      plate: "AA1234BC",
      vehicle: {
        id: null,
        clientId: null,
        clientName: null,
        clientPhone: null,
        vin: null,
        make: "SKODA",
        model: "OCTAVIA",
        year: 2017,
        mileageKm: null,
        engine: "1.6 TDI",
        engineVolumeCm3: 1598,
        engineVolumeL: 1.598,
        fuelType: "DIESEL",
        bodyType: null,
        grossWeightKg: null,
        driveType: null,
        vehicleType: "PASSENGER",
        turboLevClass: "STANDARD",
        turboLevClassLabel: "STANDARD",
        priceCoefficient: 1,
        classificationSource: "MVS_INDEX+RULES",
        classificationConfidence: 90,
        classificationReason: "fixture",
        manualClassOverride: false,
        vehicleDataSource: "MVS_INDEX",
        vehicleDataConfidence: 90,
      },
    })) as any,
    decodeVin: (async () => {
      throw new Error("must not decode without VIN");
    }) as any,
  } as any,
);
assert.equal(plateWithoutVin.state, "PARTIAL");
assert.equal(plateWithoutVin.needsVin, true);
assert.equal(plateWithoutVin.exactFitmentReady, false);

const conflict = await resolveUnifiedVehicleIdentity(
  "AA1234BC",
  {},
  {
    lookupByPlate: (async () => ({
      status: "FOUND",
      lookupLevel: "MVS_INDEX",
      plate: "AA1234BC",
      vehicle: {
        id: null,
        clientId: null,
        clientName: null,
        clientPhone: null,
        vin,
        make: "SKODA",
        model: "OCTAVIA",
        year: 2017,
        mileageKm: null,
        engine: "1.6 TDI",
        engineVolumeCm3: 1598,
        engineVolumeL: 1.598,
        fuelType: "DIESEL",
        bodyType: "WAGON",
        grossWeightKg: null,
        driveType: "FWD",
        vehicleType: "PASSENGER",
        turboLevClass: "STANDARD",
        turboLevClassLabel: "STANDARD",
        priceCoefficient: 1,
        classificationSource: "MVS_INDEX+RULES",
        classificationConfidence: 90,
        classificationReason: "fixture",
        manualClassOverride: false,
        vehicleDataSource: "MVS_INDEX",
        vehicleDataConfidence: 90,
        sourceYear: 2018,
      },
    })) as any,
    decodeVin: (async () => ({
      status: "FOUND",
      vin,
      source: "CACHE",
      sourceDetail: "VIN_CACHE_CONFLICT_FIXTURE",
      confidence: 99,
      fieldConfidence: {},
      validation: {},
      warning: null,
      cached: true,
      vehicle: {
        vin,
        wmi: "WVW",
        region: "EUROPE",
        make: "VOLKSWAGEN",
        model: "PASSAT",
        year: 2018,
        trim: null,
        series: null,
        bodyType: "SEDAN",
        vehicleType: "PASSENGER",
        engine: "2.0 TDI",
        engineVolumeL: 1.968,
        cylinders: 4,
        fuelType: "DIESEL",
        secondaryFuelType: null,
        driveType: "FWD",
        transmission: "AUTOMATIC",
        plantCountry: null,
        plantCompany: null,
        manufacturer: "VOLKSWAGEN",
      },
    })) as any,
  } as any,
);
assert.equal(conflict.state, "ASSISTED");
assert.equal(conflict.vehicle, null, "conflicting plate/VIN must not expose one source as authoritative");
assert.equal(conflict.confidence, 0);
assert.equal(conflict.vinAvailable, true);
assert.equal(conflict.needsVin, false);
assert.equal(conflict.exactFitmentReady, false);
assert.match(conflict.source, /CONFLICT$/);
assert.match(conflict.message, /суперечать/);
assert.ok(!JSON.stringify(conflict).includes(vin), "conflict response must keep VIN masked");

const directVin = await resolveUnifiedVehicleIdentity(
  vin,
  {},
  {
    lookupByPlate: (async () => {
      throw new Error("must not use plate lookup for VIN input");
    }) as any,
    decodeVin: (async () => ({
      status: "NOT_FOUND",
      vin,
      source: "NHTSA_VPIC_API",
      sourceDetail: "NHTSA_VPIC_API",
      confidence: 0,
      fieldConfidence: {},
      validation: {},
      warning: null,
      vehicle: null,
      cached: false,
    })) as any,
  } as any,
);
assert.equal(directVin.state, "ASSISTED");
assert.equal(directVin.inputType, "VIN");
assert.ok(!JSON.stringify(directVin).includes(vin), "VIN input must remain masked in public result");

console.log("Unified vehicle identity smoke: PASS");
