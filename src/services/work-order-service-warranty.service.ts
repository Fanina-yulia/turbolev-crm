import { ServiceCatalogReviewStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";

export class WorkOrderServiceWarrantyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkOrderServiceWarrantyError";
    this.code = code;
  }
}

type JsonRecord = Record<string, unknown>;

type WarrantyLineLike = {
  id: string;
  type: string;
  status: string;
  description: string;
  completedAt: Date | string | null;
  metadata: unknown;
};

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}

export async function prepareCatalogWorkOrderLineInput(body: JsonRecord) {
  const catalogItemId = clean(body.catalogItemId, 160);
  if (!catalogItemId) return body;
  if (clean(body.supplierQuoteId, 160)) {
    throw new WorkOrderServiceWarrantyError("AMBIGUOUS_SOURCE", "Use either catalogItemId or supplierQuoteId, not both");
  }

  const prisma = getPrisma();
  const item = await prisma.serviceCatalogItem.findFirst({
    where: {
      id: catalogItemId,
      isActive: true,
      showToOperator: true,
      reviewStatus: ServiceCatalogReviewStatus.READY,
      basePrice: { not: null },
    },
    select: {
      id: true,
      source: true,
      externalServiceId: true,
      code: true,
      internalName: true,
      displayName: true,
      unit: true,
      basePrice: true,
      normMinutes: true,
      warrantyKm: true,
      warrantyDays: true,
      sourceVersion: true,
    },
  });
  if (!item) {
    throw new WorkOrderServiceWarrantyError("CATALOG_WORK_NOT_FOUND", "Work price catalog item not found, inactive or not READY");
  }

  const existingMetadata = isRecord(body.metadata) ? body.metadata : {};
  const copiedAt = new Date().toISOString();
  const warrantyKm = positiveInteger(item.warrantyKm);
  const warrantyDays = positiveInteger(item.warrantyDays);
  const serviceWarranty = warrantyKm || warrantyDays ? {
    warrantyKm,
    warrantyDays,
    copiedAt,
    startsAt: "LINE_COMPLETED_AT",
    sourceCatalogItemId: item.id,
  } : null;

  return {
    ...body,
    // WorkOrderLine historically used legacy CrmDirectoryItem for catalogItemId.
    // New Service Catalog linkage is kept explicitly in sourceEntity/sourceEntityId
    // and in the immutable metadata snapshot below.
    catalogItemId: null,
    type: "LABOR",
    description: item.displayName,
    code: item.code,
    unit: item.unit || "робота",
    plannedUnitPrice: body.plannedUnitPrice ?? item.basePrice?.toString() ?? "0",
    laborHours: body.laborHours ?? (item.normMinutes == null ? null : Math.round((item.normMinutes / 60) * 100) / 100),
    sourceEntity: "SERVICE_CATALOG",
    sourceEntityId: item.id,
    metadata: {
      ...existingMetadata,
      source: "SERVICE_CATALOG",
      serviceCatalogItemId: item.id,
      warrantyKm,
      warrantyDays,
      serviceWarranty,
      serviceCatalogSnapshot: {
        id: item.id,
        source: item.source,
        externalServiceId: item.externalServiceId,
        code: item.code,
        internalName: item.internalName,
        displayName: item.displayName,
        unit: item.unit,
        basePrice: item.basePrice?.toString() ?? null,
        normMinutes: item.normMinutes,
        warrantyKm,
        warrantyDays,
        sourceVersion: item.sourceVersion,
        copiedAt,
      },
    },
  };
}

export function buildWorkOrderLineWarranty(line: WarrantyLineLike) {
  if (line.type !== "LABOR" || line.status === "CANCELLED") return null;
  const metadata = isRecord(line.metadata) ? line.metadata : {};
  const nested = isRecord(metadata.serviceWarranty) ? metadata.serviceWarranty : {};
  const warrantyKm = positiveInteger(nested.warrantyKm ?? metadata.warrantyKm);
  const warrantyDays = positiveInteger(nested.warrantyDays ?? metadata.warrantyDays);
  if (!warrantyKm && !warrantyDays) return null;

  const completedAt = line.completedAt ? new Date(line.completedAt) : null;
  const validCompletedAt = completedAt && !Number.isNaN(completedAt.getTime()) ? completedAt : null;
  const expiresAt = validCompletedAt && warrantyDays ? addDays(validCompletedAt, warrantyDays) : null;
  const now = new Date();
  const status = !validCompletedAt ? "PENDING_START" : expiresAt && expiresAt.getTime() < now.getTime() ? "EXPIRED_BY_TIME" : "ACTIVE";

  return {
    lineId: line.id,
    description: line.description,
    warrantyKm,
    warrantyDays,
    startsAt: validCompletedAt?.toISOString() ?? null,
    expiresAt: expiresAt?.toISOString() ?? null,
    status,
    sourceCatalogItemId: clean(nested.sourceCatalogItemId, 160) || clean(metadata.serviceCatalogItemId, 160) || null,
    copiedAt: clean(nested.copiedAt, 80) || null,
  };
}
