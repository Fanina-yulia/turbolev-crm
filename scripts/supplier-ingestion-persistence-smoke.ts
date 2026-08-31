import assert from "node:assert/strict";
import { getPrisma } from "../src/lib/prisma";
import {
  assertSupplierIngestionWritesEnabled,
  persistSupplierIngestionBatch,
  SUPPLIER_INGESTION_WRITE_ACTIVATION,
  SupplierIngestionWriteDisabledError,
  type PersistSupplierIngestionBatchInput,
} from "../src/services/supplier-ingestion-persistence.service";
import type { SupplierIngestionRecordInput } from "../src/services/supplier-ingestion-persistence.service";

const WRITE_ENV = {
  SUPPLIER_INGESTION_WRITES_ENABLED: SUPPLIER_INGESTION_WRITE_ACTIVATION.requiredEnvValue,
};

assert.throws(
  () =>
    assertSupplierIngestionWritesEnabled(
      { confirmation: SUPPLIER_INGESTION_WRITE_ACTIVATION.requiredConfirmation },
      {},
    ),
  SupplierIngestionWriteDisabledError,
);
assert.throws(
  () => assertSupplierIngestionWritesEnabled({ confirmation: "wrong" }, WRITE_ENV),
  SupplierIngestionWriteDisabledError,
);
assert.doesNotThrow(() =>
  assertSupplierIngestionWritesEnabled(
    { confirmation: SUPPLIER_INGESTION_WRITE_ACTIVATION.requiredConfirmation },
    WRITE_ENV,
  ),
);

const prisma = getPrisma();
const scope = "SMOKE_PARTS_V1";
const now = Date.now();
const time = (offsetSeconds: number) => new Date(now - 60_000 + offsetSeconds * 1_000);

const supplier = await prisma.supplier.upsert({
  where: { code: "OTHER" },
  create: {
    code: "OTHER",
    name: "Supplier ingestion smoke",
    isActive: true,
    priority: 999,
    defaultMarkupPercent: 40,
    defaultCurrency: "UAH",
  },
  update: { name: "Supplier ingestion smoke", isActive: true },
});

const brand = await prisma.brand.upsert({
  where: { normalizedName: "SMOKE BRAND" },
  create: {
    canonicalName: "Smoke Brand",
    normalizedName: "SMOKE BRAND",
    slug: "smoke-brand-supplier-ingestion",
    status: "ACTIVE",
  },
  update: { status: "ACTIVE" },
});

async function product(code: string, title: string) {
  return prisma.product.upsert({
    where: { brandId_mpnNormalized: { brandId: brand.id, mpnNormalized: code } },
    create: {
      brandId: brand.id,
      mpnRaw: code,
      mpnNormalized: code,
      mpnSearchNormalized: code,
      title,
      slug: `smoke-${code.toLowerCase()}`,
      status: "ACTIVE",
    },
    update: { status: "ACTIVE", title },
  });
}

const [productA, productB, productC] = await Promise.all([
  product("SMOKEA", "Smoke product A"),
  product("SMOKEB", "Smoke product B"),
  product("SMOKEC", "Smoke product C"),
]);

await prisma.supplierFreshnessPolicy.upsert({
  where: {
    supplierId_integrationScope_offerClass: {
      supplierId: supplier.id,
      integrationScope: scope,
      offerClass: "DEFAULT",
    },
  },
  create: {
    supplierId: supplier.id,
    integrationScope: scope,
    offerClass: "DEFAULT",
    freshTtlSeconds: 3_600,
    staleAllowedSeconds: 3_600,
    hardExpirySeconds: 14_400,
    checkoutRevalidate: true,
    staleDisplayAllowed: false,
    providerErrorFallback: false,
    isActive: true,
  },
  update: {
    freshTtlSeconds: 3_600,
    staleAllowedSeconds: 3_600,
    hardExpirySeconds: 14_400,
    isActive: true,
  },
});

function row(
  productId: string | null,
  key: string,
  article: string,
  price: number,
  sourceUpdatedAt: Date,
): SupplierIngestionRecordInput {
  return {
    rawChecksum: `checksum:${key}:${price}:${sourceUpdatedAt.toISOString()}`,
    normalized: {
      supplierRecordKey: key,
      externalProductId: `external:${article}`,
      supplierArticleRaw: article,
      brandRaw: "Smoke Brand",
      mpnCandidateRaw: article,
      currency: "UAH",
      purchasePrice: price,
      quantityMode: "EXACT",
      exactQty: 10,
      minOrderQty: 1,
      multiplicity: 1,
      warehouseKey: "MAIN",
      sourceUpdatedAt,
      sourceTimeTrusted: true,
      rawPayload: { key, article, price, sourceUpdatedAt: sourceUpdatedAt.toISOString() },
    },
    identityCandidates: productId ? [{ productId, brandMpnExact: true }] : [],
  };
}

function batch(
  sourceVersion: string,
  mode: PersistSupplierIngestionBatchInput["mode"],
  records: SupplierIngestionRecordInput[],
  providerDeclaredComplete = false,
  overrides: Partial<PersistSupplierIngestionBatchInput> = {},
): PersistSupplierIngestionBatchInput {
  return {
    supplierId: supplier.id,
    integrationScope: scope,
    mode,
    adapterVersion: "smoke-adapter/1",
    schemaVersion: "smoke-schema/1",
    sourceVersion,
    sourceChecksum: `snapshot:${sourceVersion}`,
    providerDeclaredComplete,
    records,
    ...overrides,
  };
}

const activation = { confirmation: SUPPLIER_INGESTION_WRITE_ACTIVATION.requiredConfirmation };

const a1 = batch("v1", "INCREMENTAL", [row(productA.id, "A", "SMOKEA", 100, time(1))]);
const first = await persistSupplierIngestionBatch(a1, activation);
assert.equal(first.published, true);
assert.equal(first.publishBlocked, false);

const duplicate = await persistSupplierIngestionBatch(a1, activation);
assert.equal(duplicate.idempotent, true);
assert.equal(duplicate.batchId, first.batchId);

await persistSupplierIngestionBatch(
  batch("v2", "INCREMENTAL", [row(productB.id, "B", "SMOKEB", 200, time(2))]),
  activation,
);
await persistSupplierIngestionBatch(
  batch("v3", "INCREMENTAL", [row(productC.id, "C", "SMOKEC", 300, time(3))]),
  activation,
);
assert.equal(
  await prisma.supplierOffer.count({ where: { supplierId: supplier.id, integrationScope: scope, status: "ACTIVE" } }),
  3,
);

const massDrop = await persistSupplierIngestionBatch(
  batch("v4", "FULL_SNAPSHOT", [row(productA.id, "A", "SMOKEA", 100, time(4))], true),
  activation,
);
assert.equal(massDrop.publishBlocked, true);
assert.ok(massDrop.reasons.includes("FULL_SNAPSHOT_MASS_DROP_GUARD"));
assert.equal(
  await prisma.supplierOffer.count({ where: { supplierId: supplier.id, integrationScope: scope, status: "ACTIVE" } }),
  3,
);

const cleanFull = await persistSupplierIngestionBatch(
  batch(
    "v5",
    "FULL_SNAPSHOT",
    [
      row(productA.id, "A", "SMOKEA", 100, time(5)),
      row(productB.id, "B", "SMOKEB", 200, time(5)),
    ],
    true,
  ),
  activation,
);
assert.equal(cleanFull.published, true);
assert.equal(cleanFull.missingOffersDeactivated, 1);
const cAfterFull = await prisma.supplierOffer.findUniqueOrThrow({
  where: {
    supplierId_integrationScope_offerKey: {
      supplierId: supplier.id,
      integrationScope: scope,
      offerKey: "EXTERNALSMOKEC:MAIN",
    },
  },
});
assert.equal(cAfterFull.status, "NOT_PRESENT");

await persistSupplierIngestionBatch(
  batch("v6", "INCREMENTAL", [row(productC.id, "C", "SMOKEC", 300, time(6))]),
  activation,
);
assert.equal(
  (
    await prisma.supplierOffer.findUniqueOrThrow({
      where: {
        supplierId_integrationScope_offerKey: {
          supplierId: supplier.id,
          integrationScope: scope,
          offerKey: "EXTERNALSMOKEC:MAIN",
        },
      },
    })
  ).status,
  "ACTIVE",
);

const beforeA = await prisma.supplierOffer.findUniqueOrThrow({
  where: {
    supplierId_integrationScope_offerKey: {
      supplierId: supplier.id,
      integrationScope: scope,
      offerKey: "EXTERNALSMOKEA:MAIN",
    },
  },
});
const beforeB = await prisma.supplierOffer.findUniqueOrThrow({
  where: {
    supplierId_integrationScope_offerKey: {
      supplierId: supplier.id,
      integrationScope: scope,
      offerKey: "EXTERNALSMOKEB:MAIN",
    },
  },
});
const conflict = await persistSupplierIngestionBatch(
  batch(
    "v7",
    "INCREMENTAL",
    [
      row(productA.id, "A", "SMOKEA", 110, time(7)),
      row(productB.id, "B", "SMOKEB", 500, time(7)),
    ],
  ),
  activation,
);
assert.equal(conflict.publishBlocked, true);
assert.ok(conflict.reasons.includes("COMMERCIAL_RECONCILIATION_REQUIRED"));
const afterA = await prisma.supplierOffer.findUniqueOrThrow({
  where: {
    supplierId_integrationScope_offerKey: {
      supplierId: supplier.id,
      integrationScope: scope,
      offerKey: "EXTERNALSMOKEA:MAIN",
    },
  },
});
const afterB = await prisma.supplierOffer.findUniqueOrThrow({
  where: {
    supplierId_integrationScope_offerKey: {
      supplierId: supplier.id,
      integrationScope: scope,
      offerKey: "EXTERNALSMOKEB:MAIN",
    },
  },
});
assert.equal(Number(afterA.purchasePrice), Number(beforeA.purchasePrice));
assert.equal(Number(afterB.purchasePrice), Number(beforeB.purchasePrice));
assert.equal(afterA.sourceVersion, beforeA.sourceVersion);
assert.equal(afterB.sourceVersion, beforeB.sourceVersion);
assert.ok(
  (await prisma.supplierReconciliationTask.count({ where: { batchId: conflict.batchId, status: "OPEN" } })) >= 1,
);

const nonCleanFull = await persistSupplierIngestionBatch(
  batch(
    "v8",
    "FULL_SNAPSHOT",
    [
      row(productA.id, "A", "SMOKEA", 100, time(8)),
      row(productB.id, "B", "SMOKEB", 200, time(8)),
      row(null, "UNKNOWN", "UNKNOWN-1", 50, time(8)),
    ],
    true,
    { maxIdentityProblemRatio: 0.5 },
  ),
  activation,
);
assert.equal(nonCleanFull.published, true);
assert.equal(nonCleanFull.missingOffersDeactivated, 0);
assert.ok(nonCleanFull.reasons.includes("MISSING_ROW_DEACTIVATION_WITHHELD_DUE_TO_NON_CLEAN_ROWS"));
const cAfterNonClean = await prisma.supplierOffer.findUniqueOrThrow({
  where: {
    supplierId_integrationScope_offerKey: {
      supplierId: supplier.id,
      integrationScope: scope,
      offerKey: "EXTERNALSMOKEC:MAIN",
    },
  },
});
assert.equal(cAfterNonClean.status, "ACTIVE");

assert.equal(await prisma.supplierProductQuote.count({ where: { supplierId: supplier.id } }), 0);

const cursor = await prisma.supplierSyncCursor.findUniqueOrThrow({
  where: { supplierId_integrationScope: { supplierId: supplier.id, integrationScope: scope } },
});
assert.equal(cursor.lastSourceVersion, "v8");
assert.equal(cursor.consecutiveFailures, 0);

console.log("supplier-ingestion-persistence-smoke: PASS");
await prisma.$disconnect();
