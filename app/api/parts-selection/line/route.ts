import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { getStructuredDiagnostic } from "@/src/services/structured-diagnostics.service";
import { getDiagnosticCommercialHandoff } from "@/src/services/diagnostic-commercial-handoff.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCKED_REQUEST_STATUSES = new Set(["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "INSTALLED", "RETURNED", "CANCELLED"]);
const LOCKED_LINE_STATUSES = new Set(["IN_PROGRESS", "COMPLETED", "CANCELLED"]);
const EDITABLE_FIELDS = ["quantity", "article", "brand", "partName", "supplierName", "warehouse", "purchasePrice", "sellPrice", "markupPercent"] as const;

type EditableField = typeof EDITABLE_FIELDS[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function finite(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function locationAllowed(access: Awaited<ReturnType<typeof authorize>>, diagnosticId: string) {
  if (access.shadowBypass || access.grantedScope === "ALL") return true;
  const view = await getStructuredDiagnostic(diagnosticId);
  const locationId = view.diagnostic.assignment?.locationId || null;
  return Boolean(locationId && access.context.locationIds.includes(locationId));
}

async function buildRows(diagnosticId: string) {
  const prisma = getPrisma();
  const handoff = await getDiagnosticCommercialHandoff(diagnosticId);
  const suggestions = handoff.suggestions.filter((item) => item.kind === "PART" && item.lineId);
  const lineIds = suggestions.map((item) => item.lineId!).filter(Boolean);
  if (!lineIds.length) return [];
  const lines = await prisma.workOrderLine.findMany({
    where: { id: { in: lineIds }, workOrderId: handoff.workOrder.id },
    select: { id: true, status: true, description: true, article: true, brand: true, plannedQuantity: true, plannedUnitCost: true, plannedUnitPrice: true, currency: true, supplierId: true, supplierQuoteId: true, metadata: true },
  });
  const requestItems = await prisma.partsRequestItem.findMany({
    where: { workOrderLineId: { in: lineIds } },
    select: { workOrderLineId: true, externalProductId: true, partsRequest: { select: { status: true } } },
  });
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const requestByLine = new Map(requestItems.map((item) => [item.workOrderLineId, item]));

  return suggestions.flatMap((suggestion) => {
    const line = suggestion.lineId ? lineById.get(suggestion.lineId) : null;
    if (!line) return [];
    const selected = suggestion.selected;
    const purchasePrice = Number(line.plannedUnitCost);
    const sellPrice = Number(line.plannedUnitPrice);
    if (!line.article && purchasePrice <= 0 && sellPrice <= 0) return [];
    const metadata = isRecord(line.metadata) ? line.metadata : {};
    const snapshot = isRecord(metadata.partsPricingSnapshot) ? metadata.partsPricingSnapshot : {};
    const manual = isRecord(metadata.partsManualOverrides) ? metadata.partsManualOverrides : {};
    const manualFields = Array.isArray(manual.fields) ? manual.fields.filter((field): field is string => typeof field === "string") : [];
    const requestItem = requestByLine.get(line.id);
    const requestStatus = requestItem?.partsRequest.status || null;
    const editable = !LOCKED_LINE_STATUSES.has(line.status) && !LOCKED_REQUEST_STATUSES.has(requestStatus || "");
    const markupPercent = typeof snapshot.markupPercent === "number"
      ? snapshot.markupPercent
      : purchasePrice > 0 ? round2(((sellPrice / purchasePrice) - 1) * 100) : 0;
    return [{
      lineId: line.id,
      findingKey: suggestion.manualPartId || suggestion.findingId,
      findingId: suggestion.findingId || null,
      manualPartId: suggestion.manualPartId || null,
      partName: line.description,
      supplierId: line.supplierId,
      supplierName: typeof metadata.supplierName === "string" ? metadata.supplierName : selected?.supplierName || "",
      article: line.article || "",
      brand: line.brand || null,
      warehouse: typeof metadata.warehouseOverride === "string" ? metadata.warehouseOverride : selected?.warehouse || null,
      purchasePrice,
      sellPrice,
      markupPercent,
      currency: line.currency || "UAH",
      quantity: Number(line.plannedQuantity),
      externalProductId: requestItem?.externalProductId || null,
      manualFields,
      priceOverrideReason: typeof manual.priceOverrideReason === "string" ? manual.priceOverrideReason : null,
      editable,
      lockReason: !editable ? (requestStatus && LOCKED_REQUEST_STATUSES.has(requestStatus) ? `Закупівля вже у статусі ${requestStatus}` : `Рядок уже у статусі ${line.status}`) : null,
    }];
  });
}

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.PARTS_READ, { request, minimumScope: "LOCATION", strict: true });
  if (!access.allowed) return access.response!;
  try {
    const diagnosticId = new URL(request.url).searchParams.get("diagnosticId")?.trim() || "";
    if (!diagnosticId) return NextResponse.json({ ok: false, error: "DIAGNOSTIC_REQUIRED", message: "Не передано Діагностичну карту." }, { status: 400 });
    if (!(await locationAllowed(access, diagnosticId))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    return NextResponse.json({ ok: true, rows: await buildRows(diagnosticId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/parts-selection/line failed", error);
    return NextResponse.json({ ok: false, error: "PART_CART_LOAD_FAILED", message: "Не вдалося завантажити вибрані деталі." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const access = await authorize(PERMISSIONS.PARTS_WRITE, { request, minimumScope: "LOCATION", strict: true });
  if (!access.allowed) return access.response!;
  const actorUser = access.context.user;
  if (!actorUser) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const diagnosticId = clean(body?.diagnosticId, 160);
    const lineId = clean(body?.lineId, 160);
    if (!diagnosticId || !lineId) return NextResponse.json({ ok: false, error: "CONTEXT_REQUIRED", message: "Не передано контекст редагування." }, { status: 400 });
    if (!(await locationAllowed(access, diagnosticId))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });

    const handoff = await getDiagnosticCommercialHandoff(diagnosticId);
    const suggestion = handoff.suggestions.find((item) => item.kind === "PART" && item.lineId === lineId);
    if (!suggestion) return NextResponse.json({ ok: false, error: "PART_LINE_NOT_FOUND", message: "Рядок не належить цій Діагностичній карті." }, { status: 404 });

    const prisma = getPrisma();
    const current = await prisma.workOrderLine.findFirst({ where: { id: lineId, workOrderId: handoff.workOrder.id }, select: { id: true, status: true, description: true, article: true, brand: true, plannedQuantity: true, plannedUnitCost: true, plannedUnitPrice: true, currency: true, supplierId: true, supplierQuoteId: true, metadata: true } });
    if (!current) return NextResponse.json({ ok: false, error: "PART_LINE_NOT_FOUND" }, { status: 404 });
    const requestItem = await prisma.partsRequestItem.findFirst({ where: { workOrderLineId: lineId }, select: { id: true, partsRequest: { select: { status: true } } } });
    if (LOCKED_LINE_STATUSES.has(current.status) || (requestItem?.partsRequest.status && LOCKED_REQUEST_STATUSES.has(requestItem.partsRequest.status))) {
      return NextResponse.json({ ok: false, error: "PART_LINE_LOCKED", message: "Позицію вже передано у виконання/закупівлю. Спочатку змініть відповідний бізнес-статус." }, { status: 409 });
    }

    const currentMetadata = isRecord(current.metadata) ? current.metadata : {};
    const currentSnapshot = isRecord(currentMetadata.partsPricingSnapshot) ? currentMetadata.partsPricingSnapshot : {};
    const previousPurchase = Number(current.plannedUnitCost);
    const previousSell = Number(current.plannedUnitPrice);
    const previousMarkup = typeof currentSnapshot.markupPercent === "number" ? currentSnapshot.markupPercent : previousPurchase > 0 ? round2(((previousSell / previousPurchase) - 1) * 100) : 0;

    const quantity = body && Object.prototype.hasOwnProperty.call(body, "quantity") ? finite(body.quantity, Number(current.plannedQuantity)) : Number(current.plannedQuantity);
    const purchasePrice = body && Object.prototype.hasOwnProperty.call(body, "purchasePrice") ? finite(body.purchasePrice, previousPurchase) : previousPurchase;
    let markupPercent = body && Object.prototype.hasOwnProperty.call(body, "markupPercent") ? finite(body.markupPercent, previousMarkup) : previousMarkup;
    const directSellProvided = Boolean(body && Object.prototype.hasOwnProperty.call(body, "sellPrice"));
    let sellPrice = directSellProvided ? finite(body?.sellPrice, previousSell) : round2(purchasePrice * (1 + markupPercent / 100));
    const reason = clean(body?.priceOverrideReason, 500);

    if (!(quantity > 0 && quantity <= 100)) return NextResponse.json({ ok: false, error: "QUANTITY_INVALID", message: "Кількість має бути від 0 до 100." }, { status: 400 });
    if (purchasePrice < 0 || sellPrice < 0 || markupPercent < -100 || markupPercent > 1000) return NextResponse.json({ ok: false, error: "PRICE_INVALID", message: "Перевірте закупівельну ціну, продажну ціну та відсоток націнки." }, { status: 400 });

    const markupProvided = Boolean(body && Object.prototype.hasOwnProperty.call(body, "markupPercent"));
    if (directSellProvided && !markupProvided && purchasePrice > 0) markupPercent = round2(((sellPrice / purchasePrice) - 1) * 100);
    const formulaSell = round2(purchasePrice * (1 + markupPercent / 100));
    const priceOverride = directSellProvided && Math.abs(sellPrice - formulaSell) > 0.01;
    if (priceOverride && reason.length < 4) return NextResponse.json({ ok: false, error: "PRICE_OVERRIDE_REASON_REQUIRED", message: "Для ручного відхилення ціни продажу від формули вкажіть причину." }, { status: 400 });
    if (!directSellProvided) sellPrice = formulaSell;

    const next = {
      quantity,
      article: body && Object.prototype.hasOwnProperty.call(body, "article") ? clean(body.article, 120) : current.article || "",
      brand: body && Object.prototype.hasOwnProperty.call(body, "brand") ? clean(body.brand, 120) : current.brand || "",
      partName: body && Object.prototype.hasOwnProperty.call(body, "partName") ? clean(body.partName, 500) : current.description,
      supplierName: body && Object.prototype.hasOwnProperty.call(body, "supplierName") ? clean(body.supplierName, 180) : typeof currentMetadata.supplierName === "string" ? currentMetadata.supplierName : suggestion.selected?.supplierName || "",
      warehouse: body && Object.prototype.hasOwnProperty.call(body, "warehouse") ? clean(body.warehouse, 180) : typeof currentMetadata.warehouseOverride === "string" ? currentMetadata.warehouseOverride : suggestion.selected?.warehouse || "",
      purchasePrice,
      sellPrice,
      markupPercent,
    };
    if (!next.partName) return NextResponse.json({ ok: false, error: "PART_NAME_REQUIRED", message: "Номенклатура не може бути порожньою." }, { status: 400 });

    const before: Record<EditableField, unknown> = {
      quantity: Number(current.plannedQuantity), article: current.article || "", brand: current.brand || "", partName: current.description,
      supplierName: typeof currentMetadata.supplierName === "string" ? currentMetadata.supplierName : suggestion.selected?.supplierName || "",
      warehouse: typeof currentMetadata.warehouseOverride === "string" ? currentMetadata.warehouseOverride : suggestion.selected?.warehouse || "",
      purchasePrice: previousPurchase, sellPrice: previousSell, markupPercent: previousMarkup,
    };
    const changedFields = EDITABLE_FIELDS.filter((field) => String(before[field] ?? "") !== String(next[field] ?? ""));
    if (!changedFields.length) return NextResponse.json({ ok: true, row: (await buildRows(diagnosticId)).find((row) => row.lineId === lineId) || null });

    const oldManual = isRecord(currentMetadata.partsManualOverrides) ? currentMetadata.partsManualOverrides : {};
    const previousFields = Array.isArray(oldManual.fields) ? oldManual.fields.filter((field): field is string => typeof field === "string") : [];
    const manualFields = Array.from(new Set([...previousFields, ...changedFields]));
    const actorName = actorUser.employeeName || actorUser.name || "CRM / Підбір запчастин";
    const metadata = {
      ...currentMetadata,
      supplierName: next.supplierName,
      warehouseOverride: next.warehouse,
      partsPricingSnapshot: {
        ...currentSnapshot,
        purchasePrice: next.purchasePrice,
        markupPercent: next.markupPercent,
        sellPrice: next.sellPrice,
        currency: current.currency || "UAH",
        capturedAt: new Date().toISOString(),
        manualOverride: true,
      },
      partsManualOverrides: {
        fields: manualFields,
        priceOverrideReason: priceOverride ? reason : typeof oldManual.priceOverrideReason === "string" ? oldManual.priceOverrideReason : null,
        updatedAt: new Date().toISOString(),
        updatedByUserId: actorUser.id,
        updatedByName: actorName,
      },
    };

    await prisma.$transaction(async (tx) => {
      await tx.workOrderLine.update({ where: { id: lineId }, data: {
        description: next.partName,
        article: next.article || null,
        brand: next.brand || null,
        plannedQuantity: next.quantity,
        plannedUnitCost: next.purchasePrice,
        plannedUnitPrice: next.sellPrice,
        status: current.status === "APPROVED" ? "DRAFT" : current.status,
        metadata: toPrismaJson(metadata),
      } });
      await tx.partsRequestItem.updateMany({ where: { workOrderLineId: lineId }, data: {
        description: next.partName,
        article: next.article || null,
        brand: next.brand || null,
        quantity: next.quantity,
        purchasePrice: next.purchasePrice,
        sellPrice: next.sellPrice,
        sourcingMode: "MANUAL_OVERRIDE",
      } });
      await tx.auditEvent.create({ data: {
        actorId: actorUser.id,
        actorName,
        entityType: "WorkOrderLine",
        entityId: lineId,
        action: "PART_SELECTION_LINE_MANUAL_OVERRIDE",
        metadata: toPrismaJson({ diagnosticId, workOrderId: handoff.workOrder.id, changedFields, before, after: next, priceOverride, priceOverrideReason: priceOverride ? reason : null, approvalReset: current.status === "APPROVED" }),
      } });
    });

    const row = (await buildRows(diagnosticId)).find((item) => item.lineId === lineId) || null;
    return NextResponse.json({ ok: true, row });
  } catch (error) {
    console.error("PATCH /api/parts-selection/line failed", error);
    return NextResponse.json({ ok: false, error: "PART_CART_UPDATE_FAILED", message: "Не вдалося зберегти зміни позиції." }, { status: 500 });
  }
}
