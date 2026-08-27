import assert from "node:assert/strict";
import {
  ContractValidationError,
  parsePublicLeadRequestV1,
} from "../src/lib/contracts/integration/v1/index";

const validPayload = {
  leadType: "PART_SELECTION",
  contact: {
    name: "Test User",
    phone: "+380 67 000 00 00",
  },
  message: "Потрібні передні гальмівні колодки",
  vehicle: {
    label: "Volkswagen Passat B6",
    plate: "AA 1234 BB",
    vin: "WVWZZZ3CZ8E000001",
  },
  context: {
    categoryId: "brake-pads",
    query: "передні колодки",
    pagePath: "https://turbolev.ua/zapchastyny?phone=must-not-survive",
  },
  attribution: {
    schemaVersion: "v1",
    entrypoint: "WEB_FORM",
    publicSessionId: "sess_12345678",
    conversionTouch: {
      sourceClass: "ORGANIC_SEARCH",
      source: "google",
      medium: "organic",
      landingPath: "https://turbolev.ua/zapchastyny?vin=must-not-survive",
      referrerHost: "https://www.google.com/search?q=private",
    },
  },
  privacy: {
    noticeVersion: "privacy-2026-08",
    acknowledgedAt: "2026-08-26T10:00:00.000Z",
    marketingConsent: false,
  },
};

const parsed = parsePublicLeadRequestV1(validPayload);
assert.equal(parsed.leadType, "PART_SELECTION");
assert.equal(parsed.vehicle?.plate, "AA1234BB");
assert.equal(parsed.vehicle?.vin, "WVWZZZ3CZ8E000001");
assert.equal(parsed.context?.pagePath, "/zapchastyny");
assert.equal(parsed.attribution.conversionTouch.landingPath, "/zapchastyny");
assert.equal(parsed.attribution.conversionTouch.referrerHost, "www.google.com");
assert.equal(parsed.privacy.marketingConsent, false);

function expectInvalid(payload: unknown, expectedField: string) {
  try {
    parsePublicLeadRequestV1(payload);
    assert.fail(`Expected validation error for ${expectedField}`);
  } catch (error) {
    assert.ok(error instanceof ContractValidationError);
    assert.ok(Object.keys(error.fieldErrors).some((field) => field === expectedField));
  }
}

expectInvalid({
  ...validPayload,
  assignedUserId: "admin",
}, "request");

expectInvalid({
  ...validPayload,
  status: "CONVERTED",
}, "request");

expectInvalid({
  ...validPayload,
  contact: { phone: "123" },
}, "contact.phone");

expectInvalid({
  ...validPayload,
  privacy: { noticeVersion: "privacy-2026-08" },
}, "privacy.acknowledgedAt");

expectInvalid({
  ...validPayload,
  leadType: "AI_HANDOFF",
  aiHandoff: { sessionId: "ai_12345678" },
}, "aiHandoff.summary");

console.log("integration API v1 public lead contract smoke: OK");
