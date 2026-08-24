import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { createCommercialProposalFromDiagnostic } from "@/src/services/diagnostic-commercial-proposal.service";
import { getDiagnosticCommercialHandoff } from "@/src/services/diagnostic-commercial-handoff.service";
import { updateWorkOrderLine } from "@/src/services/work-order-lines.service";
import { ensurePartsRequestTx } from "@/src/services/work-order-commercial.service";
import { enrichOffersWithSellPrice, ensureSupplierRecord } from "@/src/services/suppliers/order.service";
import { searchConfiguredSuppliers } from "@/src/services/suppliers/registry";
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

export async function selectDiagnosticPartOffer(input: {
  diagnosticRequestId: string;
  findingId: string;
  supplierId: string;
  externalProductId?: string | null;
  article?: string | null;
  actorId?: string | null;
  actorName?: string | null;
}) {
  const diagnosticRequestId = clean(input.diagnosticRequestId, 160);
  const findingId = clean(input.findingId, 160);
  const supplierId = normalizeSupplier(input.supplierId);
  if (!diagnosticRequestId || !findingId) throw new PartsSelectionError("CONTEXT_REQUIRED", "Не передано діагностику або виявлену проблему.");

  const actorName = clean(input.actorName, 160) || "CRM / Підбір запчастин";
  const commercial = await createCommercialProposalFromDiagnostic(diagnosticRequestId, actorName, input.actorId || null);
  const handoff = await getDiagnosticCommercialHandoff(diagnosticRequestId);
  const suggestion = handoff.suggestions.find((item) => item.kind === "PART" && item.findingId === findingId);
  if (!suggestion) throw new PartsSelectionError("PART_RECOMMENDATION_NOT_FOUND", "Для цієї несправності немає рекомендованої деталі.", 404);
  if (!suggestion.lineId) throw new PartsSelectionError("PART_LINE_NOT_IMPORTED", "Рекомендовану деталь ще не перенесено в Комерційну пропозицію.", 409);

  const search = await searchConfiguredSuppliers(suggestion.description, 50);
  const wantedExternalId = clean(input.externalProductId, 200);
  const wantedArticle = clean(input.article, 120).toUpperCase();
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

  const updated = await updateWorkOrderLine(commercial.workOrder.id, suggestion.lineId, {
    description: suggestion.description,
    article: priced.article,
    brand: priced.brand,
    currency: priced.currency || supplier.defaultCurrency || "UAH",
    plannedUnitCost: priced.purchasePrice,
    plannedUnitPrice: priced.sellPrice,
    supplierId: supplier.id,
    supplierQuoteId: quote.id,
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
      quoteId: quote.id,
    },
    line: updated.line,
  };
}
