import assert from "node:assert/strict";

import {
  API_ERROR_CODES,
  ContractValidationError,
  parseFitmentBrowseQuery,
  parseProductFitmentCheckRequest,
  parseVehicleResolveConfirmRequest,
  parseVehicleResolveRequest,
} from "../src/lib/contracts/integration/v1/index";

function expectContractError(run: () => unknown, code: ContractValidationError["code"]) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ContractValidationError);
    assert.equal(error.code, code);
    return true;
  });
}

const vin = parseVehicleResolveRequest({
  inputType: "VIN",
  vin: " wp0zzz99zts392124 ",
  context: { categoryId: "brake-pads" },
});
assert.equal(vin.inputType, "VIN");
assert.equal(vin.vin, "WP0ZZZ99ZTS392124");
assert.equal(vin.context?.categoryId, "brake-pads");

const manual = parseVehicleResolveRequest({
  inputType: "MANUAL",
  vehicle: {
    make: "Ford",
    model: "Mondeo",
    year: 2017,
    engineCode: "T7CE",
    displacementCm3: 1997,
  },
});
assert.equal(manual.inputType, "MANUAL");
assert.equal(manual.vehicle.year, 2017);
assert.equal(manual.vehicle.engineCode, "T7CE");

const saved = parseVehicleResolveRequest({
  inputType: "SAVED_VEHICLE",
  publicVehicleRef: "veh_pub_01J9Y8N2S0",
});
assert.equal(saved.inputType, "SAVED_VEHICLE");
assert.equal(saved.publicVehicleRef, "veh_pub_01J9Y8N2S0");

expectContractError(
  () => parseVehicleResolveRequest({ inputType: "VIN", vin: "SHORT" }),
  "INVALID_VIN_FORMAT",
);
expectContractError(
  () => parseVehicleResolveRequest({ inputType: "MANUAL", vehicle: { make: "Ford", model: "Mondeo" } }),
  "VEHICLE_INPUT_INSUFFICIENT",
);
expectContractError(
  () => parseVehicleResolveRequest({ inputType: "SAVED_VEHICLE", publicVehicleRef: "bad ref with spaces" }),
  "INVALID_REQUEST",
);

const confirm = parseVehicleResolveConfirmRequest({
  vehicleResolutionId: "res_01J9Y8N2S0",
  candidateId: "cand_2",
  answers: {
    ENGINE_CODE: "T7CE",
    PR_CODE: ["1ZF", "1ZA"],
    ignored_lowercase: "must-not-pass",
  },
});
assert.equal(confirm.vehicleResolutionId, "res_01J9Y8N2S0");
assert.deepEqual(confirm.answers.PR_CODE, ["1ZF", "1ZA"]);
assert.equal("ignored_lowercase" in confirm.answers, false);

const productCheck = parseProductFitmentCheckRequest({ vehicleResolutionId: "res_01J9Y8N2S0" });
assert.equal(productCheck.vehicleResolutionId, "res_01J9Y8N2S0");

const browse = parseFitmentBrowseQuery(
  new URLSearchParams({ categoryId: "brake-pads", limit: "999", sort: "PRICE_ASC" }),
);
// Out-of-contract limit falls back to the safe default rather than escaping the server cap.
assert.equal(browse.limit, 24);
assert.equal(browse.sort, "PRICE_ASC");
assert.equal(browse.categoryId, "brake-pads");

expectContractError(
  () => parseFitmentBrowseQuery(new URLSearchParams()),
  "INVALID_FILTER",
);
expectContractError(
  () => parseFitmentBrowseQuery(new URLSearchParams({ categoryId: "a", genericArticleId: "b" })),
  "INVALID_FILTER",
);

assert.ok(API_ERROR_CODES.includes("RATE_LIMITED"));
assert.ok(API_ERROR_CODES.includes("VIN_PROVIDER_UNAVAILABLE"));
assert.equal(new Set(API_ERROR_CODES).size, API_ERROR_CODES.length);

console.log("integration API v1 contract smoke: OK");
