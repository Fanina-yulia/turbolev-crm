import assert from "node:assert/strict";
import {
  buildOfferKey,
  classifyFreshness,
  decideIdentityMatch,
  decideIncomingOrder,
  deriveAvailability,
  detectPriceAnomaly,
  evaluateSnapshotPublishGate,
  normalizeBrand,
  normalizeCurrency,
  normalizeGtin,
  normalizePartNumber,
  normalizeSupplierRecord,
  semanticFingerprint,
  validateNormalizedRecord,
} from "../src/services/supplier-ingestion-policy";
import type { NormalizedSupplierRecord, SupplierFreshnessPolicyContract } from "../src/services/supplier-ingestion-contracts";

let assertions = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    assertions += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const brandCases: Array<[unknown, string | null]> = [
  [" Bosch ", "BOSCH"],
  ["febi-bilstein", "FEBI BILSTEIN"],
  ["  MANN   FILTER ", "MANN FILTER"],
  ["SACHS/ZF", "SACHS ZF"],
  ["Лемфердер", "ЛЕМФЕРДЕР"],
  ["BREMBO®", "BREMBO"],
  ["  ", null],
  [null, null],
  [123, null],
  ["A.B.C", "A B C"],
];
for (const [value, expected] of brandCases) {
  check(`normalizeBrand ${String(value)}`, () => assert.equal(normalizeBrand(value), expected));
}

const partCases: Array<[unknown, string | null]> = [
  [" 0 986 494 596 ", "0986494596"],
  ["A-123/B", "A123B"],
  ["1K0 698 151 F", "1K0698151F"],
  ["febi 12345", "FEBI12345"],
  ["TRW/JTS483", "TRWJTS483"],
  ["123.456.789", "123456789"],
  ["AB_CD-EF", "ABCDEF"],
  [123456, "123456"],
  [" ШР-001 ", "ШР001"],
  ["", null],
  [null, null],
  [undefined, null],
];
for (const [value, expected] of partCases) {
  check(`normalizePartNumber ${String(value)}`, () => assert.equal(normalizePartNumber(value), expected));
}

const gtinCases: Array<[unknown, string | null]> = [
  ["4006381333931", "4006381333931"],
  ["4 006381 333931", "4006381333931"],
  ["12345678", "12345678"],
  ["12345678901234", "12345678901234"],
  ["1234567", null],
  ["123456789012345", null],
  [null, null],
  ["ABC", null],
];
for (const [value, expected] of gtinCases) {
  check(`normalizeGtin ${String(value)}`, () => assert.equal(normalizeGtin(value), expected));
}

const currencyCases: Array<[unknown, string | null]> = [
  ["uah", "UAH"],
  [" EUR ", "EUR"],
  ["USD", "USD"],
  ["PLN", "PLN"],
  ["UA", null],
  ["USDD", null],
  [null, null],
];
for (const [value, expected] of currencyCases) {
  check(`normalizeCurrency ${String(value)}`, () => assert.equal(normalizeCurrency(value), expected));
}

check("semantic fingerprint ignores object key order", () => {
  assert.equal(semanticFingerprint({ b: 2, a: 1 }), semanticFingerprint({ a: 1, b: 2 }));
});
check("semantic fingerprint detects material change", () => {
  assert.notEqual(semanticFingerprint({ a: 1 }), semanticFingerprint({ a: 2 }));
});

const rawRecord: NormalizedSupplierRecord = {
  supplierRecordKey: " row-1 ",
  externalProductId: " ext-77 ",
  supplierArticleRaw: " 0 986 494 596 ",
  brandRaw: " Bosch ",
  mpnCandidateRaw: " 0-986-494-596 ",
  gtinCandidate: "4 006381 333931",
  currency: "uah",
  purchasePrice: 100.25,
  quantityMode: "EXACT",
  exactQty: 5,
  minOrderQty: 1,
  multiplicity: 1,
  warehouseKey: " KYIV-1 ",
  sourceTimeTrusted: true,
  rawPayload: { x: 1 },
};
check("normalizeSupplierRecord canonicalizes supplier fields", () => {
  const normalized = normalizeSupplierRecord(rawRecord);
  assert.equal(normalized.supplierRecordKey, "row-1");
  assert.equal(normalized.externalProductId, "ext-77");
  assert.equal(normalized.supplierArticleNorm, "0986494596");
  assert.equal(normalized.brandNormalized, "BOSCH");
  assert.equal(normalized.mpnCandidateNorm, "0986494596");
  assert.equal(normalized.gtinCandidate, "4006381333931");
  assert.equal(normalized.currency, "UAH");
  assert.equal(normalized.warehouseKey, "KYIV-1");
});

const validBase = normalizeSupplierRecord(rawRecord);
const validationCases: Array<[string, NormalizedSupplierRecord, string | null]> = [
  ["valid", validBase, null],
  ["missing key", { ...validBase, supplierRecordKey: "" }, "MISSING_SUPPLIER_RECORD_KEY"],
  ["negative price", { ...validBase, purchasePrice: -1 }, "INVALID_PURCHASE_PRICE"],
  ["negative qty", { ...validBase, exactQty: -1 }, "INVALID_EXACT_QTY"],
  ["bad min qty", { ...validBase, minOrderQty: 0 }, "INVALID_MIN_ORDER_QTY"],
  ["bad multiplicity", { ...validBase, multiplicity: 0 }, "INVALID_MULTIPLICITY"],
  [
    "missing identity",
    { ...validBase, externalProductId: null, supplierArticleNorm: null, mpnCandidateNorm: null, gtinCandidate: null },
    "MISSING_IDENTITY_EVIDENCE",
  ],
];
for (const [name, record, expectedError] of validationCases) {
  check(`validateNormalizedRecord ${name}`, () => {
    const errors = validateNormalizedRecord(record);
    if (expectedError) assert.ok(errors.includes(expectedError));
    else assert.deepEqual(errors, []);
  });
}

const identityCases = [
  ["approved mapping", [{ productId: "p1", approvedMapping: true }], "MATCHED", "p1", "APPROVED_MAPPING"],
  ["trusted id", [{ productId: "p1", trustedExternalId: true }], "MATCHED", "p1", "TRUSTED_EXTERNAL_ID"],
  ["brand mpn", [{ productId: "p1", brandMpnExact: true }], "MATCHED", "p1", "BRAND_MPN"],
  ["verified gtin", [{ productId: "p1", verifiedGtin: true }], "MATCHED", "p1", "VERIFIED_GTIN"],
  ["alias", [{ productId: "p1", aliasSupersession: true }], "MATCHED", "p1", "ALIAS_SUPERSESSION"],
  [
    "multiple evidence same product",
    [{ productId: "p1", brandMpnExact: true, verifiedGtin: true }],
    "MATCHED",
    "p1",
    "BRAND_MPN",
  ],
  [
    "approved and weak alternative",
    [{ productId: "p1", approvedMapping: true }, { productId: "p2", aliasSupersession: true }],
    "MATCHED",
    "p1",
    "APPROVED_MAPPING",
  ],
  [
    "strong conflict",
    [{ productId: "p1", brandMpnExact: true }, { productId: "p2", verifiedGtin: true }],
    "CONFLICT",
    undefined,
    undefined,
  ],
  [
    "approved versus trusted conflict",
    [{ productId: "p1", approvedMapping: true }, { productId: "p2", trustedExternalId: true }],
    "CONFLICT",
    undefined,
    undefined,
  ],
  [
    "alias ambiguity",
    [{ productId: "p1", aliasSupersession: true }, { productId: "p2", aliasSupersession: true }],
    "AMBIGUOUS",
    undefined,
    undefined,
  ],
  ["no evidence candidate", [{ productId: "p1" }], "UNMATCHED", undefined, undefined],
  ["no candidates", [], "UNMATCHED", undefined, undefined],
] as const;
for (const [name, candidates, state, productId, method] of identityCases) {
  check(`identity ${name}`, () => {
    const decision = decideIdentityMatch([...candidates]);
    assert.equal(decision.state, state);
    assert.equal(decision.productId, productId);
    assert.equal(decision.method, method);
  });
}

const policy: SupplierFreshnessPolicyContract = {
  freshTtlSeconds: 300,
  staleAllowedSeconds: 600,
  hardExpirySeconds: 1_800,
  checkoutRevalidate: false,
  staleDisplayAllowed: true,
  providerErrorFallback: true,
};
const base = new Date("2026-08-22T10:00:00.000Z");
function at(seconds: number) {
  return new Date(base.getTime() + seconds * 1_000);
}
const freshnessCases = [
  ["fresh start", 0, true, false, policy, "FRESH", true],
  ["fresh edge", 300, true, false, policy, "FRESH", true],
  ["stale start", 301, true, false, policy, "STALE_ALLOWED", true],
  ["stale edge", 900, true, false, policy, "STALE_ALLOWED", true],
  ["outside stale", 901, true, false, policy, "EXPIRED", false],
  ["hard expired", 1_801, true, false, policy, "EXPIRED", false],
  ["unknown source time", 10, false, false, policy, "UNKNOWN_SOURCE_TIME", true],
  ["provider error bounded fallback", 100, true, true, policy, "PROVIDER_ERROR_LAST_KNOWN", true],
  [
    "provider error without fallback",
    100,
    true,
    true,
    { ...policy, providerErrorFallback: false },
    "FRESH",
    true,
  ],
  [
    "stale hidden by policy",
    400,
    true,
    false,
    { ...policy, staleDisplayAllowed: false },
    "STALE_ALLOWED",
    false,
  ],
] as const;
for (const [name, seconds, trusted, providerError, currentPolicy, expectedClass, expectedDisplay] of freshnessCases) {
  check(`freshness ${name}`, () => {
    const decision = classifyFreshness({
      now: at(seconds),
      ingestedAt: base,
      sourceUpdatedAt: trusted ? base : null,
      sourceTimeTrusted: trusted,
      providerError,
      policy: currentPolicy,
    });
    assert.equal(decision.freshnessClass, expectedClass);
    assert.equal(decision.displayAllowed, expectedDisplay);
  });
}
check("freshness policy rejects invalid hard expiry", () => {
  assert.throws(() =>
    classifyFreshness({
      now: base,
      ingestedAt: base,
      sourceUpdatedAt: base,
      sourceTimeTrusted: true,
      policy: { ...policy, hardExpirySeconds: 100 },
    }),
  );
});

const goodFull = {
  mode: "FULL_SNAPSHOT" as const,
  recordsReceived: 100,
  recordsValid: 100,
  recordsMatched: 95,
  recordsAmbiguous: 2,
  recordsUnmatched: 2,
  recordsConflict: 1,
  recordsRejected: 0,
  previousPublishedCount: 110,
  providerDeclaredComplete: true,
};
const snapshotCases = [
  ["good full", goodFull, true, true, null],
  ["full incomplete", { ...goodFull, providerDeclaredComplete: false }, false, false, "FULL_SNAPSHOT_NOT_DECLARED_COMPLETE"],
  ["full too small", { ...goodFull, recordsReceived: 0, recordsValid: 0, recordsMatched: 0, recordsAmbiguous: 0, recordsUnmatched: 0, recordsConflict: 0, minimumFullSnapshotRows: 1 }, false, false, "FULL_SNAPSHOT_TOO_SMALL"],
  ["full mass drop", { ...goodFull, recordsReceived: 50, recordsValid: 50, recordsMatched: 50, recordsAmbiguous: 0, recordsUnmatched: 0, recordsConflict: 0, previousPublishedCount: 100 }, false, false, "FULL_SNAPSHOT_MASS_DROP_GUARD"],
  ["full drop at boundary", { ...goodFull, recordsReceived: 60, recordsValid: 60, recordsMatched: 60, recordsAmbiguous: 0, recordsUnmatched: 0, recordsConflict: 0, previousPublishedCount: 100 }, true, true, null],
  ["rejected over threshold", { ...goodFull, recordsRejected: 6 }, false, false, "REJECTED_RATIO_EXCEEDED"],
  ["rejected boundary", { ...goodFull, recordsRejected: 5 }, true, true, null],
  ["identity over threshold", { ...goodFull, recordsMatched: 70, recordsAmbiguous: 10, recordsUnmatched: 10, recordsConflict: 10 }, false, false, "IDENTITY_PROBLEM_RATIO_EXCEEDED"],
  ["valid exceeds received", { ...goodFull, recordsValid: 101 }, false, false, "VALID_COUNT_EXCEEDS_RECEIVED"],
  ["matched exceeds valid", { ...goodFull, recordsValid: 90, recordsMatched: 91 }, false, false, "MATCHED_COUNT_EXCEEDS_VALID"],
  ["negative counter", { ...goodFull, recordsRejected: -1 }, false, false, "INVALID_BATCH_COUNTERS"],
  ["incremental good", { ...goodFull, mode: "INCREMENTAL" as const, providerDeclaredComplete: false }, true, false, null],
  ["api poll good", { ...goodFull, mode: "API_POLL" as const, providerDeclaredComplete: false }, true, false, null],
  ["webhook good", { ...goodFull, mode: "WEBHOOK_DELTA" as const, providerDeclaredComplete: false }, true, false, null],
  ["manual file non-full good", { ...goodFull, mode: "MANUAL_FILE" as const, providerDeclaredComplete: false }, true, false, null],
  ["full no previous baseline", { ...goodFull, previousPublishedCount: null }, true, true, null],
] as const;
for (const [name, input, expectedPublish, expectedDeactivate, expectedReason] of snapshotCases) {
  check(`snapshot ${name}`, () => {
    const decision = evaluateSnapshotPublishGate(input);
    assert.equal(decision.allowPublish, expectedPublish);
    assert.equal(decision.allowMissingOfferDeactivation, expectedDeactivate);
    if (expectedReason) assert.ok(decision.reasons.includes(expectedReason));
  });
}

const incomingCases = [
  ["first offer", {}, true, false, "NO_CURRENT_OFFER_VERSION"],
  ["same semantic hash", { currentSemanticHash: "x", incomingSemanticHash: "x" }, false, true, "SEMANTICALLY_IDENTICAL_UPDATE"],
  ["newer trusted timestamp", { currentSourceUpdatedAt: at(10), incomingSourceUpdatedAt: at(20), currentSourceTimeTrusted: true, incomingSourceTimeTrusted: true }, true, false, "NEWER_PROVIDER_TIMESTAMP"],
  ["older trusted timestamp", { currentSourceUpdatedAt: at(20), incomingSourceUpdatedAt: at(10), currentSourceTimeTrusted: true, incomingSourceTimeTrusted: true }, false, false, "OUT_OF_ORDER_PROVIDER_TIMESTAMP"],
  ["trusted upgrade", { currentSourceVersion: "old", incomingSourceUpdatedAt: at(20), incomingSourceTimeTrusted: true }, true, false, "TRUSTED_PROVIDER_TIME_UPGRADES_UNTRUSTED_CURRENT_STATE"],
  ["untrusted cannot overwrite trusted", { currentSourceUpdatedAt: at(20), currentSourceTimeTrusted: true, incomingSourceVersion: "v2" }, false, false, "UNTRUSTED_UPDATE_CANNOT_OVERWRITE_TRUSTED_PROVIDER_TIME"],
  ["same trusted timestamp version", { currentSourceUpdatedAt: at(20), incomingSourceUpdatedAt: at(20), currentSourceTimeTrusted: true, incomingSourceTimeTrusted: true, currentSourceVersion: "v1", incomingSourceVersion: "v1", currentSemanticHash: "a", incomingSemanticHash: "b" }, false, false, "SAME_PROVIDER_TIME_AND_VERSION_DIFFERENT_PAYLOAD"],
  ["equal time different version", { currentSourceUpdatedAt: at(20), incomingSourceUpdatedAt: at(20), currentSourceTimeTrusted: true, incomingSourceTimeTrusted: true, currentSourceVersion: "v1", incomingSourceVersion: "v2" }, false, false, "EQUAL_PROVIDER_TIME_REQUIRES_RECONCILIATION"],
  ["same unordered version", { currentSourceVersion: "v1", incomingSourceVersion: "v1", currentSemanticHash: "a", incomingSemanticHash: "b" }, false, false, "SAME_UNORDERED_SOURCE_VERSION_DIFFERENT_PAYLOAD"],
  ["different unordered version", { currentSourceVersion: "v1", incomingSourceVersion: "v2" }, false, false, "UNORDERED_SOURCE_VERSION_REQUIRES_RECONCILIATION"],
] as const;
for (const [name, input, apply, idempotent, reason] of incomingCases) {
  check(`incoming ${name}`, () => {
    const decision = decideIncomingOrder(input);
    assert.equal(decision.apply, apply);
    assert.equal(decision.idempotent, idempotent);
    assert.equal(decision.reason, reason);
  });
}

const availabilityCases = [
  ["qty zero", { exactQty: 0 }, "OUT_OF_STOCK", "EXACT"],
  ["qty one", { exactQty: 1 }, "LOW_STOCK", "EXACT"],
  ["qty threshold", { exactQty: 3 }, "LOW_STOCK", "EXACT"],
  ["qty healthy", { exactQty: 4 }, "AVAILABLE", "EXACT"],
  ["in stock", { rawLabel: "In stock" }, "AVAILABLE", "BOOLEAN_ONLY"],
  ["available", { rawLabel: "AVAILABLE" }, "AVAILABLE", "BOOLEAN_ONLY"],
  ["ua available", { rawLabel: "Є в наявності" }, "AVAILABLE", "BOOLEAN_ONLY"],
  ["ru available", { rawLabel: "В наличии" }, "AVAILABLE", "BOOLEAN_ONLY"],
  ["out stock", { rawLabel: "Out of stock" }, "OUT_OF_STOCK", "BOOLEAN_ONLY"],
  ["ua absent", { rawLabel: "Немає" }, "OUT_OF_STOCK", "BOOLEAN_ONLY"],
  ["ru absent", { rawLabel: "Нет в наличии" }, "OUT_OF_STOCK", "BOOLEAN_ONLY"],
  ["orderable", { rawLabel: "Під замовлення" }, "ORDERABLE", "BOOLEAN_ONLY"],
  ["orderable flag", { orderable: true }, "ORDERABLE", "BOOLEAN_ONLY"],
  ["check required", { rawLabel: "Уточнюйте" }, "CHECK_REQUIRED", "BAND"],
  ["available flag", { available: true }, "AVAILABLE", "BOOLEAN_ONLY"],
  ["unavailable flag", { available: false }, "OUT_OF_STOCK", "BOOLEAN_ONLY"],
  ["unknown label", { rawLabel: "warehouse-A" }, "UNKNOWN", "BAND"],
  ["nothing known", {}, "UNKNOWN", "UNKNOWN"],
] as const;
for (const [name, input, state, quantityMode] of availabilityCases) {
  check(`availability ${name}`, () => {
    const decision = deriveAvailability(input);
    assert.equal(decision.state, state);
    assert.equal(decision.quantityMode, quantityMode);
  });
}

const offerKeyCases = [
  [{ supplierRecordKey: "r1", externalProductId: "EXT-1", warehouseKey: "KYIV-1" }, "EXT1:KYIV1"],
  [{ supplierRecordKey: "r1", supplierArticle: "A-100", warehouseKey: null }, "A100:DEFAULT"],
  [{ supplierRecordKey: "row-77", warehouseKey: "Lviv 2" }, "ROW77:LVIV2"],
  [{ supplierRecordKey: " row 9 ", externalProductId: "", supplierArticle: "" }, "ROW9:DEFAULT"],
] as const;
for (const [input, expected] of offerKeyCases) {
  check(`offer key ${expected}`, () => assert.equal(buildOfferKey(input), expected));
}

const priceCases = [
  ["no current", { currentPrice: null, incomingPrice: 100 }, false, null],
  ["same", { currentPrice: 100, incomingPrice: 100 }, false, 0],
  ["plus 10", { currentPrice: 100, incomingPrice: 110 }, false, 0.1],
  ["minus 10", { currentPrice: 100, incomingPrice: 90 }, false, 0.1],
  ["boundary 50", { currentPrice: 100, incomingPrice: 150 }, false, 0.5],
  ["over 50", { currentPrice: 100, incomingPrice: 151 }, true, 0.51],
  ["custom threshold", { currentPrice: 100, incomingPrice: 121, maxChangeRatio: 0.2 }, true, 0.21],
  ["negative incoming", { currentPrice: 100, incomingPrice: -1 }, true, null],
] as const;
for (const [name, input, anomaly, ratio] of priceCases) {
  check(`price ${name}`, () => {
    const result = detectPriceAnomaly(input);
    assert.equal(result.anomaly, anomaly);
    if (ratio == null) assert.equal(result.changeRatio, null);
    else assert.ok(Math.abs((result.changeRatio ?? 0) - ratio) < 1e-9);
  });
}

assert.ok(assertions >= 120, `expected at least 120 golden assertions, got ${assertions}`);
console.log(`supplier-ingestion-smoke: PASS (${assertions} golden assertions)`);
