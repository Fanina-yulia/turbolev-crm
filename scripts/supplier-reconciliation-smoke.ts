import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getPrisma } from "../src/lib/prisma";
import {
  escalateSupplierReconciliationTask,
  listSupplierReconciliationTasks,
  rejectSupplierReconciliationTask,
  resolveSupplierReconciliationTask,
  searchSupplierReconciliationProducts,
  SupplierReconciliationError,
} from "../src/services/supplier-reconciliation.service";

const prisma = getPrisma();
const stamp = `REC_${Date.now()}`;
const actor = { actorId: `actor_${stamp}`, actorName: "Supplier QA" };

const supplier = await prisma.supplier.upsert({
  where: { code: "OTHER" },
  create: {
    code: "OTHER",
    name: "Supplier reconciliation QA",
    isActive: true,
    priority: 999,
    defaultMarkupPercent: 40,
    defaultCurrency: "UAH",
  },
  update: { name: "Supplier reconciliation QA", isActive: true },
});

const brand = await prisma.brand.create({
  data: {
    canonicalName: `Reconciliation Brand ${stamp}`,
    normalizedName: `RECONCILIATION BRAND ${stamp}`,
    slug: `reconciliation-brand-${stamp.toLowerCase()}`,
    status: "ACTIVE",
  },
});

async function makeProduct(code: string, title: string, status: "ACTIVE" | "INACTIVE" = "ACTIVE") {
  return prisma.product.create({
    data: {
      brandId: brand.id,
      mpnRaw: `${stamp}-${code}`,
      mpnNormalized: `${stamp}${code}`,
      mpnSearchNormalized: `${stamp}${code}`,
      title,
      slug: `reconciliation-${stamp.toLowerCase()}-${code.toLowerCase()}`,
      status,
    },
  });
}

const productA = await makeProduct("A", "Reconciliation product A");
const productB = await makeProduct("B", "Reconciliation product B");
const inactiveProduct = await makeProduct("INACTIVE", "Reconciliation hidden product", "INACTIVE");

const batch = await prisma.supplierImportBatch.create({
  data: {
    supplierId: supplier.id,
    integrationScope: stamp,
    mode: "INCREMENTAL",
    status: "PUBLISHED",
    publishStatus: "PUBLISHED",
    sourceVersion: "v1",
    sourceChecksum: `checksum-${stamp}`,
    adapterVersion: "qa-reconciliation/1",
    schemaVersion: "qa/1",
    semanticFingerprint: `fingerprint-${stamp}`,
    recordsReceived: 6,
    recordsValid: 6,
    recordsMatched: 0,
    recordsAmbiguous: 6,
  },
});

async function makeTask(key: string, reason: "UNMATCHED" | "AMBIGUOUS" | "IDENTITY_CONFLICT", options: { secretEvidence?: boolean } = {}) {
  const record = await prisma.supplierImportRecord.create({
    data: {
      batchId: batch.id,
      supplierRecordKey: `${stamp}-${key}`,
      state: reason === "UNMATCHED" ? "UNMATCHED" : reason === "AMBIGUOUS" ? "AMBIGUOUS" : "CONFLICT",
      rawChecksum: `raw-${stamp}-${key}`,
      rawPayload: { ignoredByWorkspace: true, password: "RAW_SECRET_SHOULD_NEVER_SURFACE" },
      externalProductId: `external-${key}`,
      supplierArticleRaw: `${stamp}-${key}`,
      supplierArticleNorm: `${stamp}${key}`,
      brandRaw: brand.canonicalName,
      brandNormalized: brand.normalizedName,
      mpnCandidateRaw: `${stamp}-${key}`,
      mpnCandidateNorm: `${stamp}${key}`,
      currency: "UAH",
      purchasePrice: 123,
      quantityMode: "EXACT",
      exactQty: 7,
      sourceTimeTrusted: true,
      identityEvidence: options.secretEvidence ? { apiToken: "DO_NOT_LEAK", publicReason: "candidate mismatch" } : { publicReason: "candidate mismatch" },
    },
  });
  const task = await prisma.supplierReconciliationTask.create({
    data: {
      supplierId: supplier.id,
      batchId: batch.id,
      importRecordId: record.id,
      status: "OPEN",
      reason,
      priority: 10,
      evidence: options.secretEvidence ? { credentialSecret: "DO_NOT_LEAK_2", source: "qa" } : { source: "qa" },
    },
  });
  return { task, record };
}

const resolveFixture = await makeTask("RESOLVE", "AMBIGUOUS");
await prisma.supplierReconciliationCandidate.createMany({
  data: [
    { taskId: resolveFixture.task.id, productId: productA.id, rank: 1, score: 88, reasonCodes: ["BRAND_MPN"] },
    { taskId: resolveFixture.task.id, productId: productB.id, rank: 2, score: 75, reasonCodes: ["GTIN_CONFLICT"] },
  ],
});

const resolved = await resolveSupplierReconciliationTask({ ...actor, taskId: resolveFixture.task.id, productId: productA.id, notes: "checked A" });
assert.equal(resolved.status, "RESOLVED");
assert.equal(resolved.offerPublished, false);
const mappingAfterResolve = await prisma.supplierIdentityMapping.findUniqueOrThrow({
  where: {
    supplierId_integrationScope_supplierRecordKey: {
      supplierId: supplier.id,
      integrationScope: stamp,
      supplierRecordKey: resolveFixture.record.supplierRecordKey,
    },
  },
});
assert.equal(mappingAfterResolve.productId, productA.id);
assert.equal(mappingAfterResolve.method, "MANUAL");
assert.equal(mappingAfterResolve.isApproved, true);
assert.equal(mappingAfterResolve.isActive, true);
const recordAfterResolve = await prisma.supplierImportRecord.findUniqueOrThrow({ where: { id: resolveFixture.record.id } });
assert.equal(recordAfterResolve.state, "MATCHED");
assert.equal(recordAfterResolve.matchedProductId, productA.id);
assert.equal(recordAfterResolve.mappingMethod, "MANUAL");
assert.equal(recordAfterResolve.matchConfidence, 100);
assert.equal(await prisma.supplierOffer.count({ where: { supplierId: supplier.id, integrationScope: stamp } }), 0);
assert.equal(await prisma.auditEvent.count({ where: { entityId: resolveFixture.task.id, action: "SUPPLIER_RECONCILIATION_RESOLVED" } }), 1);

const repointFixture = await makeTask("REPOINT", "IDENTITY_CONFLICT");
const existingMapping = await prisma.supplierIdentityMapping.create({
  data: {
    supplierId: supplier.id,
    integrationScope: stamp,
    supplierRecordKey: repointFixture.record.supplierRecordKey,
    productId: productA.id,
    method: "BRAND_MPN",
    confidence: 80,
    isApproved: false,
    isActive: true,
  },
});
const repointed = await resolveSupplierReconciliationTask({ ...actor, taskId: repointFixture.task.id, productId: productB.id, notes: "trusted staff repoint" });
assert.equal(repointed.status, "RESOLVED");
const mappingAfterRepoint = await prisma.supplierIdentityMapping.findUniqueOrThrow({ where: { id: existingMapping.id } });
assert.equal(mappingAfterRepoint.productId, productB.id);
assert.equal(mappingAfterRepoint.method, "MANUAL");
assert.equal(mappingAfterRepoint.isApproved, true);
assert.equal(await prisma.supplierIdentityMapping.count({ where: { supplierId: supplier.id, integrationScope: stamp, supplierRecordKey: repointFixture.record.supplierRecordKey } }), 1);
assert.equal(await prisma.auditEvent.count({ where: { entityId: repointFixture.task.id, action: "SUPPLIER_RECONCILIATION_MAPPING_REPOINTED" } }), 1);

const rejectFixture = await makeTask("REJECT", "UNMATCHED");
const productCountBeforeReject = await prisma.product.count();
const rejected = await rejectSupplierReconciliationTask({ ...actor, taskId: rejectFixture.task.id, notes: "invalid supplier identity" });
assert.equal(rejected.status, "REJECTED");
assert.equal((await prisma.supplierImportRecord.findUniqueOrThrow({ where: { id: rejectFixture.record.id } })).state, "REJECTED");
assert.equal(await prisma.product.count(), productCountBeforeReject);
assert.equal(await prisma.auditEvent.count({ where: { entityId: rejectFixture.task.id, action: "SUPPLIER_RECONCILIATION_REJECTED" } }), 1);

const escalateFixture = await makeTask("ESCALATE", "UNMATCHED");
const productCountBeforeEscalate = await prisma.product.count();
const escalated = await escalateSupplierReconciliationTask({ ...actor, taskId: escalateFixture.task.id, notes: "needs catalog authoring" });
assert.equal(escalated.status, "ESCALATED");
assert.equal(escalated.catalogAuthoringRequired, true);
assert.equal((await prisma.supplierImportRecord.findUniqueOrThrow({ where: { id: escalateFixture.record.id } })).state, "UNMATCHED");
assert.equal(await prisma.product.count(), productCountBeforeEscalate);
assert.equal(await prisma.supplierOffer.count({ where: { supplierId: supplier.id, integrationScope: stamp } }), 0);
assert.equal(await prisma.auditEvent.count({ where: { entityId: escalateFixture.task.id, action: "SUPPLIER_RECONCILIATION_ESCALATED" } }), 1);

// Two staff actions targeting the same canonical mapping may race. Exactly one is
// allowed to commit; the other must fail closed via advisory lock or closed-state recheck.
const raceFixture = await makeTask("RACE", "AMBIGUOUS");
const raceResults = await Promise.allSettled([
  resolveSupplierReconciliationTask({ ...actor, taskId: raceFixture.task.id, productId: productA.id, notes: "race A" }),
  resolveSupplierReconciliationTask({ ...actor, taskId: raceFixture.task.id, productId: productB.id, notes: "race B" }),
]);
const fulfilledRace = raceResults.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof resolveSupplierReconciliationTask>>> => result.status === "fulfilled");
const rejectedRace = raceResults.filter((result): result is PromiseRejectedResult => result.status === "rejected");
assert.equal(fulfilledRace.length, 1);
assert.equal(rejectedRace.length, 1);
assert.equal(fulfilledRace[0].value.status, "RESOLVED");
assert.ok(rejectedRace[0].reason instanceof SupplierReconciliationError);
assert.ok(["CONCURRENT_UPDATE", "INVALID_STATE"].includes((rejectedRace[0].reason as SupplierReconciliationError).code));
const raceTask = await prisma.supplierReconciliationTask.findUniqueOrThrow({ where: { id: raceFixture.task.id } });
assert.equal(raceTask.status, "RESOLVED");
const raceMapping = await prisma.supplierIdentityMapping.findUniqueOrThrow({
  where: {
    supplierId_integrationScope_supplierRecordKey: {
      supplierId: supplier.id,
      integrationScope: stamp,
      supplierRecordKey: raceFixture.record.supplierRecordKey,
    },
  },
});
assert.equal(raceMapping.productId, fulfilledRace[0].value.product.id);
assert.equal(await prisma.auditEvent.count({ where: { entityId: raceFixture.task.id, action: "SUPPLIER_RECONCILIATION_RESOLVED" } }), 1);
assert.equal(await prisma.supplierIdentityMapping.count({ where: { supplierId: supplier.id, integrationScope: stamp, supplierRecordKey: raceFixture.record.supplierRecordKey } }), 1);

const secretFixture = await makeTask("SECRET", "AMBIGUOUS", { secretEvidence: true });
const listed = await listSupplierReconciliationTasks({ statuses: ["OPEN"], q: secretFixture.record.supplierRecordKey, take: 10 });
assert.equal(listed.tasks.length, 1);
const serialized = JSON.stringify(listed.tasks[0]);
assert.equal(serialized.includes("DO_NOT_LEAK"), false);
assert.equal(serialized.includes("RAW_SECRET_SHOULD_NEVER_SURFACE"), false);
assert.equal(serialized.includes("[REDACTED]"), true);

const activeSearch = await searchSupplierReconciliationProducts(`${stamp}-A`, 30);
assert.ok(activeSearch.some((row) => row.id === productA.id));
const inactiveSearch = await searchSupplierReconciliationProducts("Reconciliation hidden product", 30);
assert.equal(inactiveSearch.some((row) => row.id === inactiveProduct.id), false);

// Canonical supplier identity is global, so the route must fail closed even if the
// system's global enforcement mode is SHADOW and must require ALL scope under the
// same PARTS_* permissions used by the /api/parts security policy.
const routeSource = readFileSync(
  new URL("../app/api/parts/supplier-reconciliation/route.ts", import.meta.url),
  "utf8",
);
assert.equal(routeSource.includes("authorizePermission"), true);
assert.equal(routeSource.includes("strict: true"), true);
assert.equal(routeSource.includes('minimumScope: "ALL"'), true);
assert.equal(routeSource.includes("PERMISSIONS.PARTS_READ"), true);
assert.equal(routeSource.includes("PERMISSIONS.PARTS_WRITE"), true);
assert.equal(routeSource.includes('enforcementMode === "ENFORCED"'), false);
assert.equal(routeSource.includes("getAccessContext"), false);
assert.equal(routeSource.includes("PERMISSIONS.PROCUREMENT_READ"), false);
assert.equal(routeSource.includes("PERMISSIONS.PROCUREMENT_WRITE"), false);

console.log("supplier-reconciliation-smoke: PASS");
await prisma.$disconnect();
