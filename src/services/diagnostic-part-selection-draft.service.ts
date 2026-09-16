import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { getStructuredDiagnostic } from "@/src/services/structured-diagnostics.service";
import { getDiagnosticCommercialHandoff } from "@/src/services/diagnostic-commercial-handoff.service";
import { normalizeCatalogNumber, resolvePartFitment } from "@/src/services/parts-fitment.service";
import { searchConfiguredSuppliers } from "@/src/services/suppliers/registry";
import { enrichOffersWithSellPrice, ensureSupplierRecord } from "@/src/services/suppliers/order.service";
import { getPartPackageRule, resolveSupplierOfferQuantity } from "@/src/services/part-operation-catalog.service";
import { ensurePartsRequestTx } from "@/src/services/work-order-commercial.service";
import type { SupplierId } from "@/src/services/suppliers/types";

const SUPPLIER_IDS = new Set<SupplierId>(["bm-parts", "unique-trade", "autonova-d", "atl"]);
const LOCKED_REQUEST_STATUSES = new Set(["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "INSTALLED", "RETURNED", "CANCELLED"]);
const LOCKED_LINE_STATUSES = new Set(["IN_PROGRESS", "COMPLETED", "CANCELLED"]);
const EDITABLE_FIELDS = ["quantity", "article", "brand", "partName", "supplierName", "warehouse", "purchasePrice", "sellPrice", "markupPercent"] as const;

type EditableField = typeof EDITABLE_FIELDS[number];

type StageInput = {
  diagnosticRequestId: string;
  findingId?: string | null;
  manualPartId?: string | null;
  supplierId: string;
  externalProductId?: string | null;
  article?: string | null;
  quantity?: number | null;
  actorId?: string | null;
  actorName?: string | null;
  searchMode?: "VIN" | "PART_NUMBER" | "TEXT";
  vehicleVin?: string | null;
  vehicleId?: string | null;
  partName?: string | null;
  canonicalCode?: string | null;
  axis?: string | null;
  side?: string | null;
  subPosition?: string | null;
  genericArticleId?: string | null;
  position?: string | null;
  fitmentSource?: string | null;
  manualConfirmation?: boolean;
};

type CartUpdateInput = Record<string, unknown>;

export class DiagnosticPartSelectionDraftError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "DiagnosticPartSelectionDraftError";
    this.code = code;
    this.status = status;
  }
}

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function providerId(value: unknown): SupplierId {
  const id = clean(value, 80) as SupplierId;
  if (!SUPPLIER_IDS.has(id)) throw new DiagnosticPartSelectionDraftError("SUPPLIER_INVALID", "Невідомий постачальник.");
  return id;
}

function draftSelectionKey(findingId: string, manualPartId: string) {
  return manualPartId ? `manual:${manualPartId}` : `finding:${findingId}`;
}

function jsonStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stockQuantity(value: string | number | null | undefined) {
  const parsed = Number(String(value ?? "0").replace(/[^0-9.,-]/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function warehouseFromStock(stock: Array<{ warehouse: string; quantity: string }> | undefined) {
  if (!stock?.length) return null;
  return stock.find((row) => stockQuantity(row.quantity) > 0)?.warehouse || stock[0]?.warehouse || null;
}

function selectedFromDraft(row: {
  supplierDbId: string | null;
  supplierName: string;
  supplierQuoteId: string | null;
  externalProductId: string | null;
  article: string;
  brand: string | null;
  warehouse: string | null;
  purchasePrice: unknown;
  sellPrice: unknown;
  markupPercent: unknown;
  currency: string;
  quantity: unknown;
}) {
  return {
    supplierId: row.supplierDbId,
    supplierName: row.supplierName,
    supplierQuoteId: row.supplierQuoteId,
    externalProductId: row.externalProductId,
    article: row.article,
    brand: row.brand,
    warehouse: row.warehouse,
    purchasePrice: Number(row.purchasePrice),
    sellPrice: Number(row.sellPrice),
    markupPercent: row.markupPercent == null ? null : Number(row.markupPercent),
    currency: row.currency,
    quantity: Number(row.quantity),
  };
}

export async function getDiagnosticPartSelectionPreview(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  const automaticCandidates = view.inspections.flatMap((inspection) => inspection.sections.flatMap((section) => section.items.flatMap((item) => {
    const finding = item.finding;
    if (!finding?.id) return [];
    const common = {
      findingId: finding.id,
      manualPartId: null as string | null,
      genericArticleId: null as string | null,
      catalogCode: null as string | null,
      inspection: inspection.templateName,
      section: section.name,
      checkName: item.name,
      action: finding.action,
      urgency: finding.urgency,
      imported: false,
      lineId: null as string | null,
    };
    const rows: Array<Record<string, unknown>> = [];
    if (finding.suggestedWorkName?.trim()) rows.push({
      ...common,
      key: `${finding.id}:LABOR`,
      kind: "LABOR",
      description: finding.suggestedWorkName.trim(),
      article: null,
      brand: null,
      position: item.position,
      quantity: 1,
      note: finding.findingText || item.note || null,
    });
    const partName = finding.suggestedPartName?.trim() || (finding.action === "REPLACE" ? item.name?.trim() : "");
    if (partName) rows.push({
      ...common,
      key: `${finding.id}:PART`,
      kind: "PART",
      description: partName,
      article: null,
      brand: null,
      position: item.position,
      quantity: 1,
      note: finding.findingText || item.note || null,
    });
    return rows;
  })));

  const manualParts = await prisma.diagnosticPartRecommendation.findMany({
    where: { diagnosticRequestId, status: { not: "CANCELLED" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const manualCandidates = manualParts.map((part) => ({
    key: `manual:${part.id}`,
    findingId: part.findingId || "",
    manualPartId: part.id,
    genericArticleId: part.genericArticleId,
    catalogCode: part.catalogCode,
    kind: "PART" as const,
    description: part.name,
    article: part.article,
    brand: part.brand,
    position: part.position,
    quantity: Number(part.quantity),
    note: part.note,
    inspection: "Ручна рекомендація",
    section: part.position || "Додано сервіс-менеджером",
    checkName: part.name,
    action: "REPLACE",
    urgency: "INFO",
    imported: false,
    lineId: null as string | null,
  }));

  const drafts = await prisma.diagnosticPartSelectionDraft.findMany({ where: { diagnosticRequestId } });
  const draftByKey = new Map(drafts.map((row) => [row.selectionKey, row]));
  const suggestions = [...automaticCandidates, ...manualCandidates].map((item) => {
    if (item.kind !== "PART") return item;
    const key = draftSelectionKey(String(item.findingId || ""), String(item.manualPartId || ""));
    const draft = draftByKey.get(key);
    return draft ? { ...item, selected: selectedFromDraft(draft), selectionDraftId: draft.id } : item;
  });

  return {
    view,
    workOrder: view.diagnostic.workOrder || null,
    suggestions,
    counts: {
      total: suggestions.length,
      imported: 0,
      pending: suggestions.length,
      labor: suggestions.filter((item) => item.kind === "LABOR").length,
      parts: suggestions.filter((item) => item.kind === "PART").length,
    },
    commercialReady: false,
  };
}

export async function stageDiagnosticPartOffer(input: StageInput) {
  const diagnosticRequestId = clean(input.diagnosticRequestId, 160);
  const findingId = clean(input.findingId, 160);
  const manualPartId = clean(input.manualPartId, 160);
  const supplierProvider = providerId(input.supplierId);
  const quantity = Number(input.quantity ?? 1);
  if (!diagnosticRequestId || (!findingId && !manualPartId)) throw new DiagnosticPartSelectionDraftError("CONTEXT_REQUIRED", "Не передано діагностику або позицію до заміни.");
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100) throw new DiagnosticPartSelectionDraftError("QUANTITY_INVALID", "Кількість деталі має бути від 1 до 100.");

  const preview = await getDiagnosticPartSelectionPreview(diagnosticRequestId);
  if (preview.view.diagnostic.status === "CANCELLED") throw new DiagnosticPartSelectionDraftError("DIAGNOSTIC_LOCKED", "Скасовану діагностичну карту не можна змінювати.", 409);
  if (preview.view.diagnostic.status === "CONFIRMED") throw new DiagnosticPartSelectionDraftError("DIAGNOSTIC_ALREADY_CONFIRMED", "Діагностику вже підтверджено. Оновіть сторінку — вибір буде збережено в замовлення-наряд.", 409);
  const suggestion = preview.suggestions.find((item) => item.kind === "PART" && (manualPartId ? item.manualPartId === manualPartId : !item.manualPartId && item.findingId === findingId));
  if (!suggestion) throw new DiagnosticPartSelectionDraftError("PART_RECOMMENDATION_NOT_FOUND", "Для цієї несправності немає рекомендованої деталі.", 404);

  const searchMode = input.searchMode === "VIN" && clean(input.vehicleVin, 24).length === 17
    ? "VIN"
    : input.searchMode === "PART_NUMBER" ? "PART_NUMBER" : "TEXT";
  if (searchMode !== "VIN" && input.manualConfirmation !== true) {
    throw new DiagnosticPartSelectionDraftError("MANUAL_CONFIRMATION_REQUIRED", "Без підтвердженого VIN потрібно вручну підтвердити, що деталь відповідає цьому автомобілю.", 409);
  }

  const fitment = await resolvePartFitment({
    query: input.partName || String(suggestion.description || ""),
    partName: input.partName || String(suggestion.description || ""),
    canonicalCode: input.canonicalCode || null,
    axis: input.axis || null,
    side: input.side || null,
    subPosition: input.subPosition || null,
    genericArticleId: clean(input.genericArticleId, 160) || String(suggestion.genericArticleId || "") || null,
    position: input.position || null,
    vehicleId: clean(input.vehicleId, 160) || null,
    vin: input.vehicleVin || null,
  });

  const wantedExternalId = clean(input.externalProductId, 200);
  const wantedArticle = clean(input.article, 120).toUpperCase();
  const normalizedWantedArticle = normalizeCatalogNumber(wantedArticle);
  const selectedArticleIsCatalogued = Boolean(
    normalizedWantedArticle
    && [...fitment.catalogArticles, ...fitment.oeNumbers].some((article) => normalizeCatalogNumber(article) === normalizedWantedArticle),
  );
  const catalogFitmentConfirmed = fitment.status === "VERIFIED" && fitment.exact && selectedArticleIsCatalogued;
  if (searchMode === "VIN" && !catalogFitmentConfirmed) {
    throw new DiagnosticPartSelectionDraftError("CATALOG_FITMENT_REQUIRED", "Обрана пропозиція не має підтвердженого зв’язку з точною модифікацією автомобіля.", 409);
  }

  const search = await searchConfiguredSuppliers(wantedArticle || String(suggestion.description || ""), 50, {
    vehicleId: clean(input.vehicleId, 160) || null,
    vin: clean(input.vehicleVin, 24) || null,
    fitmentStatus: fitment.status,
    fitmentConfidence: fitment.confidence,
    fitmentExact: fitment.exact,
    fitmentSource: fitment.catalog?.source || input.fitmentSource || null,
    fitmentReason: fitment.reason,
    providerVehicle: fitment.providerVehicle,
    canonicalCode: input.canonicalCode || null,
    axis: input.axis || null,
    side: input.side || null,
    subPosition: input.subPosition || null,
    partName: input.partName || String(suggestion.description || ""),
    position: input.position || null,
    genericArticleId: fitment.genericArticle?.id || clean(input.genericArticleId, 160) || String(suggestion.genericArticleId || "") || null,
    catalogArticles: fitment.catalogArticles,
    analogArticles: fitment.analogArticles,
    oeNumbers: fitment.oeNumbers,
  });
  const liveOffer = search.offers.find((offer) => {
    if (offer.supplierId !== supplierProvider) return false;
    if (wantedExternalId && offer.externalProductId === wantedExternalId) return true;
    return Boolean(wantedArticle && offer.article.trim().toUpperCase() === wantedArticle);
  });
  if (!liveOffer) throw new DiagnosticPartSelectionDraftError("OFFER_STALE", "Обрана пропозиція вже не повертається постачальником. Оновіть пошук.", 409);

  const selectionEvidence = {
    resultType: liveOffer.resultType || "UNKNOWN",
    compatibilityTier: liveOffer.compatibilityTier || "UNCONFIRMED",
    sourceKind: liveOffer.sourceKind || null,
    offerReason: liveOffer.offerReason || liveOffer.fitmentReason || null,
    matchReasons: liveOffer.matchReasons || [],
    requiresManualConfirmation: liveOffer.requiresManualConfirmation === true || liveOffer.resultType === "ASSEMBLY",
  };
  if (selectionEvidence.requiresManualConfirmation && input.manualConfirmation !== true) {
    throw new DiagnosticPartSelectionDraftError("MANUAL_CONFIRMATION_REQUIRED", "Ця пропозиція потребує ручного підтвердження сумісності.", 409);
  }
  if (!liveOffer.available || liveOffer.purchasePrice == null) throw new DiagnosticPartSelectionDraftError("OFFER_UNAVAILABLE", "Ця деталь зараз недоступна у постачальника.", 409);

  const packagingRule = getPartPackageRule({
    genericArticleId: clean(input.genericArticleId, 160) || String(suggestion.genericArticleId || "") || null,
    canonicalCode: input.canonicalCode || null,
    partName: input.partName || String(suggestion.description || ""),
    axis: input.axis || null,
    side: input.side || null,
    position: input.position || null,
    subPosition: input.subPosition || null,
    quantityHint: input.quantity,
  });
  const packageResolution = resolveSupplierOfferQuantity(packagingRule, liveOffer, input.quantity);
  if (packagingRule.requiresQuantityInput && packageResolution.quantity <= 0) throw new DiagnosticPartSelectionDraftError("QUANTITY_REQUIRED", "Для цієї позиції потрібно вказати підтверджений обсяг у літрах.");

  const [priced] = await enrichOffersWithSellPrice([liveOffer]);
  if (!priced || priced.sellPrice == null || priced.purchasePrice == null) throw new DiagnosticPartSelectionDraftError("PRICE_UNAVAILABLE", "Постачальник не повернув коректну ціну.", 409);
  const supplier = await ensureSupplierRecord(supplierProvider);
  const prisma = getPrisma();
  const quote = await prisma.supplierProductQuote.create({
    data: {
      supplierId: supplier.id,
      query: String(suggestion.description || "").slice(0, 160),
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

  const selectionKey = draftSelectionKey(findingId, manualPartId);
  const actorName = clean(input.actorName, 160) || "CRM / Підбір запчастин";
  const warehouse = warehouseFromStock(priced.stock);
  const fitmentSnapshot = {
    status: fitment.status,
    exact: fitment.exact,
    confidence: fitment.confidence,
    source: fitment.catalog?.source || input.fitmentSource || null,
    reason: fitment.reason,
    confirmed: catalogFitmentConfirmed,
    searchMode,
    manualConfirmation: input.manualConfirmation === true,
  };
  const draft = await prisma.diagnosticPartSelectionDraft.upsert({
    where: { diagnosticRequestId_selectionKey: { diagnosticRequestId, selectionKey } },
    update: {
      findingId: findingId || null,
      manualPartId: manualPartId || null,
      partName: input.partName || String(suggestion.description || "Деталь"),
      position: input.position || String(suggestion.position || "") || null,
      genericArticleId: clean(input.genericArticleId, 160) || String(suggestion.genericArticleId || "") || null,
      canonicalCode: clean(input.canonicalCode, 80) || String(suggestion.catalogCode || "") || null,
      quantity: packageResolution.quantity,
      supplierProvider,
      supplierDbId: supplier.id,
      supplierName: priced.supplierName,
      supplierQuoteId: quote.id,
      externalProductId: priced.externalProductId,
      article: priced.article,
      brand: priced.brand,
      warehouse,
      purchasePrice: priced.purchasePrice,
      sellPrice: priced.sellPrice,
      markupPercent: priced.markupPercent,
      currency: priced.currency || supplier.defaultCurrency || "UAH",
      fitment: toPrismaJson(fitmentSnapshot),
      offerEvidence: toPrismaJson(selectionEvidence),
      manualFields: toPrismaJson([]),
      priceOverrideReason: null,
      createdByUserId: input.actorId || null,
      createdByName: actorName,
    },
    create: {
      diagnosticRequestId,
      findingId: findingId || null,
      manualPartId: manualPartId || null,
      selectionKey,
      partName: input.partName || String(suggestion.description || "Деталь"),
      position: input.position || String(suggestion.position || "") || null,
      genericArticleId: clean(input.genericArticleId, 160) || String(suggestion.genericArticleId || "") || null,
      canonicalCode: clean(input.canonicalCode, 80) || String(suggestion.catalogCode || "") || null,
      quantity: packageResolution.quantity,
      supplierProvider,
      supplierDbId: supplier.id,
      supplierName: priced.supplierName,
      supplierQuoteId: quote.id,
      externalProductId: priced.externalProductId,
      article: priced.article,
      brand: priced.brand,
      warehouse,
      purchasePrice: priced.purchasePrice,
      sellPrice: priced.sellPrice,
      markupPercent: priced.markupPercent,
      currency: priced.currency || supplier.defaultCurrency || "UAH",
      fitment: toPrismaJson(fitmentSnapshot),
      offerEvidence: toPrismaJson(selectionEvidence),
      manualFields: toPrismaJson([]),
      createdByUserId: input.actorId || null,
      createdByName: actorName,
    },
  });
  await prisma.auditEvent.create({
    data: {
      actorId: input.actorId || null,
      actorName,
      entityType: "DiagnosticPartSelectionDraft",
      entityId: draft.id,
      action: "PART_OFFER_STAGED_BEFORE_DIAGNOSTIC_CONFIRMATION",
      metadata: toPrismaJson({ diagnosticRequestId, findingId: findingId || null, manualPartId: manualPartId || null, selectionKey, supplierProvider, supplierDbId: supplier.id, supplierQuoteId: quote.id, article: priced.article, purchasePrice: priced.purchasePrice, sellPrice: priced.sellPrice, markupPercent: priced.markupPercent, quantity: packageResolution.quantity, fitment: fitmentSnapshot, evidence: selectionEvidence }),
    },
  });

  return {
    staged: true,
    workOrderId: null,
    workOrderLineId: null,
    partsRequestId: null,
    findingId: findingId || null,
    manualPartId: manualPartId || null,
    selected: {
      supplierId: supplierProvider,
      supplierName: priced.supplierName,
      article: priced.article,
      brand: priced.brand,
      name: priced.name,
      purchasePrice: priced.purchasePrice,
      markupPercent: priced.markupPercent,
      sellPrice: priced.sellPrice,
      currency: priced.currency || "UAH",
      quantity: packageResolution.quantity,
      quantityLabel: packageResolution.label,
      priceBasis: packageResolution.priceBasis,
      packagingNote: packageResolution.note,
      quoteId: quote.id,
    },
    line: null,
    labor: { status: "STAGED" as const, message: "Роботу буде створено після підтвердження Діагностичної карти." },
    searchMode,
    selectionEvidence,
    manualConfirmationRequired: searchMode !== "VIN" || selectionEvidence.requiresManualConfirmation,
    fitmentStatus: fitment.status,
    fitmentExact: fitment.exact,
    fitmentConfirmed: catalogFitmentConfirmed,
  };
}

async function listWorkOrderCartRows(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const handoff = await getDiagnosticCommercialHandoff(diagnosticRequestId);
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
    const purchasePrice = Number(line.plannedUnitCost);
    const sellPrice = Number(line.plannedUnitPrice);
    if (!line.article && purchasePrice <= 0 && sellPrice <= 0) return [];
    const metadata = isRecord(line.metadata) ? line.metadata : {};
    const snapshot = isRecord(metadata.partsPricingSnapshot) ? metadata.partsPricingSnapshot : {};
    const manual = isRecord(metadata.partsManualOverrides) ? metadata.partsManualOverrides : {};
    const requestItem = requestByLine.get(line.id);
    const requestStatus = requestItem?.partsRequest.status || null;
    const editable = !LOCKED_LINE_STATUSES.has(line.status) && !LOCKED_REQUEST_STATUSES.has(requestStatus || "");
    return [{
      lineId: line.id,
      findingKey: suggestion.manualPartId || suggestion.findingId,
      findingId: suggestion.findingId || null,
      manualPartId: suggestion.manualPartId || null,
      partName: line.description,
      supplierId: line.supplierId,
      supplierName: typeof metadata.supplierName === "string" ? metadata.supplierName : suggestion.selected?.supplierName || "",
      article: line.article || "",
      brand: line.brand || null,
      warehouse: typeof metadata.warehouseOverride === "string" ? metadata.warehouseOverride : suggestion.selected?.warehouse || null,
      purchasePrice,
      sellPrice,
      markupPercent: typeof snapshot.markupPercent === "number" ? snapshot.markupPercent : purchasePrice > 0 ? round2(((sellPrice / purchasePrice) - 1) * 100) : 0,
      currency: line.currency || "UAH",
      quantity: Number(line.plannedQuantity),
      externalProductId: requestItem?.externalProductId || null,
      manualFields: jsonStringArray(manual.fields),
      priceOverrideReason: typeof manual.priceOverrideReason === "string" ? manual.priceOverrideReason : null,
      editable,
      lockReason: !editable ? (requestStatus && LOCKED_REQUEST_STATUSES.has(requestStatus) ? `Закупівля вже у статусі ${requestStatus}` : `Рядок уже у статусі ${line.status}`) : null,
    }];
  });
}

export async function listDiagnosticPartCartRows(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  if (view.diagnostic.status === "CONFIRMED" && view.diagnostic.workOrder) {
    const rows = await listWorkOrderCartRows(diagnosticRequestId);
    if (rows.length) return rows;
  }
  const drafts = await prisma.diagnosticPartSelectionDraft.findMany({ where: { diagnosticRequestId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return drafts.map((row) => ({
    lineId: `draft:${row.id}`,
    findingKey: row.manualPartId || row.findingId || row.selectionKey,
    findingId: row.findingId,
    manualPartId: row.manualPartId,
    partName: row.partName,
    supplierId: row.supplierDbId,
    supplierName: row.supplierName,
    article: row.article,
    brand: row.brand,
    warehouse: row.warehouse,
    purchasePrice: Number(row.purchasePrice),
    sellPrice: Number(row.sellPrice),
    markupPercent: row.markupPercent == null ? 0 : Number(row.markupPercent),
    currency: row.currency,
    quantity: Number(row.quantity),
    externalProductId: row.externalProductId,
    manualFields: jsonStringArray(row.manualFields),
    priceOverrideReason: row.priceOverrideReason,
    editable: view.diagnostic.status !== "CANCELLED",
    lockReason: view.diagnostic.status === "CANCELLED" ? "Діагностичну карту скасовано" : null,
  }));
}

async function updateDraftCartRow(diagnosticRequestId: string, draftId: string, body: CartUpdateInput, actor: { id: string; name: string }) {
  const prisma = getPrisma();
  const current = await prisma.diagnosticPartSelectionDraft.findFirst({ where: { id: draftId, diagnosticRequestId } });
  if (!current) throw new DiagnosticPartSelectionDraftError("PART_LINE_NOT_FOUND", "Рядок кошика не знайдено.", 404);
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  if (view.diagnostic.status === "CANCELLED") throw new DiagnosticPartSelectionDraftError("PART_LINE_LOCKED", "Скасовану Діагностичну карту не можна змінювати.", 409);

  const previousPurchase = Number(current.purchasePrice);
  const previousSell = Number(current.sellPrice);
  const previousMarkup = current.markupPercent == null ? (previousPurchase > 0 ? round2(((previousSell / previousPurchase) - 1) * 100) : 0) : Number(current.markupPercent);
  const quantity = Object.prototype.hasOwnProperty.call(body, "quantity") ? finite(body.quantity, Number(current.quantity)) : Number(current.quantity);
  const purchasePrice = Object.prototype.hasOwnProperty.call(body, "purchasePrice") ? finite(body.purchasePrice, previousPurchase) : previousPurchase;
  let markupPercent = Object.prototype.hasOwnProperty.call(body, "markupPercent") ? finite(body.markupPercent, previousMarkup) : previousMarkup;
  const directSellProvided = Object.prototype.hasOwnProperty.call(body, "sellPrice");
  let sellPrice = directSellProvided ? finite(body.sellPrice, previousSell) : round2(purchasePrice * (1 + markupPercent / 100));
  const reason = clean(body.priceOverrideReason, 500);
  if (!(quantity > 0 && quantity <= 100)) throw new DiagnosticPartSelectionDraftError("QUANTITY_INVALID", "Кількість має бути від 1 до 100.");
  if (purchasePrice < 0 || sellPrice < 0 || markupPercent < -100 || markupPercent > 1000) throw new DiagnosticPartSelectionDraftError("PRICE_INVALID", "Перевірте закупівельну ціну, продажну ціну та відсоток націнки.");
  const markupProvided = Object.prototype.hasOwnProperty.call(body, "markupPercent");
  if (directSellProvided && !markupProvided && purchasePrice > 0) markupPercent = round2(((sellPrice / purchasePrice) - 1) * 100);
  const formulaSell = round2(purchasePrice * (1 + markupPercent / 100));
  const priceOverride = directSellProvided && Math.abs(sellPrice - formulaSell) > 0.01;
  if (priceOverride && reason.length < 4) throw new DiagnosticPartSelectionDraftError("PRICE_OVERRIDE_REASON_REQUIRED", "Для ручного відхилення ціни продажу від формули вкажіть причину.");
  if (!directSellProvided) sellPrice = formulaSell;

  const next = {
    quantity,
    article: Object.prototype.hasOwnProperty.call(body, "article") ? clean(body.article, 120) : current.article,
    brand: Object.prototype.hasOwnProperty.call(body, "brand") ? clean(body.brand, 120) : current.brand || "",
    partName: Object.prototype.hasOwnProperty.call(body, "partName") ? clean(body.partName, 500) : current.partName,
    supplierName: Object.prototype.hasOwnProperty.call(body, "supplierName") ? clean(body.supplierName, 180) : current.supplierName,
    warehouse: Object.prototype.hasOwnProperty.call(body, "warehouse") ? clean(body.warehouse, 180) : current.warehouse || "",
    purchasePrice,
    sellPrice,
    markupPercent,
  };
  if (!next.partName) throw new DiagnosticPartSelectionDraftError("PART_NAME_REQUIRED", "Номенклатура не може бути порожньою.");
  const before: Record<EditableField, unknown> = {
    quantity: Number(current.quantity), article: current.article, brand: current.brand || "", partName: current.partName,
    supplierName: current.supplierName, warehouse: current.warehouse || "", purchasePrice: previousPurchase, sellPrice: previousSell, markupPercent: previousMarkup,
  };
  const changedFields = EDITABLE_FIELDS.filter((field) => String(before[field] ?? "") !== String(next[field] ?? ""));
  if (!changedFields.length) return (await listDiagnosticPartCartRows(diagnosticRequestId)).find((row) => row.lineId === `draft:${draftId}`) || null;
  const manualFields = Array.from(new Set([...jsonStringArray(current.manualFields), ...changedFields]));
  const supplierChanged = changedFields.includes("supplierName");
  const quoteInvalidated = supplierChanged || ["article", "brand", "warehouse", "purchasePrice"].some((field) => changedFields.includes(field as EditableField));
  await prisma.$transaction(async (tx) => {
    await tx.diagnosticPartSelectionDraft.update({ where: { id: draftId }, data: {
      quantity: next.quantity,
      article: next.article,
      brand: next.brand || null,
      partName: next.partName,
      supplierName: next.supplierName,
      warehouse: next.warehouse || null,
      purchasePrice: next.purchasePrice,
      sellPrice: next.sellPrice,
      markupPercent: next.markupPercent,
      manualFields: toPrismaJson(manualFields),
      priceOverrideReason: priceOverride ? reason : current.priceOverrideReason,
      supplierProvider: supplierChanged ? "MANUAL" : current.supplierProvider,
      supplierDbId: supplierChanged ? null : current.supplierDbId,
      supplierQuoteId: quoteInvalidated ? null : current.supplierQuoteId,
      externalProductId: quoteInvalidated ? null : current.externalProductId,
      createdByUserId: actor.id,
      createdByName: actor.name,
    } });
    await tx.auditEvent.create({ data: {
      actorId: actor.id,
      actorName: actor.name,
      entityType: "DiagnosticPartSelectionDraft",
      entityId: draftId,
      action: "PART_SELECTION_LINE_MANUAL_OVERRIDE",
      metadata: toPrismaJson({ diagnosticRequestId, changedFields, before, after: next, priceOverride, priceOverrideReason: priceOverride ? reason : null, staged: true }),
    } });
  });
  return (await listDiagnosticPartCartRows(diagnosticRequestId)).find((row) => row.lineId === `draft:${draftId}`) || null;
}

async function updateWorkOrderCartRow(diagnosticRequestId: string, lineId: string, body: CartUpdateInput, actor: { id: string; name: string }) {
  const prisma = getPrisma();
  const handoff = await getDiagnosticCommercialHandoff(diagnosticRequestId);
  const suggestion = handoff.suggestions.find((item) => item.kind === "PART" && item.lineId === lineId);
  if (!suggestion) throw new DiagnosticPartSelectionDraftError("PART_LINE_NOT_FOUND", "Рядок не належить цій Діагностичній карті.", 404);
  const current = await prisma.workOrderLine.findFirst({ where: { id: lineId, workOrderId: handoff.workOrder.id }, select: { id: true, status: true, description: true, article: true, brand: true, plannedQuantity: true, plannedUnitCost: true, plannedUnitPrice: true, currency: true, supplierId: true, supplierQuoteId: true, metadata: true } });
  if (!current) throw new DiagnosticPartSelectionDraftError("PART_LINE_NOT_FOUND", "Рядок кошика не знайдено.", 404);
  const requestItem = await prisma.partsRequestItem.findFirst({ where: { workOrderLineId: lineId }, select: { id: true, partsRequest: { select: { status: true } } } });
  if (LOCKED_LINE_STATUSES.has(current.status) || (requestItem?.partsRequest.status && LOCKED_REQUEST_STATUSES.has(requestItem.partsRequest.status))) throw new DiagnosticPartSelectionDraftError("PART_LINE_LOCKED", "Позицію вже передано у виконання/закупівлю. Спочатку змініть відповідний бізнес-статус.", 409);
  const currentMetadata = isRecord(current.metadata) ? current.metadata : {};
  const currentSnapshot = isRecord(currentMetadata.partsPricingSnapshot) ? currentMetadata.partsPricingSnapshot : {};
  const previousPurchase = Number(current.plannedUnitCost);
  const previousSell = Number(current.plannedUnitPrice);
  const previousMarkup = typeof currentSnapshot.markupPercent === "number" ? currentSnapshot.markupPercent : previousPurchase > 0 ? round2(((previousSell / previousPurchase) - 1) * 100) : 0;
  const quantity = Object.prototype.hasOwnProperty.call(body, "quantity") ? finite(body.quantity, Number(current.plannedQuantity)) : Number(current.plannedQuantity);
  const purchasePrice = Object.prototype.hasOwnProperty.call(body, "purchasePrice") ? finite(body.purchasePrice, previousPurchase) : previousPurchase;
  let markupPercent = Object.prototype.hasOwnProperty.call(body, "markupPercent") ? finite(body.markupPercent, previousMarkup) : previousMarkup;
  const directSellProvided = Object.prototype.hasOwnProperty.call(body, "sellPrice");
  let sellPrice = directSellProvided ? finite(body.sellPrice, previousSell) : round2(purchasePrice * (1 + markupPercent / 100));
  const reason = clean(body.priceOverrideReason, 500);
  if (!(quantity > 0 && quantity <= 100)) throw new DiagnosticPartSelectionDraftError("QUANTITY_INVALID", "Кількість має бути від 1 до 100.");
  if (purchasePrice < 0 || sellPrice < 0 || markupPercent < -100 || markupPercent > 1000) throw new DiagnosticPartSelectionDraftError("PRICE_INVALID", "Перевірте закупівельну ціну, продажну ціну та відсоток націнки.");
  const markupProvided = Object.prototype.hasOwnProperty.call(body, "markupPercent");
  if (directSellProvided && !markupProvided && purchasePrice > 0) markupPercent = round2(((sellPrice / purchasePrice) - 1) * 100);
  const formulaSell = round2(purchasePrice * (1 + markupPercent / 100));
  const priceOverride = directSellProvided && Math.abs(sellPrice - formulaSell) > 0.01;
  if (priceOverride && reason.length < 4) throw new DiagnosticPartSelectionDraftError("PRICE_OVERRIDE_REASON_REQUIRED", "Для ручного відхилення ціни продажу від формули вкажіть причину.");
  if (!directSellProvided) sellPrice = formulaSell;
  const next = {
    quantity,
    article: Object.prototype.hasOwnProperty.call(body, "article") ? clean(body.article, 120) : current.article || "",
    brand: Object.prototype.hasOwnProperty.call(body, "brand") ? clean(body.brand, 120) : current.brand || "",
    partName: Object.prototype.hasOwnProperty.call(body, "partName") ? clean(body.partName, 500) : current.description,
    supplierName: Object.prototype.hasOwnProperty.call(body, "supplierName") ? clean(body.supplierName, 180) : typeof currentMetadata.supplierName === "string" ? currentMetadata.supplierName : suggestion.selected?.supplierName || "",
    warehouse: Object.prototype.hasOwnProperty.call(body, "warehouse") ? clean(body.warehouse, 180) : typeof currentMetadata.warehouseOverride === "string" ? currentMetadata.warehouseOverride : suggestion.selected?.warehouse || "",
    purchasePrice,
    sellPrice,
    markupPercent,
  };
  if (!next.partName) throw new DiagnosticPartSelectionDraftError("PART_NAME_REQUIRED", "Номенклатура не може бути порожньою.");
  const before: Record<EditableField, unknown> = {
    quantity: Number(current.plannedQuantity), article: current.article || "", brand: current.brand || "", partName: current.description,
    supplierName: typeof currentMetadata.supplierName === "string" ? currentMetadata.supplierName : suggestion.selected?.supplierName || "",
    warehouse: typeof currentMetadata.warehouseOverride === "string" ? currentMetadata.warehouseOverride : suggestion.selected?.warehouse || "",
    purchasePrice: previousPurchase, sellPrice: previousSell, markupPercent: previousMarkup,
  };
  const changedFields = EDITABLE_FIELDS.filter((field) => String(before[field] ?? "") !== String(next[field] ?? ""));
  if (!changedFields.length) return (await listDiagnosticPartCartRows(diagnosticRequestId)).find((row) => row.lineId === lineId) || null;
  const oldManual = isRecord(currentMetadata.partsManualOverrides) ? currentMetadata.partsManualOverrides : {};
  const manualFields = Array.from(new Set([...jsonStringArray(oldManual.fields), ...changedFields]));
  const metadata = {
    ...currentMetadata,
    supplierName: next.supplierName,
    warehouseOverride: next.warehouse,
    partsPricingSnapshot: { ...currentSnapshot, purchasePrice: next.purchasePrice, markupPercent: next.markupPercent, sellPrice: next.sellPrice, currency: current.currency || "UAH", capturedAt: new Date().toISOString(), manualOverride: true },
    partsManualOverrides: { fields: manualFields, priceOverrideReason: priceOverride ? reason : typeof oldManual.priceOverrideReason === "string" ? oldManual.priceOverrideReason : null, updatedAt: new Date().toISOString(), updatedByUserId: actor.id, updatedByName: actor.name },
  };
  await prisma.$transaction(async (tx) => {
    await tx.workOrderLine.update({ where: { id: lineId }, data: { description: next.partName, article: next.article || null, brand: next.brand || null, plannedQuantity: next.quantity, plannedUnitCost: next.purchasePrice, plannedUnitPrice: next.sellPrice, status: current.status === "APPROVED" ? "DRAFT" : current.status, metadata: toPrismaJson(metadata) } });
    await tx.partsRequestItem.updateMany({ where: { workOrderLineId: lineId }, data: { description: next.partName, article: next.article || null, brand: next.brand || null, quantity: next.quantity, purchasePrice: next.purchasePrice, sellPrice: next.sellPrice, sourcingMode: "MANUAL_OVERRIDE" } });
    await tx.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "WorkOrderLine", entityId: lineId, action: "PART_SELECTION_LINE_MANUAL_OVERRIDE", metadata: toPrismaJson({ diagnosticId: diagnosticRequestId, workOrderId: handoff.workOrder.id, changedFields, before, after: next, priceOverride, priceOverrideReason: priceOverride ? reason : null, approvalReset: current.status === "APPROVED" }) } });
  });
  return (await listDiagnosticPartCartRows(diagnosticRequestId)).find((row) => row.lineId === lineId) || null;
}

export async function updateDiagnosticPartCartRow(diagnosticRequestId: string, rowId: string, body: CartUpdateInput, actor: { id: string; name: string }) {
  if (rowId.startsWith("draft:")) return updateDraftCartRow(diagnosticRequestId, rowId.slice(6), body, actor);
  return updateWorkOrderCartRow(diagnosticRequestId, rowId, body, actor);
}

export async function syncDiagnosticPartSelectionDraftsToWorkOrder(diagnosticRequestId: string, actor: { id: string | null; name: string }) {
  const prisma = getPrisma();
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  const workOrderId = view.diagnostic.workOrder?.id || null;
  if (!workOrderId) return { synced: 0, skipped: 0 };
  const [drafts, handoff] = await Promise.all([
    prisma.diagnosticPartSelectionDraft.findMany({ where: { diagnosticRequestId } }),
    getDiagnosticCommercialHandoff(diagnosticRequestId),
  ]);
  if (!drafts.length) return { synced: 0, skipped: 0 };
  await prisma.$transaction(async (tx) => { await ensurePartsRequestTx(tx, workOrderId, actor.name); });
  let synced = 0;
  let skipped = 0;
  for (const draft of drafts) {
    const suggestion = handoff.suggestions.find((item) => item.kind === "PART" && (draft.manualPartId ? item.manualPartId === draft.manualPartId : !item.manualPartId && item.findingId === draft.findingId));
    if (!suggestion?.lineId) { skipped += 1; continue; }
    const current = await prisma.workOrderLine.findUnique({ where: { id: suggestion.lineId }, select: { metadata: true } });
    const metadata = isRecord(current?.metadata) ? current.metadata : {};
    const manualFields = jsonStringArray(draft.manualFields);
    await prisma.$transaction(async (tx) => {
      await tx.workOrderLine.update({ where: { id: suggestion.lineId! }, data: {
        description: draft.partName,
        article: draft.article,
        brand: draft.brand,
        plannedQuantity: draft.quantity,
        plannedUnitCost: draft.purchasePrice,
        plannedUnitPrice: draft.sellPrice,
        currency: draft.currency,
        supplierId: draft.supplierDbId,
        supplierQuoteId: draft.supplierQuoteId,
        metadata: toPrismaJson({
          ...metadata,
          source: "PART_SELECTION_STAGED",
          supplierName: draft.supplierName,
          warehouseOverride: draft.warehouse,
          partsPricingSnapshot: { purchasePrice: Number(draft.purchasePrice), markupPercent: draft.markupPercent == null ? null : Number(draft.markupPercent), sellPrice: Number(draft.sellPrice), currency: draft.currency, capturedAt: new Date().toISOString(), stagedBeforeDiagnosticConfirmation: true },
          partsManualOverrides: manualFields.length ? { fields: manualFields, priceOverrideReason: draft.priceOverrideReason, updatedAt: draft.updatedAt.toISOString(), updatedByUserId: draft.createdByUserId, updatedByName: draft.createdByName } : undefined,
        }),
      } });
      await tx.partsRequestItem.updateMany({ where: { workOrderLineId: suggestion.lineId! }, data: {
        description: draft.partName,
        article: draft.article,
        brand: draft.brand,
        supplierId: draft.supplierDbId,
        supplierQuoteId: draft.supplierQuoteId,
        externalProductId: draft.externalProductId,
        sourcingMode: draft.supplierQuoteId ? "SUPPLIER_API" : "MANUAL_OVERRIDE",
        purchasePrice: draft.purchasePrice,
        sellPrice: draft.sellPrice,
        currency: draft.currency,
        quantity: draft.quantity,
      } });
      await tx.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "WorkOrderLine", entityId: suggestion.lineId!, action: "STAGED_PART_SELECTION_SYNCED_TO_WORK_ORDER", metadata: toPrismaJson({ diagnosticRequestId, draftId: draft.id, workOrderId, supplierQuoteId: draft.supplierQuoteId, manualFields }) } });
    });
    synced += 1;
  }
  return { synced, skipped };
}
