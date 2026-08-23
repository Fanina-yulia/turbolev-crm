import assert from "node:assert/strict";
import {
  ContractValidationError,
  parseFitmentBrowseQuery,
  parseProductFitmentCheckRequest,
  parseVehicleResolveConfirmRequest,
  parseVehicleResolveRequest,
  type VehicleResolutionDto,
} from "@/src/lib/contracts/integration/v1";

const autoPlate = parseVehicleResolveRequest({ inputType: "AUTO", identifier: "КА 7584 СІ" });
assert.deepEqual(autoPlate, { inputType: "PLATE", plate: "KA7584CI", countryCode: "UA", context: undefined });

const euVin = "WVWZZZ1JZXW000001";
const autoVin = parseVehicleResolveRequest({ inputType: "AUTO", identifier: euVin, context: { categoryId: "brakes" } });
assert.deepEqual(autoVin, { inputType: "VIN", vin: euVin, context: { categoryId: "brakes" } });

const explicitPlate = parseVehicleResolveRequest({ inputType: "PLATE", plate: "AA 1234 BC", countryCode: "ua" });
assert.equal(explicitPlate.inputType, "PLATE");
if (explicitPlate.inputType === "PLATE") {
  assert.equal(explicitPlate.plate, "AA1234BC");
  assert.equal(explicitPlate.countryCode, "UA");
}

const northAmericanVin = "1HGCM82633A004352";
const directVin = parseVehicleResolveRequest({ inputType: "VIN", vin: northAmericanVin });
assert.equal(directVin.inputType, "VIN");

assert.throws(
  () => parseVehicleResolveRequest({ inputType: "AUTO", identifier: "123" }),
  (error: unknown) => error instanceof ContractValidationError && error.code === "INVALID_REQUEST",
);
assert.throws(
  () => parseVehicleResolveRequest({ inputType: "PLATE", plate: "AA1234BC", countryCode: "PL" }),
  (error: unknown) => error instanceof ContractValidationError && error.code === "INVALID_PLATE_FORMAT",
);
assert.throws(
  () => parseVehicleResolveRequest({ inputType: "VIN", vin: "1HGCM82643A004352" }),
  (error: unknown) => error instanceof ContractValidationError && error.code === "INVALID_VIN_CHECK_DIGIT",
);

const manual = parseVehicleResolveRequest({
  inputType: "MANUAL",
  vehicle: { make: "Skoda", model: "Octavia", year: 2019, displacementCm3: 1598, fuelType: "DIESEL" },
});
assert.equal(manual.inputType, "MANUAL");

const saved = parseVehicleResolveRequest({ inputType: "SAVED_VEHICLE", publicVehicleRef: "vehref_abc-123" });
assert.deepEqual(saved, { inputType: "SAVED_VEHICLE", publicVehicleRef: "vehref_abc-123", context: undefined });

const confirmed = parseVehicleResolveConfirmRequest({
  vehicleResolutionId: "resolution_123",
  candidateId: "candidate_1",
  answers: { ENGINE_CODE: "CUNA", AWD: false },
});
assert.equal(confirmed.answers.ENGINE_CODE, "CUNA");
assert.equal(confirmed.answers.AWD, false);

assert.deepEqual(parseProductFitmentCheckRequest({ vehicleResolutionId: "resolution_123" }), {
  vehicleResolutionId: "resolution_123",
});

const browse = parseFitmentBrowseQuery(new URLSearchParams("categoryId=brakes&limit=24&sort=AVAILABILITY"));
assert.equal(browse.categoryId, "brakes");
assert.equal(browse.limit, 24);
assert.equal(browse.sort, "AVAILABILITY");

const publicDto: VehicleResolutionDto = {
  vehicleResolutionId: "resolution_123",
  status: "RESOLVED",
  resolvedInputType: "PLATE",
  maskedIdentifier: "KA••••CI",
  vehicleReference: {
    id: "vehicle_reference_123",
    fitmentKey: "fitment-key-123",
    make: "Volkswagen",
    model: "Passat",
    year: 2018,
  },
  confidence: 96,
  missingCriteria: [],
  candidates: [],
  pollAfterMs: null,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const serialized = JSON.stringify(publicDto);
assert.equal(serialized.includes("KA7584CI"), false, "public DTO must not require raw plate");
assert.equal(serialized.includes(euVin), false, "public DTO must not require raw VIN");
assert.match(publicDto.maskedIdentifier ?? "", /^KA•+CI$/);

console.log("Integration API unified vehicle identity contract smoke: PASS");
