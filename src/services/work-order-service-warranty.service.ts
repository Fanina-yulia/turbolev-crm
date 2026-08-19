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
  catalogItemId?: string | null;
  completedAt: Date | string | null;
  warrantyKm?: number | null;
  warrantyDays?: number | null;
  warrantyStartsAt?: Date | string | null;
  warrantyEndsAt?: Date | string | null;
  warrantyMileageStartKm?: number | null;
  metadata: unknown;
};

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(source: JsonRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function positiveInteger(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function validDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
      OR: [{ id: catalogItemId }, { legacyDirectoryItemId: catalogItemId }],
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
    // Prevent the canonical line service from falling back to the removed
    // CrmDirectoryItem price lookup. The DB trigger restores catalogItemId
    // from sourceEntityId and snapshots warranty fields atomically.
    catalogItemId: null,
    type: hasOwn(body, "type") ? body.type : "LABOR",
    description: hasOwn(body, "description") ? body.description : item.displayName,
    code: hasOwn(body, "code") ? body.code : item.code,
    unit: hasOwn(body, "unit") ? body.unit : item.unit || "робота",
    plannedUnitPrice: hasOwn(body, "plannedUnitPrice") ? body.plannedUnitPrice : item.basePrice?.toString() ?? "0",
    plannedUnitCost: hasOwn(body, "plannedUnitCost") ? body.plannedUnitCost : 0,
    laborHours: hasOwn(body, "laborHours")
      ? body.laborHours
      : item.normMinutes == null ? null : Math.round((item.normMinutes / 60) * 100) / 100,
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
  const warrantyKm = positiveInteger(line.warrantyKm ?? nested.warrantyKm ?? metadata.warrantyKm);
  const warrantyDays = positiveInteger(line.warrantyDays ?? nested.warrantyDays ?? metadata.warrantyDays);
  if (!warrantyKm && !warrantyDays) return null;

  const startsAt = validDate(line.warrantyStartsAt) || validDate(line.completedAt);
  const storedEndsAt = validDate(line.warrantyEndsAt);
  const expiresAt = storedEndsAt || (startsAt && warrantyDays ? addDays(startsAt, warrantyDays) : null);
  const mileageStartKm = positiveInteger(line.warrantyMileageStartKm);
  const mileageLimitKm = mileageStartKm && warrantyKm ? mileageStartKm + warrantyKm : null;
  const now = new Date();
  const status = !startsAt
    ? "PENDING_START"
    : expiresAt && expiresAt.getTime() < now.getTime()
      ? "EXPIRED_BY_TIME"
      : "ACTIVE";

  return {
    lineId: line.id,
    description: line.description,
    warrantyKm,
    warrantyDays,
    startsAt: startsAt?.toISOString() ?? null,
    expiresAt: expiresAt?.toISOString() ?? null,
    mileageStartKm,
    mileageLimitKm,
    status,
    sourceCatalogItemId: clean(line.catalogItemId, 160) || clean(nested.sourceCatalogItemId, 160) || clean(metadata.serviceCatalogItemId, 160) || null,
    copiedAt: clean(nested.copiedAt, 80) || null,
  };
}