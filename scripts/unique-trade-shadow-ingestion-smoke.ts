import assert from "node:assert/strict";

import { decideIncomingOrder } from "../src/services/supplier-ingestion-policy";
import {
  UNIQUE_TRADE_SHADOW_INGESTION_ACTIVATION,
  UniqueTradeShadowWriteDisabledError,
  assertUniqueTradeShadowWritesEnabled,
  buildUniqueTradeShadowBatch,
  buildUniqueTradeShadowRecords,
} from "../src/services/supplier-unique-trade-shadow-ingestion.service";
import type { SupplierOffer } from "../src/services/suppliers/types";

function offer(overrides: Partial<SupplierOffer> = {}): SupplierOffer {
  return {
    supplierId: "unique-trade",
    supplierName: "Юнік Трейд",
    externalProductId: "12345",
    article: "0 986 494 596",
    brand: " Bosch ",
    name: "Brake pads",
    purchasePrice: 1000,
    currency: "uah",
    multiplicity: 1,
    stock: [{ warehouse: "Київ", warehouseId: "10", quantity: "7" }],
    available: true,
    sourceUrl: "https://order24.utr.ua/ua/home",
    ...overrides,
  };
}

const exact = buildUniqueTradeShadowRecords([offer()]);
assert.equal(exact.length, 1);
assert.equal(exact[0].normalized.quantityMode, "EXACT");
assert.equal(exact[0].normalized.exactQty, 7);
assert.equal(exact[0].normalized.warehouseKey, "UTR:10");
assert.equal(exact[0].normalized.brandNormalized, "BOSCH");
assert.equal(exact[0].normalized.mpnCandidateNorm, "0986494596");
assert.equal(exact[0].normalized.currency, "UAH");
assert.equal(exact[0].normalized.sourceUpdatedAt, null);
assert.equal(exact[0].normalized.sourceTimeTrusted, false);

const band = buildUniqueTradeShadowRecords([
  offer({ stock: [{ warehouse: "Основний", warehouseId: "11", quantity: "10+" }] }),
]);
assert.equal(band[0].normalized.quantityMode, "BAND");
assert.equal(band[0].normalized.exactQty, null);
assert.equal(band[0].normalized.availabilityBand, "10+");

const booleanOnly = buildUniqueTradeShadowRecords([
  offer({ stock: [], available: true }),
]);
assert.equal(booleanOnly.length, 1);
assert.equal(booleanOnly[0].normalized.quantityMode, "BOOLEAN_ONLY");
assert.equal(booleanOnly[0].normalized.exactQty, null);

const unavailable = buildUniqueTradeShadowRecords([
  offer({ stock: [], available: false }),
]);
assert.equal(unavailable.length, 1);
assert.equal(unavailable[0].normalized.quantityMode, "EXACT");
assert.equal(unavailable[0].normalized.exactQty, 0);

const multiWarehouse = buildUniqueTradeShadowRecords([
  offer({
    stock: [
      { warehouse: "Київ", warehouseId: "10", quantity: "7" },
      { warehouse: "Львів", warehouseId: "20", quantity: "3" },
    ],
  }),
]);
assert.equal(multiWarehouse.length, 2);
assert.notEqual(
  multiWarehouse[0].normalized.supplierRecordKey,
  multiWarehouse[1].normalized.supplierRecordKey,
);
assert.notEqual(
  multiWarehouse[0].normalized.warehouseKey,
  multiWarehouse[1].normalized.warehouseKey,
);

const repeat = buildUniqueTradeShadowRecords([offer()]);
assert.equal(repeat[0].normalized.supplierRecordKey, exact[0].normalized.supplierRecordKey);
assert.equal(repeat[0].rawChecksum, exact[0].rawChecksum);

const duplicateStock = buildUniqueTradeShadowRecords([
  offer({
    stock: [
      { warehouse: "Київ", warehouseId: "10", quantity: "7" },
      { warehouse: "Київ duplicate", warehouseId: "10", quantity: "7" },
    ],
  }),
]);
assert.equal(duplicateStock.length, 1);

const secretLikeOffer = {
  ...offer(),
  password: "must-not-leak",
  token: "must-not-leak",
  authorization: "must-not-leak",
} as SupplierOffer & Record<string, unknown>;
const secretRecord = buildUniqueTradeShadowRecords([secretLikeOffer])[0];
const rawPayload = JSON.stringify(secretRecord.normalized.rawPayload);
assert.equal(rawPayload.includes("must-not-leak"), false);
assert.equal(rawPayload.includes("password"), false);
assert.equal(rawPayload.includes("authorization"), false);

const query = " Bosch 0 986 494 596 ";
const providerStartedAt = new Date("2026-08-22T16:00:00.000Z");
const providerFinishedAt = new Date("2026-08-22T16:00:01.000Z");
const batch = await buildUniqueTradeShadowBatch({
  supplierId: "sup_test",
  query,
  offers: [offer()],
  providerStartedAt,
  providerFinishedAt,
  resolveIdentity: async (record) => {
    assert.equal(record.brandNormalized, "BOSCH");
    assert.equal(record.mpnCandidateNorm, "0986494596");
    return [{ productId: "prod_001", brandMpnExact: true }];
  },
});
assert.equal(batch.mode, "API_POLL");
assert.equal(batch.providerDeclaredComplete, false);
assert.equal(batch.integrationScope, "UNIQUE_TRADE_SEARCH_SHADOW_V1");
assert.equal(batch.records.length, 1);
assert.deepEqual(batch.records[0].identityCandidates, [
  { productId: "prod_001", brandMpnExact: true },
]);
assert.equal(batch.sourceVersion, null);
assert.equal(batch.providerStartedAt?.toISOString(), providerStartedAt.toISOString());
assert.equal(batch.providerFinishedAt?.toISOString(), providerFinishedAt.toISOString());
assert.match(String(batch.metadata?.queryHash ?? ""), /^[a-f0-9]{24}$/);
assert.equal(JSON.stringify(batch.metadata).includes(query.trim()), false);
assert.equal(batch.metadata?.rawQueryStored, false);
assert.equal(batch.metadata?.providerOrderingEvidence, false);
assert.equal(batch.metadata?.changedCommercialPayloadPolicy, "RECONCILE_FAIL_CLOSED");
assert.equal(batch.maxIdentityProblemRatio, 1);
assert.equal(batch.maxRejectedRatio, 1);

// Unique Trade search does not expose an authoritative provider updated_at/version today.
// A changed payload without ordering evidence must remain fail-closed rather than silently
// replacing the previously persisted commercial state.
const unorderedChangedPayload = decideIncomingOrder({
  currentSourceUpdatedAt: null,
  incomingSourceUpdatedAt: null,
  currentSourceTimeTrusted: false,
  incomingSourceTimeTrusted: false,
  currentSourceVersion: null,
  incomingSourceVersion: null,
  currentSemanticHash: "old-semantic-hash",
  incomingSemanticHash: "new-semantic-hash",
});
assert.equal(unorderedChangedPayload.apply, false);
assert.equal(unorderedChangedPayload.idempotent, false);
assert.equal(unorderedChangedPayload.reason, "INSUFFICIENT_ORDERING_EVIDENCE");

const shadowEnv = UNIQUE_TRADE_SHADOW_INGESTION_ACTIVATION.envName;
const shadowValue = UNIQUE_TRADE_SHADOW_INGESTION_ACTIVATION.requiredEnvValue;
const shadowConfirmation = UNIQUE_TRADE_SHADOW_INGESTION_ACTIVATION.requiredConfirmation;
const persistenceEnv = UNIQUE_TRADE_SHADOW_INGESTION_ACTIVATION.persistenceEnvName;
const persistenceValue = UNIQUE_TRADE_SHADOW_INGESTION_ACTIVATION.persistenceRequiredEnvValue;
const persistenceConfirmation = UNIQUE_TRADE_SHADOW_INGESTION_ACTIVATION.persistenceRequiredConfirmation;

function expectDisabled(
  env: Record<string, string | undefined>,
  shadowConfirm = shadowConfirmation,
  persistenceConfirm = persistenceConfirmation,
) {
  assert.throws(
    () => assertUniqueTradeShadowWritesEnabled(shadowConfirm, persistenceConfirm, env),
    UniqueTradeShadowWriteDisabledError,
  );
}

expectDisabled({});
expectDisabled({ [shadowEnv]: shadowValue });
expectDisabled({ [persistenceEnv]: persistenceValue });
expectDisabled(
  { [shadowEnv]: shadowValue, [persistenceEnv]: persistenceValue },
  "wrong-shadow-confirmation",
);
expectDisabled(
  { [shadowEnv]: shadowValue, [persistenceEnv]: persistenceValue },
  shadowConfirmation,
  "wrong-persistence-confirmation",
);
assert.doesNotThrow(() =>
  assertUniqueTradeShadowWritesEnabled(
    shadowConfirmation,
    persistenceConfirmation,
    { [shadowEnv]: shadowValue, [persistenceEnv]: persistenceValue },
  ),
);

console.log("unique-trade-shadow-ingestion-smoke: PASS");
