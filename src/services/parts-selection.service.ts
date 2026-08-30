import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { createCommercialProposalFromDiagnostic } from "@/src/services/diagnostic-commercial-proposal.service";
import { getDiagnosticCommercialHandoff } from "@/src/services/diagnostic-commercial-handoff.service";
import { createWorkOrderLine, updateWorkOrderLine } from "@/src/services/work-order-lines.service";
import { ensurePartsRequestTx } from "@/src/services/work-order-commercial.service";
import { enrichOffersWithSellPrice, ensureSupplierRecord } from "@/src/services/suppliers/order.service";
import { searchConfiguredSuppliers } from "@/src/services/suppliers/registry";
import { calculateCatalogLaborPrice, isReplacementLabor } from "@/src/services/labor-pricing.service";
import type { SupplierId } from "@/src/services/suppliers/types";

const SUPPLIER_IDS = new Set<SupplierId>(["bm-parts", "unique-trade", "autonova-d", "atl"]);

export class PartsSelectionError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "PartsSelectionError";
    this.code = code;
    this.status = status;
  }
}

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeSupplier(value: unknown): SupplierId {
  const id = clean(value, 80) as SupplierId;
  if (!SUPPLIER_IDS.has(id)) throw new PartsSelectionError("SUPPLIER_INVALID", "Невідомий постачальник.");
  return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalized(value: unknown) {
  return String(value ?? "").toLocaleLowerCase("uk-UA").replace(/[‐‑‒–—-]/g, " ").replace(/[^a-zа-яіїє0-9]+/giu, " ").replace(/\s+/g, " ").trim();
}

async function findLaborCatalogItem(name: string, catalogItemId?: string | null) {
  const prisma = getPrisma();
  if (catalogItemId) {
    const exact = await prisma.serviceCatalogItem.findFirst({
      where: { id: catalogItemId, isActive: true, showToOperator: true, reviewStatus: "READY", itemType: "LABOR", basePrice: { not: null } },
    });
    if (exact) return exact;
  }
  const query = clean(name, 180);
  if (!query) return null;
  const candidates = await prisma.serviceCatalogItem.findMany({
    where: {
      isActive: true,
      showToOperator: true,
      reviewStatus: "READY",
      itemType: "LABOR",
      basePrice: { not: null },
      OR: [
        { displayName: { contains: query, mode: "insensitive" } },
        { internalName: { contains: query, mode: "insensitive" } },
        { nameOperation: { contains: query, mode: "insensitive" } },
        { searchAliases: { has: query } },
      ],
    },
    take: 20,
  });
  const target = normalized(query);
  return candidates.sort((a, b) => {
    const aExact = normalized(a.displayName) === target || normalized(a.internalName) === target;
    const bExact = normalized(b.displayName) === target || normalized(b.internalName) === target;
    return Number(bExact) - Number(aExact) || a.displayName.localeCompare(b.displayName, "uk");
  })[0] || null;
}

async function ensureReplacementLabor(input: {
  workOrderId: string;
  findingId: string;
  laborSuggestion: { description: string; lineId: string | null } | undefined;
  vehicle: { brand: string | null; model: string | null; year: number | null; engineName: string | null; engineVolumeCm3: number | null; fuelType: string | null; bodyType: string | null; grossWeightKg: number | null; driveType: string | null; vehicleType: string | null };
  customerProvidedPart: boolean;
  actorName: string;
}) {
  if (!input.laborSuggestion) {
    return { status: "NOT_MAPPED" as const, message: "Для цієї деталі в Діагностичній карті не вказана робота заміни." };
  }
  const prisma = getPrisma();
  const current = input.laborSuggestion.lineId
    ? await prisma.workOrderLine.findFirst({ where: { id: input.laborSuggestion.lineId, workOrderId: input.workOrderId } })
    : null;
  const catalogItem = await findLaborCatalogItem(input.laborSuggestion.description, current?.catalogItemId);
  if (!catalogItem || catalogItem.basePrice == null) {
    if (current && Number(current.plannedUnitPrice) > 0) return { status: "EXISTING_PRICE" as const, lineId: current.id, message: "Роботу залишено з уже встановленою ціною." };
    return { status: "MANUAL_REQUIRED" as const, message: `У прайс-листі не знайдено роботу «${input.laborSuggestion.description}».` };
  }
  const vehicle = {
    make: input.vehicle.brand || undefined,
    model: input.vehicle.model || undefined,
    year: input.vehicle.year == null ? undefined : String(input.vehicle.year),
    engine: input.vehicle.engineName || undefined,
    engineVolume: input.vehicle.engineVolumeCm3 == null ? undefined : String(input.vehicle.engineVolumeCm3),
    fuelType: input.vehicle.fuelType || undefined,
    bodyType: input.vehicle.bodyType || undefined,
    grossWeight: input.vehicle.grossWeightKg == null ? undefined : String(input.vehicle.grossWeightKg),
    driveType: input.vehicle.driveType || undefined,
    vehicleType: input.vehicle.vehicleType || undefined,
  };
  const pricing = await calculateCatalogLaborPrice({
    basePrice: Number(catalogItem.basePrice),
    vehicle,
    vehicleCoefficientEnabled: catalogItem.vehicleCoefficientEnabled,
    customerProvidedPart: input.customerProvidedPart,
    replacementOperation: isReplacementLabor(catalogItem),
  });
  const metadata = {
    ...(current && isRecord(current.metadata) ? current.metadata : {}),
    source: "PART_SELECTION_AUTO_LABOR",
    findingId: input.findingId,
    catalogItemId: catalogItem.id,
    laborPricingSnapshot: {
      basePrice: pricing.basePrice,
      coefficientApplied: pricing.coefficientApplied,
      coefficient: pricing.coefficient,
      vehicleType: pricing.pricingVehicleType,
      vehicleTypeLabel: pricing.pricingVehicleTypeLabel,
      customerProvidedPart: pricing.customerProvidedPart,
      replacementOperation: pricing.replacementOperation,
      customerPartsLaborPercent: pricing.customerPartsLaborPercent,
      total: pricing.total,
      capturedAt: new Date().toISOString(),
    },
  };
  const lineBody = {
    type: "LABOR",
    description: catalogItem.displayName,
    code: catalogItem.code,
    catalogItemId: catalogItem.id,
    plannedQuantity: 1,
    plannedUnitPrice: pricing.total,
    plannedUnitCost: 0,
    laborHours: catalogItem.normMinutes == null ? null : catalogItem.normMinutes / 60,
    sourceEntity: "DIAGNOSTIC_FINDING",
    sourceEntityId: `${input.findingId}:LABOR`,
    metadata,
  };
  const result = current
    ? await updateWorkOrderLine(input.workOrderId, current.id, lineBody, input.actorName)
    : await createWorkOrderLine(input.workOrderId, lineBody, input.actorName);
  return { status: "ADDED" as const, lineId: result.line.id, service: catalogItem.displayName, pricing };
}

export async function selectDiagnosticPartOffer(input: {
  diagnosticRequestId: string;
  findingId: string;
  supplierId: string;
  externalProductId?: string | null;
  article?: string | null;
  quantity?: number | null;
  actorId?: string | null;
  actorName?: string | null;
  searchMode?: "VIN" | "PART_NUMBER" | "TEXT";
  vehicleVin?: string | null;
  manualConfirmation?: boolean;
  customerProvidedPart?: boolean;
}) {
  const diagnosticRequestId = clean(input.diagnosticRequestId, 160);
  const findingId = clean(input.findingId, 160);
  const supplierId = normalizeSupplier(input.supplierId);
  const quantity = Number(input.quantity ?? 1);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100) {
    throw new PartsSelectionError("QUANTITY_INVALID", "Кількість деталі має бути від 1 до 100.");
  }
  if (!diagnosticRequestId || !findingId) throw new PartsSelectionError("CONTEXT_REQUIRED", "Не передано діагностику або виявлену проблему.");
  const searchMode = input.searchMode === "VIN" && clean(input.vehicleVin, 24).length === 17
    ? "VIN"
    : input.searchMode === "PART_NUMBER" ? "PART_NUMBER" : "TEXT";
  if (searchMode !== "VIN" && input.manualConfirmation !== true) {
    throw new PartsSelectionError("MANUAL_CONFIRMATION_REQUIRED", "Без підтвердженого VIN потрібно вручну підтвердити, що деталь відповідає цьому автомобілю.", 409);
  }

  const actorName = clean(input.actorName, 160) || "CRM / Підбір запчастин";
  const commercial = await createCommercialProposalFromDiagnostic(diagnosticRequestId, actorName, input.actorId || null);
  const handoff = await getDiagnosticCommercialHandoff(diagnosticRequestId);
  const suggestion = handoff.suggestions.find((item) => item.kind === "PART" && item.findingId === findingId);
  if (!suggestion) throw new PartsSelectionError("PART_RECOMMENDATION_NOT_FOUND", "Для цієї несправності немає рекомендованої деталі.", 404);
  if (!suggestion.lineId) throw new PartsSelectionError("PART_LINE_NOT_IMPORTED", "Рекомендовану деталь ще не перенесено в Комерційну пропозицію.", 409);

  const wantedExternalId = clean(input.externalProductId, 200);
  const wantedArticle = clean(input.article, 120).toUpperCase();
  // Re-query by the selected article when possible. A finding description is
  // often a human label, while the supplier adapter indexes the catalogue by
  // its article; using the article prevents a valid selected offer from being
  // rejected as stale during the second server-side verification.
  const search = await searchConfiguredSuppliers(wantedArticle || suggestion.description, 50);
  const liveOffer = search.offers.find((offer) => {
    if (offer.supplierId !== supplierId) return false;
    if (wantedExternalId && offer.externalProductId === wantedExternalId) return true;
    return Boolean(wantedArticle && offer.article.trim().toUpperCase() === wantedArticle);
  });
  if (!liveOffer) throw new PartsSelectionError("OFFER_STALE", "Пропозиція постачальника вже недоступна. Оновіть пошук.", 409);
  if (!liveOffer.available || liveOffer.purchasePrice == null) throw new PartsSelectionError("OFFER_UNAVAILABLE", "Ця деталь зараз недоступна у постачальника.", 409);

  const [priced] = await enrichOffersWithSellPrice([liveOffer]);
  if (!priced || priced.sellPrice == null) throw new PartsSelectionError("PRICE_UNAVAILABLE", "Постачальник не повернув коректну ціну.", 409);
  const supplier = await ensureSupplierRecord(supplierId);
  const prisma = getPrisma();
  const workOrderVehicle = await prisma.workOrder.findUnique({
    where: { id: commercial.workOrder.id },
    select: { vehicle: { select: { brand: true, model: true, year: true, engineName: true, engineVolumeCm3: true, fuelType: true, bodyType: true, grossWeightKg: true, driveType: true, vehicleType: true } } },
  });
  if (!workOrderVehicle?.vehicle) throw new PartsSelectionError("VEHICLE_NOT_FOUND", "Для WorkOrder не знайдено автомобіль.", 409);

  const laborSuggestion = handoff.suggestions.find((item) => item.kind === "LABOR" && item.findingId === findingId);
  const labor = await ensureReplacementLabor({
    workOrderId: commercial.workOrder.id,
    findingId,
    laborSuggestion,
    vehicle: workOrderVehicle.vehicle,
    customerProvidedPart: input.customerProvidedPart === true,
    actorName,
  });

  const quote = await prisma.supplierProductQuote.create({
    data: {
      supplierId: supplier.id,
      query: suggestion.description.slice(0, 160),
      externalProductId: priced.externalProductId,
      article: priced.article.slice(0, 120),
      brand: priced.brand?.slice(0, 120) || null,
      name: priced.name,
      purchasePrice: priced.purchasePrice,
      currency: priced.currency || supplier.defaultCurrency || "UAH",
      multiplicity: priced.multiplicity,
      available: priced.available,
      stock: toPrismaJson(priced.stock),
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  });

  const currentPartLine = await prisma.workOrderLine.findFirst({ where: { id: suggestion.lineId, workOrderId: commercial.workOrder.id }, select: { metadata: true } });
  const updated = await updateWorkOrderLine(commercial.workOrder.id, suggestion.lineId, {
    description: suggestion.description,
    article: priced.article,
    brand: priced.brand,
    currency: priced.currency || supplier.defaultCurrency || "UAH",
    plannedUnitCost: priced.purchasePrice,
    plannedUnitPrice: priced.sellPrice,
    plannedQuantity: quantity,
    supplierId: supplier.id,
    supplierQuoteId: quote.id,
    metadata: {
      ...(isRecord(currentPartLine?.metadata) ? currentPartLine.metadata : {}),
      source: "PART_SELECTION",
      findingId,
      supplierId: supplier.id,
      supplierName: priced.supplierName,
      searchMode,
      manualConfirmation: searchMode !== "VIN",
      partsPricingSnapshot: {
        purchasePrice: priced.purchasePrice,
        markupPercent: priced.markupPercent,
        sellPrice: priced.sellPrice,
        currency: priced.currency || supplier.defaultCurrency || "UAH",
        capturedAt: new Date().toISOString(),
      },
    },
  }, actorName);

  const partsRequest = await prisma.$transaction(async (tx) => {
    const request = await ensurePartsRequestTx(tx, commercial.workOrder.id, actorName);
    const item = request.items.find((row) => row.workOrderLineId === suggestion.lineId);
    if (item) {
      await tx.partsRequestItem.update({
        where: { id: item.id },
        data: {
          article: priced.article,
          brand: priced.brand,
          supplierId: supplier.id,
          supplierQuoteId: quote.id,
          externalProductId: priced.externalProductId,
          sourcingMode: "SUPPLIER_API",
          purchasePrice: priced.purchasePrice,
          sellPrice: priced.sellPrice,
          currency: priced.currency || supplier.defaultCurrency || "UAH",
          quantity,
          note: searchMode === "VIN" ? "Підібрано за VIN" : "Підібрано за номером/назвою після ручного підтвердження",
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        actorId: input.actorId || null,
        actorName,
        entityType: "DiagnosticFinding",
        entityId: findingId,
        action: "PART_OFFER_SELECTED",
        metadata: toPrismaJson({
          diagnosticRequestId,
          workOrderId: commercial.workOrder.id,
          workOrderLineId: suggestion.lineId,
          partsRequestId: request.id,
          supplierId: supplier.id,
          supplierCode: supplier.code,
          supplierQuoteId: quote.id,
          externalProductId: priced.externalProductId,
          article: priced.article,
          purchasePrice: priced.purchasePrice,
          markupPercent: priced.markupPercent,
          sellPrice: priced.sellPrice,
          currency: priced.currency || "UAH",
          searchMode,
          manualConfirmation: searchMode !== "VIN",
          labor,
        }),
      },
    });
    return request;
  });

  return {
    workOrderId: commercial.workOrder.id,
    workOrderLineId: suggestion.lineId,
    partsRequestId: partsRequest.id,
    findingId,
    selected: {
      supplierId,
      supplierName: priced.supplierName,
      article: priced.article,
      brand: priced.brand,
      name: priced.name,
      purchasePrice: priced.purchasePrice,
      markupPercent: priced.markupPercent,
      sellPrice: priced.sellPrice,
      currency: priced.currency || "UAH",
      quantity,
      quoteId: quote.id,
    },
    line: updated.line,
    labor,
    searchMode,
    manualConfirmationRequired: searchMode !== "VIN",
  };
}
