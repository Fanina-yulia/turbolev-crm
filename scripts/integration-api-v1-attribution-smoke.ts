import assert from "node:assert/strict";

import {
  ContractValidationError,
  attributionMetadataV1,
  deriveLegacyInquiryAttributionFieldsV1,
  parseAttributionSnapshotV1,
} from "../src/lib/contracts/integration/v1/index";

function expectContractError(run: () => unknown) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof ContractValidationError);
    assert.equal(error.code, "INVALID_REQUEST");
    return true;
  });
}

const snapshot = parseAttributionSnapshotV1({
  entrypoint: "AI_ASSISTANT",
  publicSessionId: "sess_01JABCDEF123",
  pageViewId: "pv_01JABCDEF123",
  aiSessionId: "ai_01JABCDEF123",
  firstTouch: {
    sourceClass: "ORGANIC_SEARCH",
    source: "google",
    medium: "organic",
    landingPath: "https://turbo-lev.ua/nespravnosti/stuk-pidvisky/?vin=SHOULD_NOT_PERSIST#x",
    referrerHost: "https://www.google.com/search?q=private",
    pageTypeId: "PT-010",
    intentCluster: "symptom:suspension-knock",
    rawVin: "WVWZZZ1JZXW000001",
    email: "hidden@example.com",
  },
  conversionTouch: {
    capturedAt: "2026-08-22T16:20:00+03:00",
    sourceClass: "AI_ASSISTED",
    source: "google",
    medium: "organic",
    campaign: "brand-defense",
    landingPath: "/zapchastyny/halmivni-kolodky/?phone=hidden",
    referrerHost: "google.com",
    pageTypeId: "PT-013",
    intentCluster: "vehicle-category:brake-pads",
    locationId: "loc_glevakha",
    serviceId: "svc_brake_pads",
    categoryId: "cat_brake_pads",
    productId: "prd_ate_130460",
    vehicleReferenceId: "vref_ford_mondeo_2017_t7ce",
    aiAssisted: true,
    phone: "+380000000000",
  },
});

assert.equal(snapshot.schemaVersion, "v1");
assert.equal(snapshot.entrypoint, "AI_ASSISTANT");
assert.equal(snapshot.firstTouch?.landingPath, "/nespravnosti/stuk-pidvisky/");
assert.equal(snapshot.firstTouch?.referrerHost, "www.google.com");
assert.equal(snapshot.conversionTouch.landingPath, "/zapchastyny/halmivni-kolodky/");
assert.equal(snapshot.conversionTouch.aiAssisted, true);
assert.equal("rawVin" in (snapshot.firstTouch ?? {}), false);
assert.equal("email" in (snapshot.firstTouch ?? {}), false);
assert.equal("phone" in snapshot.conversionTouch, false);

const legacy = deriveLegacyInquiryAttributionFieldsV1(snapshot);
assert.match(legacy.sourceDetail, /google/);
assert.equal(legacy.campaign, "brand-defense");
assert.match(legacy.utm ?? "", /utm_source=google/);
assert.match(legacy.utm ?? "", /utm_medium=organic/);
assert.match(legacy.utm ?? "", /utm_campaign=brand-defense/);

const metadata = attributionMetadataV1(snapshot);
assert.deepEqual(metadata.attribution, snapshot);

expectContractError(() => parseAttributionSnapshotV1({
  entrypoint: "UNKNOWN_ENTRY",
  conversionTouch: { sourceClass: "DIRECT" },
}));

expectContractError(() => parseAttributionSnapshotV1({
  entrypoint: "WEB_FORM",
}));

expectContractError(() => parseAttributionSnapshotV1({
  entrypoint: "WEB_FORM",
  publicSessionId: "bad session id with spaces",
  conversionTouch: { sourceClass: "DIRECT" },
}));

console.log("integration API v1 attribution smoke: OK");
