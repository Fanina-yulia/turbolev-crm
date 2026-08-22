import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  UNIQUE_TRADE_QA_PREVIEW_POLICY,
  summarizeUniqueTradeQAPreview,
} from "../src/services/supplier-unique-trade-shadow-preview-qa.service";
import type { UniqueTradeShadowPreview } from "../src/services/supplier-unique-trade-shadow-ingestion.service";

const synthetic = {
  provider: "UNIQUE_TRADE",
  integrationScope: "UNIQUE_TRADE_SEARCH_SHADOW_V1",
  offerCount: 2,
  recordCount: 3,
  recordsWithIdentityCandidates: 2,
  batch: {
    supplierId: "supplier-secret-id",
    integrationScope: "UNIQUE_TRADE_SEARCH_SHADOW_V1",
    mode: "API_POLL",
    adapterVersion: "unique-trade-search-shadow/1",
    schemaVersion: "supplier-ingestion/v1",
    sourceVersion: null,
    providerDeclaredComplete: false,
    records: [
      {
        rawChecksum: "raw-secret-1",
        normalized: {
          supplierRecordKey: "secret-record-1",
          externalProductId: "detail-secret-1",
          supplierArticleRaw: "0986494596",
          supplierArticleNorm: "0986494596",
          brandRaw: "BOSCH",
          brandNormalized: "BOSCH",
          mpnCandidateRaw: "0986494596",
          mpnCandidateNorm: "0986494596",
          currency: "UAH",
          purchasePrice: 1234.56,
          quantityMode: "EXACT",
          exactQty: 7,
          warehouseKey: "UTR:secret-warehouse-10",
          sourceUpdatedAt: null,
          sourceTimeTrusted: false,
          rawPayload: { token: "must-not-leak", password: "must-not-leak" },
        },
        identityCandidates: [{ productId: "product-secret-1", brandMpnExact: true }],
      },
      {
        rawChecksum: "raw-secret-2",
        normalized: {
          supplierRecordKey: "secret-record-2",
          quantityMode: "BAND",
          availabilityBand: "10+",
          warehouseKey: "UTR:secret-warehouse-20",
          sourceUpdatedAt: null,
          sourceTimeTrusted: false,
          rawPayload: { article: "another-secret-article", purchasePrice: 999 },
        },
        identityCandidates: [{ productId: "product-secret-2", trustedExternalId: true }],
      },
      {
        rawChecksum: "raw-secret-3",
        normalized: {
          supplierRecordKey: "secret-record-3",
          quantityMode: "BOOLEAN_ONLY",
          supplierAvailabilityRaw: "available",
          warehouseKey: null,
          sourceUpdatedAt: null,
          sourceTimeTrusted: false,
          rawPayload: { warehouse: "secret-warehouse-label" },
        },
        identityCandidates: [],
      },
    ],
    metadata: {
      queryHash: "abcdef0123456789abcdef01",
      rawQueryStored: false,
      providerOrderingEvidence: false,
      identityResolutionMode: "BATCH",
    },
  },
} as unknown as UniqueTradeShadowPreview;

const summary = summarizeUniqueTradeQAPreview(synthetic, 123.6);
assert.equal(summary.status, "OK");
assert.equal(summary.environment, "preview");
assert.equal(summary.provider, "UNIQUE_TRADE");
assert.equal(summary.sanitized, true);
assert.equal(summary.writeMode, "READ_ONLY");
assert.equal(summary.fixedQueryFingerprint, "abcdef0123456789abcdef01");
assert.equal(summary.offerCount, 2);
assert.equal(summary.recordCount, 3);
assert.equal(summary.recordsWithIdentityCandidates, 2);
assert.equal(summary.identityCoverageRatio, 0.6667);
assert.equal(summary.warehouseCount, 2);
assert.deepEqual(summary.quantityModes, {
  EXACT: 1,
  BAND: 1,
  BOOLEAN_ONLY: 1,
  UNKNOWN: 0,
});
assert.equal(summary.providerDeclaredComplete, false);
assert.equal(summary.providerOrderingEvidence, false);
assert.equal(summary.rawQueryStored, false);
assert.equal(summary.identityResolutionMode, "BATCH");
assert.equal(summary.durationMs, 124);

assert.deepEqual(UNIQUE_TRADE_QA_PREVIEW_POLICY, {
  fixedQuery: true,
  acceptsUserQuery: false,
  previewOnly: true,
  sanitizedOutput: true,
  persistenceAllowed: false,
  supplierOrderAllowed: false,
  rawPayloadAllowed: false,
  purchasePriceAllowed: false,
});

const serialized = JSON.stringify(summary);
for (const forbidden of [
  "0986494596",
  "BOSCH",
  "1234.56",
  "999",
  "secret-warehouse",
  "product-secret",
  "detail-secret",
  "must-not-leak",
  "password",
  "token",
  "supplier-secret-id",
]) {
  assert.equal(serialized.includes(forbidden), false, `sanitized summary leaked: ${forbidden}`);
}

const routeSource = readFileSync(
  new URL("../app/api/internal/qa/suppliers/unique-trade-preview/route.ts", import.meta.url),
  "utf8",
);
assert.equal(routeSource.includes('process.env.VERCEL_ENV !== "preview"'), true);
assert.equal(routeSource.includes("searchParams"), false);
assert.equal(routeSource.includes("persistSupplierIngestionBatch"), false);
assert.equal(routeSource.includes("submitOrder"), false);
assert.equal(routeSource.includes("purchasePrice"), false);
assert.equal(routeSource.includes("rawPayload"), false);
assert.equal(routeSource.includes("password"), false);
assert.equal(routeSource.includes("token"), false);

console.log("unique-trade-shadow-preview-qa-smoke: PASS");
