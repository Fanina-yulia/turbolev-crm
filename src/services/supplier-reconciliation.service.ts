import type { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

const OPEN_STATUSES = ["OPEN", "IN_REVIEW", "ESCALATED"] as const;
type OpenStatus = (typeof OPEN_STATUSES)[number];

type Actor = {
  actorId: string;
  actorName: string;
};

type ListInput = {
  statuses?: string[];
  supplierId?: string | null;
  reason?: string | null;
  q?: string | null;
  take?: number;
};

type MutationBase = Actor & {
  taskId: string;
  notes?: string | null;
};

export class SupplierReconciliationError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "INVALID_STATE" | "INVALID_PRODUCT" | "INVALID_INPUT",
    message: string,
  ) {
    super(message);
    this.name = "SupplierReconciliationError";
  }
}

function boundedTake(value: number | undefined) {
  if (!Number.isFinite(value)) return 50;
  return Math.min(Math.max(Math.trunc(value || 50), 1), 100);
}

function cleanNotes(value: string | null | undefined) {
  const next = value?.trim() || null;
  return next ? next.slice(0, 2_000) : null;
}

function redactEvidence(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactEvidence(item, depth + 1));
  if (typeof value !== "object") return String(value);

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    if (/secret|token|password|authorization|credential|api[_-]?key/i.test(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    result[key] = redactEvidence(item, depth + 1);
  }
  return result;
}

function normalizeStatuses(values: string[] | undefined): OpenStatus[] {
  if (!values?.length) return [...OPEN_STATUSES];
  const accepted = new Set<string>(OPEN_STATUSES);
  const result = values.map((value) => value.trim().toUpperCase()).filter((value): value is OpenStatus => accepted.has(value));
  return result.length ? [...new Set(result)] : [...OPEN_STATUSES];
}

export async function listSupplierReconciliationTasks(input: ListInput = {}) {
  const prisma = getPrisma();
  const statuses = normalizeStatuses(input.statuses);
  const q = input.q?.trim() || "";
  const where: Prisma.SupplierReconciliationTaskWhereInput = {
    status: { in: statuses },
  };

  if (input.supplierId?.trim()) where.supplierId = input.supplierId.trim();
  if (input.reason?.trim()) where.reason = input.reason.trim().toUpperCase() as never;
  if (q) {
    where.OR = [
      { supplier: { name: { contains: q, mode: "insensitive" } } },
      { importRecord: { supplierRecordKey: { contains: q, mode: "insensitive" } } },
      { importRecord: { supplierArticleRaw: { contains: q, mode: "insensitive" } } },
      { importRecord: { supplierArticleNorm: { contains: q, mode: "insensitive" } } },
      { importRecord: { brandRaw: { contains: q, mode: "insensitive" } } },
      { importRecord: { brandNormalized: { contains: q, mode: "insensitive" } } },
      { importRecord: { mpnCandidateNorm: { contains: q, mode: "insensitive" } } },
      { importRecord: { gtinCandidate: { contains: q } } },
      { importRecord: { externalProductId: { contains: q, mode: "insensitive" } } },
    ];
  }

  const rows = await prisma.supplierReconciliationTask.findMany({
    where,
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take: boundedTake(input.take),
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      batch: { select: { id: true, integrationScope: true, sourceVersion: true, adapterVersion: true, schemaVersion: true, createdAt: true } },
      importRecord: {
        select: {
          id: true,
          supplierRecordKey: true,
          state: true,
          externalProductId: true,
          supplierArticleRaw: true,
          supplierArticleNorm: true,
          brandRaw: true,
          brandNormalized: true,
          mpnCandidateRaw: true,
          mpnCandidateNorm: true,
          gtinCandidate: true,
          currency: true,
          purchasePrice: true,
          quantityMode: true,
          exactQty: true,
          availabilityBand: true,
          warehouseKey: true,
          sourceUpdatedAt: true,
          sourceTimeTrusted: true,
          matchedProductId: true,
          mappingMethod: true,
          matchConfidence: true,
          identityEvidence: true,
          errorCodes: true,
        },
      },
      candidates: {
        orderBy: [{ rank: "asc" }, { score: "desc" }],
        take: 12,
        include: {
          product: {
            select: {
              id: true,
              title: true,
              shortTitle: true,
              mpnRaw: true,
              mpnNormalized: true,
              status: true,
              brand: { select: { canonicalName: true } },
              genericArticle: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const supplierIds = [...new Set(rows.map((row) => row.supplierId))];
  const suppliers = supplierIds.length
    ? await prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, code: true, name: true } })
    : [];

  return {
    tasks: rows.map((row) => ({
      ...row,
      evidence: redactEvidence(row.evidence),
      conflictFields: redactEvidence(row.conflictFields),
      importRecord: {
        ...row.importRecord,
        purchasePrice: row.importRecord.purchasePrice == null ? null : Number(row.importRecord.purchasePrice),
        exactQty: row.importRecord.exactQty == null ? null : Number(row.importRecord.exactQty),
        identityEvidence: redactEvidence(row.importRecord.identityEvidence),
        errorCodes: redactEvidence(row.importRecord.errorCodes),
      },
      candidates: row.candidates.map((candidate) => ({
        ...candidate,
        reasonCodes: redactEvidence(candidate.reasonCodes),
        evidence: redactEvidence(candidate.evidence),
      })),
    })),
    suppliers,
    statuses: [...OPEN_STATUSES],
  };
}

export async function searchSupplierReconciliationProducts(query: string, take = 20) {
  const prisma = getPrisma();
  const q = query.trim();
  if (q.length < 2) return [];
  const normalized = q.replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
  const rows = await prisma.product.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { shortTitle: { contains: q, mode: "insensitive" } },
        { mpnRaw: { contains: q, mode: "insensitive" } },
        ...(normalized ? [{ mpnNormalized: { contains: normalized } } as Prisma.ProductWhereInput] : []),
        { brand: { canonicalName: { contains: q, mode: "insensitive" } } },
      ],
    },
    orderBy: [{ updatedAt: "desc" }],
    take: Math.min(Math.max(Math.trunc(take || 20), 1), 30),
    select: {
      id: true,
      title: true,
      shortTitle: true,
      mpnRaw: true,
      mpnNormalized: true,
      status: true,
      brand: { select: { canonicalName: true } },
      genericArticle: { select: { name: true } },
    },
  });
  return rows;
}

async function loadMutableTask(tx: Prisma.TransactionClient, taskId: string) {
  const task = await tx.supplierReconciliationTask.findUnique({
    where: { id: taskId },
    include: {
      batch: { select: { integrationScope: true, sourceVersion: true } },
      importRecord: true,
    },
  });
  if (!task) throw new SupplierReconciliationError("NOT_FOUND", "Задачу reconciliation не знайдено.");
  if (["RESOLVED", "REJECTED"].includes(task.status)) {
    throw new SupplierReconciliationError("INVALID_STATE", "Ця reconciliation-задача вже закрита.");
  }
  if (!task.batch?.integrationScope) {
    throw new SupplierReconciliationError("INVALID_STATE", "Для задачі відсутній integration scope; автоматична зміна mapping заборонена.");
  }
  return task;
}

function auditData(value: unknown) {
  return toPrismaJson(redactEvidence(value));
}

export async function startReviewSupplierReconciliationTask(input: MutationBase) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const task = await loadMutableTask(tx, input.taskId);
    const before = { status: task.status, resolutionType: task.resolutionType, notes: task.notes };
    const updated = await tx.supplierReconciliationTask.update({
      where: { id: task.id },
      data: { status: "IN_REVIEW", notes: cleanNotes(input.notes) ?? task.notes },
    });
    await tx.auditEvent.create({
      data: {
        entityType: "SupplierReconciliationTask",
        entityId: task.id,
        action: "SUPPLIER_RECONCILIATION_REVIEW_STARTED",
        actorId: input.actorId,
        actorName: input.actorName,
        before: auditData(before),
        after: auditData({ status: updated.status, notes: updated.notes }),
      },
    });
    return { taskId: task.id, status: updated.status };
  });
}

export async function resolveSupplierReconciliationTask(input: MutationBase & { productId: string }) {
  const productId = input.productId.trim();
  if (!productId) throw new SupplierReconciliationError("INVALID_INPUT", "Оберіть canonical Product.");
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const task = await loadMutableTask(tx, input.taskId);
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, title: true, mpnNormalized: true, status: true, brand: { select: { canonicalName: true } } },
    });
    if (!product || product.status !== "ACTIVE") {
      throw new SupplierReconciliationError("INVALID_PRODUCT", "Для ручного mapping можна обрати лише ACTIVE canonical Product.");
    }

    const mappingKey = {
      supplierId: task.supplierId,
      integrationScope: task.batch!.integrationScope,
      supplierRecordKey: task.importRecord.supplierRecordKey,
    };
    const existingMapping = await tx.supplierIdentityMapping.findUnique({
      where: { supplierId_integrationScope_supplierRecordKey: mappingKey },
    });
    const now = new Date();
    const notes = cleanNotes(input.notes);
    const evidence = toPrismaJson({
      source: "STAFF_RECONCILIATION",
      taskId: task.id,
      previousMappingProductId: existingMapping?.productId ?? null,
      reason: task.reason,
    });

    const mapping = await tx.supplierIdentityMapping.upsert({
      where: { supplierId_integrationScope_supplierRecordKey: mappingKey },
      create: {
        ...mappingKey,
        productId: product.id,
        method: "MANUAL",
        confidence: 100,
        evidence,
        sourceVersion: task.batch?.sourceVersion ?? null,
        isApproved: true,
        isActive: true,
        approvedById: input.actorId,
        approvedAt: now,
      },
      update: {
        productId: product.id,
        method: "MANUAL",
        confidence: 100,
        evidence,
        sourceVersion: task.batch?.sourceVersion ?? null,
        isApproved: true,
        isActive: true,
        approvedById: input.actorId,
        approvedAt: now,
        disabledAt: null,
        disabledReason: null,
      },
    });

    await tx.supplierImportRecord.update({
      where: { id: task.importRecordId },
      data: {
        state: "MATCHED",
        matchedProductId: product.id,
        mappingMethod: "MANUAL",
        matchConfidence: 100,
      },
    });

    const updated = await tx.supplierReconciliationTask.update({
      where: { id: task.id },
      data: {
        status: "RESOLVED",
        resolutionType: "LINK_EXISTING_PRODUCT",
        resolvedProductId: product.id,
        resolvedById: input.actorId,
        resolvedAt: now,
        notes,
      },
    });

    await tx.auditEvent.create({
      data: {
        entityType: "SupplierReconciliationTask",
        entityId: task.id,
        action: existingMapping && existingMapping.productId !== product.id
          ? "SUPPLIER_RECONCILIATION_MAPPING_REPOINTED"
          : "SUPPLIER_RECONCILIATION_RESOLVED",
        actorId: input.actorId,
        actorName: input.actorName,
        before: auditData({
          taskStatus: task.status,
          importRecordState: task.importRecord.state,
          mapping: existingMapping ? { id: existingMapping.id, productId: existingMapping.productId, method: existingMapping.method, isApproved: existingMapping.isApproved } : null,
        }),
        after: auditData({
          taskStatus: updated.status,
          product: { id: product.id, brand: product.brand.canonicalName, mpn: product.mpnNormalized, title: product.title },
          mapping: { id: mapping.id, productId: mapping.productId, method: mapping.method, isApproved: mapping.isApproved },
          offerPublished: false,
        }),
        metadata: auditData({ reason: task.reason, notes }),
      },
    });

    return { taskId: task.id, status: updated.status, product, mappingId: mapping.id, offerPublished: false };
  });
}

export async function rejectSupplierReconciliationTask(input: MutationBase) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const task = await loadMutableTask(tx, input.taskId);
    const notes = cleanNotes(input.notes);
    const now = new Date();
    await tx.supplierImportRecord.update({ where: { id: task.importRecordId }, data: { state: "REJECTED" } });
    const updated = await tx.supplierReconciliationTask.update({
      where: { id: task.id },
      data: {
        status: "REJECTED",
        resolutionType: "REJECT_RECORD",
        resolvedProductId: null,
        resolvedById: input.actorId,
        resolvedAt: now,
        notes,
      },
    });
    await tx.auditEvent.create({
      data: {
        entityType: "SupplierReconciliationTask",
        entityId: task.id,
        action: "SUPPLIER_RECONCILIATION_REJECTED",
        actorId: input.actorId,
        actorName: input.actorName,
        before: auditData({ taskStatus: task.status, importRecordState: task.importRecord.state }),
        after: auditData({ taskStatus: updated.status, importRecordState: "REJECTED", mappingChanged: false, offerPublished: false }),
        metadata: auditData({ reason: task.reason, notes }),
      },
    });
    return { taskId: task.id, status: updated.status, offerPublished: false };
  });
}

export async function escalateSupplierReconciliationTask(input: MutationBase) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const task = await loadMutableTask(tx, input.taskId);
    const notes = cleanNotes(input.notes);
    const updated = await tx.supplierReconciliationTask.update({
      where: { id: task.id },
      data: {
        status: "ESCALATED",
        resolutionType: "CATALOG_AUTHORING_REQUIRED",
        resolvedProductId: null,
        resolvedById: null,
        resolvedAt: null,
        notes,
      },
    });
    await tx.auditEvent.create({
      data: {
        entityType: "SupplierReconciliationTask",
        entityId: task.id,
        action: "SUPPLIER_RECONCILIATION_ESCALATED",
        actorId: input.actorId,
        actorName: input.actorName,
        before: auditData({ taskStatus: task.status, resolutionType: task.resolutionType }),
        after: auditData({ taskStatus: updated.status, resolutionType: updated.resolutionType, productAutoCreated: false, offerPublished: false }),
        metadata: auditData({ reason: task.reason, notes }),
      },
    });
    return { taskId: task.id, status: updated.status, catalogAuthoringRequired: true, offerPublished: false };
  });
}
