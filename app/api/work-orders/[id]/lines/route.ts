import { NextResponse } from "next/server";
import { ServiceCatalogReviewStatus } from "@/src/generated/prisma/client";
import { WorkOrderFinanceValidationError } from "@/src/domain/work-order-finance";
import { getPrisma } from "@/src/lib/prisma";
import {
  createWorkOrderLine,
  getWorkOrderLines,
  WorkOrderLineError,
} from "@/src/services/work-order-lines.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOwn(source: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function actor(body: Record<string, unknown>) {
  return typeof body.actorName === "string" && body.actorName.trim()
    ? body.actorName.trim().slice(0, 120)
    : "CRM / Сервіс-менеджер";
}

async function hydrateServiceCatalogLine(body: Record<string, unknown>) {
  const requestedId = typeof body.catalogItemId === "string" ? body.catalogItemId.trim() : "";
  if (!requestedId) return body;

  const prisma = getPrisma();
  const item = await prisma.serviceCatalogItem.findFirst({
    where: {
      OR: [{ id: requestedId }, { legacyDirectoryItemId: requestedId }],
      isActive: true,
      showToOperator: true,
      reviewStatus: ServiceCatalogReviewStatus.READY,
      basePrice: { not: null },
    },
    select: {
      id: true,
      externalServiceId: true,
      source: true,
      code: true,
      displayName: true,
      unit: true,
      basePrice: true,
      normMinutes: true,
      warrantyKm: true,
      warrantyDays: true,
      sourceVersion: true,
    },
  });
  if (!item) throw new WorkOrderLineError("CATALOG_WORK_NOT_FOUND", "Work price catalog item not found or inactive");

  const currentMetadata = asRecord(body.metadata) || {};
  return {
    ...body,
    // The canonical line service still supports the legacy WORK_PRICE loader.
    // We hydrate Price Catalog 2 here and deliberately clear catalogItemId so
    // it never attempts a CrmDirectoryItem lookup. The DB trigger restores the
    // canonical ServiceCatalogItem id and snapshots warranty terms atomically.
    catalogItemId: undefined,
    type: hasOwn(body, "type") ? body.type : "LABOR",
    description: hasOwn(body, "description") ? body.description : item.displayName,
    code: hasOwn(body, "code") ? body.code : item.code,
    unit: hasOwn(body, "unit") ? body.unit : item.unit,
    plannedUnitPrice: hasOwn(body, "plannedUnitPrice") ? body.plannedUnitPrice : item.basePrice,
    plannedUnitCost: hasOwn(body, "plannedUnitCost") ? body.plannedUnitCost : 0,
    laborHours: hasOwn(body, "laborHours")
      ? body.laborHours
      : item.normMinutes == null ? null : item.normMinutes / 60,
    sourceEntity: "SERVICE_CATALOG",
    sourceEntityId: item.id,
    metadata: {
      ...currentMetadata,
      source: "SERVICE_CATALOG",
      catalogItemId: item.id,
      externalServiceId: item.externalServiceId,
      catalogSource: item.source,
      catalogSourceVersion: item.sourceVersion,
      warrantySnapshot: {
        warrantyKm: item.warrantyKm,
        warrantyDays: item.warrantyDays,
      },
    },
  };
}

function errorResponse(error: unknown) {
  if (error instanceof WorkOrderFinanceValidationError) {
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: 400 });
  }
  if (error instanceof WorkOrderLineError) {
    const status = ["WORK_ORDER_NOT_FOUND", "LINE_NOT_FOUND", "CATALOG_WORK_NOT_FOUND", "SUPPLIER_QUOTE_NOT_FOUND"].includes(error.code)
      ? 404
      : error.code === "ACTUAL_ALREADY_LOCKED" || error.code === "INVALID_STATUS_TRANSITION"
        ? 409
        : 400;
    return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status });
  }
  console.error("[work-order-lines]", error);
  return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", error: "WorkOrder line operation failed" }, { status: 500 });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const result = await getWorkOrderLines(id);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = asRecord(await request.json().catch(() => null));
    if (!body) {
      return NextResponse.json({ ok: false, code: "INVALID_JSON_BODY", error: "Request body must be a JSON object" }, { status: 400 });
    }
    const hydrated = await hydrateServiceCatalogLine(body);
    const result = await createWorkOrderLine(id, hydrated, actor(body));
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}