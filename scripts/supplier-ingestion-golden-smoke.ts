import assert from "node:assert/strict";

import type { NormalizedSupplierRecord, SupplierFreshnessPolicyContract } from "../src/services/supplier-ingestion-contracts";
import {
  classifyFreshness,
  decideIdentityMatch,
  decideIncomingOrder,
  evaluateSnapshotPublishGate,
  normalizeSupplierRecord,
  semanticFingerprint,
  validateNormalizedRecord,
} from "../src/services/supplier-ingestion-policy";
import {
  assertSupplierIngestionWritesEnabled,
  SupplierIngestionWriteDisabledError,
} from "../src/services/supplier-ingestion-persistence.service";

const policy: SupplierFreshnessPolicyContract = {
  freshTtlSeconds: 900,
  staleAllowedSeconds: 900,
  hardExpirySeconds: 3600,
  checkoutRevalidate: true,
  staleDisplayAllowed: true,
  providerErrorFallback: true,
};

function record(overrides: Partial<NormalizedSupplierRecord> = {}): NormalizedSupplierRecord {
  return {
    supplierRecordKey: "A-0001",
    supplierArticleRaw: "0 986 494 596",
    brandRaw: " Bosch ",
    mpnCandidateRaw: "0-986-494-596",
    currency: "uah",
    purchasePrice: 1000,
    quantityMode: "EXACT",
    exactQty: 7,
    sourceUpdatedAt: new Date("2026-08-22T10:00:00Z"),
    sourceTimeTrusted: true,
    rawPayload: { id: "A-0001" },
    ...overrides,
  };
}

// SUP-G-002 / normalization: brand + MPN normalize deterministically.
const normalized = normalizeSupplierRecord(record());
assert.equal(normalized.brandNormalized, "BOSCH");
assert.equal(normalized.mpnCandidateNorm, "0986494596");
assert.equal(normalized.currency, "UAH");
assert.equal(normalized.exactQty, 7);
assert.deepEqual(validateNormalizedRecord(normalized), []);

// Stable semantic fingerprint must not depend on object key ordering.
assert.equal(
  semanticFingerprint({ b: 2, a: 1, nested: { z: 2, y: 1 } }),
  semanticFingerprint({ nested: { y: 1, z: 2 }, a: 1, b: 2 }),
);

// SUP-G-014 / 015 — invalid quantity/price are rejected by validation.
assert.ok(validateNormalizedRecord(normalizeSupplierRecord(record({ exactQty: -1 }))).includes("INVALID_EXACT_QTY"));
assert.ok(validateNormalizedRecord(normalizeSupplierRecord(record({ purchasePrice: -1 }))).includes("INVALID_PURCHASE_PRICE"));

// SUP-G-002 — unique exact brand+MPN evidence matches one Product.
const exactMatch = decideIdentityMatch([
  { productId: "PR-001", brandMpnExact: true },
]);
assert.equal(exactMatch.state, "MATCHED");
assert.equal(exactMatch.productId, "PR-001");
assert.equal(exactMatch.method, "BRAND_MPN");

// SUP-G-003 — verified GTIN may be a strong unique match.
const gtinMatch = decideIdentityMatch([
  { productId: "PR-002", verifiedGtin: true },
]);
assert.equal(gtinMatch.state, "MATCHED");
assert.equal(gtinMatch.productId, "PR-002");
assert.equal(gtinMatch.method, "VERIFIED_GTIN");

// SUP-G-020 — multiple weak alias candidates remain ambiguous.
const ambiguous = decideIdentityMatch([
  { productId: "PR-001", aliasSupersession: true },
  { productId: "PR-004", aliasSupersession: true },
]);
assert.equal(ambiguous.state, "AMBIGUOUS");
assert.deepEqual(ambiguous.candidates, ["PR-001", "PR-004"]);

// SUP-G-021 — strong identity evidence pointing at different Products is a conflict.
const conflict = decideIdentityMatch([
  { productId: "PR-001", brandMpnExact: true },
  { productId: "PR-002", verifiedGtin: true },
]);
assert.equal(conflict.state, "CONFLICT");

// SUP-G-022 — no trusted evidence does not auto-create/match a Product.
const unmatched = decideIdentityMatch([{ productId: "PR-001" }]);
assert.equal(unmatched.state, "UNMATCHED");

const base = new Date("2026-08-22T10:00:00Z");
// SUP-G-060 — fresh offer.
const fresh = classifyFreshness({
  now: new Date("2026-08-22T10:10:00Z"),
  ingestedAt: base,
  sourceUpdatedAt: base,
  sourceTimeTrusted: true,
  policy,
});
assert.equal(fresh.freshnessClass, "FRESH");
assert.equal(fresh.displayAllowed, true);

// SUP-G-061 — stale-allowed is displayable but must revalidate at checkout.
const stale = classifyFreshness({
  now: new Date("2026-08-22T10:20:00Z"),
  ingestedAt: base,
  sourceUpdatedAt: base,
  sourceTimeTrusted: true,
  policy,
});
assert.equal(stale.freshnessClass, "STALE_ALLOWED");
assert.equal(stale.checkoutRevalidate, true);
assert.equal(stale.displayAllowed, true);

// SUP-G-062 — expired is not display/checkout truth.
const expired = classifyFreshness({
  now: new Date("2026-08-22T11:01:00Z"),
  ingestedAt: base,
  sourceUpdatedAt: base,
  sourceTimeTrusted: true,
  policy,
});
assert.equal(expired.freshnessClass, "EXPIRED");
assert.equal(expired.displayAllowed, false);
assert.equal(expired.checkoutRevalidate, true);

// SUP-G-063 — provider error uses bounded last-known state and revalidation.
const providerError = classifyFreshness({
  now: new Date("2026-08-22T10:20:00Z"),
  ingestedAt: base,
  sourceUpdatedAt: base,
  sourceTimeTrusted: true,
  providerError: true,
  policy,
});
assert.equal(providerError.freshnessClass, "PROVIDER_ERROR_LAST_KNOWN");
assert.equal(providerError.checkoutRevalidate, true);

// SUP-G-064 — source time that cannot be trusted is explicitly classified.
const unknownSourceTime = classifyFreshness({
  now: new Date("2026-08-22T10:05:00Z"),
  ingestedAt: base,
  sourceUpdatedAt: null,
  sourceTimeTrusted: false,
  policy,
});
assert.equal(unknownSourceTime.freshnessClass, "UNKNOWN_SOURCE_TIME");
assert.equal(unknownSourceTime.checkoutRevalidate, true);

// SUP-G-040 — a complete healthy full snapshot can deactivate missing offers.
const healthySnapshot = evaluateSnapshotPublishGate({
  mode: "FULL_SNAPSHOT",
  recordsReceived: 100,
  recordsValid: 100,
  recordsMatched: 100,
  recordsAmbiguous: 0,
  recordsUnmatched: 0,
  recordsConflict: 0,
  recordsRejected: 0,
  previousPublishedCount: 105,
  minimumFullSnapshotRows: 10,
  providerDeclaredComplete: true,
});
assert.equal(healthySnapshot.allowPublish, true);
assert.equal(healthySnapshot.allowMissingOfferDeactivation, true);

// SUP-G-041/042 — incomplete full snapshot cannot publish/deactivate missing offers.
const incompleteSnapshot = evaluateSnapshotPublishGate({
  mode: "FULL_SNAPSHOT",
  recordsReceived: 40,
  recordsValid: 40,
  recordsMatched: 40,
  recordsAmbiguous: 0,
  recordsUnmatched: 0,
  recordsConflict: 0,
  recordsRejected: 0,
  previousPublishedCount: 100,
  providerDeclaredComplete: false,
});
assert.equal(incompleteSnapshot.allowPublish, false);
assert.equal(incompleteSnapshot.allowMissingOfferDeactivation, false);
assert.ok(incompleteSnapshot.reasons.includes("FULL_SNAPSHOT_NOT_DECLARED_COMPLETE"));

// SUP-G-043 — mass-drop guard prevents destructive full snapshot publication.
const collapsedSnapshot = evaluateSnapshotPublishGate({
  mode: "FULL_SNAPSHOT",
  recordsReceived: 15,
  recordsValid: 15,
  recordsMatched: 15,
  recordsAmbiguous: 0,
  recordsUnmatched: 0,
  recordsConflict: 0,
  recordsRejected: 0,
  previousPublishedCount: 100,
  providerDeclaredComplete: true,
  maxFullSnapshotDropRatio: 0.4,
});
assert.equal(collapsedSnapshot.allowPublish, false);
assert.ok(collapsedSnapshot.reasons.includes("FULL_SNAPSHOT_MASS_DROP_GUARD"));
assert.equal(collapsedSnapshot.allowMissingOfferDeactivation, false);

// Incremental absence never implies missing-offer deactivation.
const incremental = evaluateSnapshotPublishGate({
  mode: "INCREMENTAL",
  recordsReceived: 1,
  recordsValid: 1,
  recordsMatched: 1,
  recordsAmbiguous: 0,
  recordsUnmatched: 0,
  recordsConflict: 0,
  recordsRejected: 0,
  providerDeclaredComplete: true,
});
assert.equal(incremental.allowPublish, true);
assert.equal(incremental.allowMissingOfferDeactivation, false);

// SUP-G-030/031 — semantically identical update is idempotent.
const identicalOrder = decideIncomingOrder({
  currentSemanticHash: "same",
  incomingSemanticHash: "same",
  currentSourceUpdatedAt: base,
  incomingSourceUpdatedAt: new Date("2026-08-22T10:05:00Z"),
  currentSourceTimeTrusted: true,
  incomingSourceTimeTrusted: true,
});
assert.equal(identicalOrder.apply, false);
assert.equal(identicalOrder.idempotent, true);

// SUP-G-052 — older trusted provider update cannot overwrite newer state.
const oldDelta = decideIncomingOrder({
  currentSemanticHash: "current",
  incomingSemanticHash: "older",
  currentSourceUpdatedAt: new Date("2026-08-22T10:10:00Z"),
  incomingSourceUpdatedAt: new Date("2026-08-22T10:05:00Z"),
  currentSourceTimeTrusted: true,
  incomingSourceTimeTrusted: true,
});
assert.equal(oldDelta.apply, false);
assert.equal(oldDelta.reason, "OUT_OF_ORDER_PROVIDER_TIMESTAMP");

// SUP-G-053 — newer trusted provider timestamp can advance state.
const newerDelta = decideIncomingOrder({
  currentSemanticHash: "current",
  incomingSemanticHash: "newer",
  currentSourceUpdatedAt: new Date("2026-08-22T10:05:00Z"),
  incomingSourceUpdatedAt: new Date("2026-08-22T10:10:00Z"),
  currentSourceTimeTrusted: true,
  incomingSourceTimeTrusted: true,
});
assert.equal(newerDelta.apply, true);
assert.equal(newerDelta.reason, "NEWER_PROVIDER_TIMESTAMP");

// Production supplier writes remain fail-closed unless BOTH activation controls are present.
assert.throws(
  () => assertSupplierIngestionWritesEnabled(
    { confirmation: "ALLOW_SUPPLIER_INGESTION_PERSISTENCE" },
    {},
  ),
  SupplierIngestionWriteDisabledError,
);
assert.throws(
  () => assertSupplierIngestionWritesEnabled(
    { confirmation: "WRONG" },
    { SUPPLIER_INGESTION_WRITES_ENABLED: "PERSIST_SUPPLIER_INGESTION_V1" },
  ),
  SupplierIngestionWriteDisabledError,
);
assert.doesNotThrow(() => assertSupplierIngestionWritesEnabled(
  { confirmation: "ALLOW_SUPPLIER_INGESTION_PERSISTENCE" },
  { SUPPLIER_INGESTION_WRITES_ENABLED: "PERSIST_SUPPLIER_INGESTION_V1" },
));

console.log("supplier ingestion golden policy smoke: OK");
