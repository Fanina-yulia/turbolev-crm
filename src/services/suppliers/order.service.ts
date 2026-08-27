import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { writeAuditEvent } from "@/src/services/audit.service";
import { transitionPartsRequest } from "@/src/services/work-order-commercial.service";
import { getSupplierAdapter } from "./registry";
import type { SupplierId, SupplierOffer, SupplierOrderSubmitInput } from "./types";

const DEFAULT_MARKUP_PERCENT = 23;
const ORDER_CONFIRMATION = "SUBMIT_SUPPLIER_ORDER";

type DraftItemInput = {
  partsRequestItemId: string;
  externalProductId: string;
  warehouseId: string;
  quantity?: number;
  markupPercent?: number;
};

type CreateDraftInput = {
  supplierId: SupplierId;
  workOrderId: string;
  partsRequestId: string;
  items: DraftItemInput[];
  checkout?: Omit<SupplierOrderSubmitInput, "items"> | null;
  actorId?: string | null;
  actorName?: string | null;
};

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeMarkup(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), 300);
}

function supplierCode(id: SupplierId) {
  if (id === "unique-trade") return "UNIQUE_TRADE" as const;
  if (id === "bm-parts") return "BM_PARTS" as const;
  if (id === "autonova-d") return "AUTONOVA_D" as const;
  return "OTHER" as const;
}

export async function ensureSupplierRecord(id: SupplierId) {
  const adapter = getSupplierAdapter(id);
  if (!adapter) throw new Error("Невідомий постачальник.");
  const prisma = getPrisma();
  const code = supplierCode(id);
  return prisma.supplier.upsert({
    where: { code },
    update: {
      name: adapter.name,
      websiteUrl: adapter.website,
      apiBaseUrl: adapter.apiBaseUrl,
      isActive: true,
    },
    create: {
      code,
      name: adapter.name,
      websiteUrl: adapter.website,
      apiBaseUrl: adapter.apiBaseUrl,
      isActive: true,
      defaultMarkupPercent: DEFAULT_MARKUP_PERCENT,
      defaultCurrency: "UAH",
    },
  });
}

export async function getSupplierMarkupPercent(id: SupplierId) {
  const prisma = getPrisma();
  const row = await prisma.supplier.findUnique({ where: { code: supplierCode(id) }, select: { defaultMarkupPercent: true } });
  return row ? numberValue(row.defaultMarkupPercent) : DEFAULT_MARKUP_PERCENT;
}

export async function enrichOffersWithSellPrice(offers: SupplierOffer[]) {
  const ids = [...new Set(offers.map((offer) => offer.supplierId))];
  const markups = new Map<SupplierId, number>();
  await Promise.all(ids.map(async (id) => markups.set(id, await getSupplierMarkupPercent(id))));
  return offers.map((offer) => {
    const markupPercent = markups.get(offer.supplierId) ?? DEFAULT_MARKUP_PERCENT;
    const sellPrice = offer.purchasePrice == null ? null : roundMoney(offer.purchasePrice * (1 + markupPercent / 100));
    return { ...offer, markupPercent, sellPrice };
  });
}

async function verifyLiveOffer(input: { supplierId: SupplierId; item: DraftItemInput; article: string | null; description: string }) {
  const adapter = getSupplierAdapter(input.supplierId);
  if (!adapter) throw new Error("Невідомий постачальник.");
  const query = input.article?.trim() || input.description.trim();
  const offers = await adapter.search(query, 50);
  const offer = offers.find((candidate) => candidate.externalProductId === input.item.externalProductId);
  if (!offer) throw new Error(`Позиція ${query} більше не знайдена у постачальника. Оновіть пошук.`);
  if (!offer.available || offer.purchasePrice == null) throw new Error(`Позиція ${query} зараз недоступна для замовлення.`);
  const stock = offer.stock.find((row) => row.warehouseId === input.item.warehouseId);
  if (!stock) throw new Error(`Для ${query} обраний склад більше недоступний.`);
  const available = Number(String(stock.quantity).replace(",", "."));
  const quantity = input.item.quantity == null ? 1 : Number(input.item.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Некоректна кількість для ${query}.`);
  if (Number.isFinite(available) && available < quantity) throw new Error(`Недостатній залишок ${query} на обраному складі.`);
  return { offer, quantity, query };
}

export async function createSupplierOrderDraft(input: CreateDraftInput) {
  if (input.supplierId !== "unique-trade") throw new Error("Live supplier order зараз увімкнений лише для Юнік Трейд.");
  if (!input.items.length) throw new Error("Додайте хоча б одну позицію замовлення.");
  const adapter = getSupplierAdapter(input.supplierId);
  if (!adapter?.submitOrder || !adapter.getOrder) throw new Error("Постачальник не підтримує live-замовлення.");
  if (!(await adapter.isConfigured())) throw new Error("Постачальник не налаштований.");

  const prisma = getPrisma();
  const partsRequest = await prisma.partsRequest.findFirst({
    where: { id: input.partsRequestId, workOrderId: input.workOrderId },
    include: { items: true },
  });
  if (!partsRequest) throw new Error("Заявку на запчастини не знайдено.");
  if (partsRequest.status !== "ORDER_REQUIRED") throw new Error("Чернетку supplier order можна створити лише після переходу заявки у «До замовлення».");
  if (partsRequest.paymentRequired && !partsRequest.paymentConfirmedAt) throw new Error("Перед створенням supplier order потрібно підтвердити передоплату клієнта.");

  const itemMap = new Map(partsRequest.items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const selectedRows = [] as typeof partsRequest.items;
  for (const item of input.items) {
    if (seen.has(item.partsRequestItemId)) throw new Error("Одна позиція не може бути додана до замовлення двічі.");
    seen.add(item.partsRequestItemId);
    const row = itemMap.get(item.partsRequestItemId);
    if (!row) throw new Error("Позиція не належить до цієї заявки на запчастини.");
    selectedRows.push(row);
  }
  const linkedOrderIds = [...new Set(selectedRows.flatMap((row) => row.supplierOrderId ? [row.supplierOrderId] : []))];
  if (linkedOrderIds.length) {
    const activeOrders = await prisma.supplierOrder.findMany({
      where: { id: { in: linkedOrderIds }, status: { notIn: ["CANCELLED", "ERROR"] } },
      select: { id: true },
      take: 1,
    });
    if (activeOrders.length) throw new Error("Для цієї позиції вже існує активна чернетка або замовлення постачальнику.");
  }

  const supplier = await ensureSupplierRecord(input.supplierId);
  const supplierMarkup = numberValue(supplier.defaultMarkupPercent) || DEFAULT_MARKUP_PERCENT;
  const verified = await Promise.all(input.items.map(async (item) => {
    const row = itemMap.get(item.partsRequestItemId)!;
    const live = await verifyLiveOffer({ supplierId: input.supplierId, item, article: row.article, description: row.description });
    const markupPercent = normalizeMarkup(item.markupPercent, supplierMarkup);
    const sellPrice = roundMoney(live.offer.purchasePrice! * (1 + markupPercent / 100));
    return { input: item, row, ...live, markupPercent, sellPrice };
  }));

  const totalPurchase = roundMoney(verified.reduce((sum, item) => sum + item.offer.purchasePrice! * item.quantity, 0));
  const orderItems = verified.map((item) => ({
    partsRequestItemId: item.row.id,
    externalProductId: item.offer.externalProductId,
    article: item.offer.article,
    brand: item.offer.brand,
    name: item.offer.name,
    quantity: item.quantity,
    warehouseId: item.input.warehouseId,
    purchasePrice: item.offer.purchasePrice,
    currency: item.offer.currency || "UAH",
    markupPercent: item.markupPercent,
    sellPrice: item.sellPrice,
  }));

  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.supplierOrder.create({
      data: {
        supplierId: supplier.id,
        workOrderId: input.workOrderId,
        status: "DRAFT",
        totalPurchase,
        currency: "UAH",
        items: toPrismaJson(orderItems),
        requestPayload: input.checkout ? toPrismaJson(input.checkout) : undefined,
      },
    });

    for (const item of verified) {
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      const quote = await tx.supplierProductQuote.create({
        data: {
          supplierId: supplier.id,
          query: item.query.slice(0, 160),
          externalProductId: item.offer.externalProductId,
          article: item.offer.article.slice(0, 120),
          brand: item.offer.brand?.slice(0, 120) || null,
          name: item.offer.name,
          purchasePrice: item.offer.purchasePrice,
          currency: item.offer.currency || "UAH",
          multiplicity: item.offer.multiplicity,
          available: item.offer.available,
          stock: toPrismaJson(item.offer.stock),
          fetchedAt: new Date(),
          expiresAt,
        },
      });
      await tx.partsRequestItem.update({
        where: { id: item.row.id },
        data: {
          supplierId: supplier.id,
          supplierQuoteId: quote.id,
          supplierOrderId: order.id,
          externalProductId: item.offer.externalProductId,
          sourcingMode: "SUPPLIER_API",
          purchasePrice: item.offer.purchasePrice,
          sellPrice: item.sellPrice,
          currency: item.offer.currency || "UAH",
        },
      });
    }
    return order;
  });

  for (const item of verified) {
    if (item.input.markupPercent != null && Math.abs(item.markupPercent - supplierMarkup) > 0.0001) {
      await writeAuditEvent({
        entityType: "PartsRequestItem",
        entityId: item.row.id,
        action: "SUPPLIER_MARKUP_OVERRIDE",
        actorId: input.actorId,
        actorName: input.actorName,
        before: toPrismaJson({ markupPercent: supplierMarkup }),
        after: toPrismaJson({ markupPercent: item.markupPercent, sellPrice: item.sellPrice }),
        metadata: toPrismaJson({ supplierId: input.supplierId, supplierOrderId: created.id }),
      });
    }
  }
  await writeAuditEvent({
    entityType: "SupplierOrder",
    entityId: created.id,
    action: "CREATE_DRAFT",
    actorId: input.actorId,
    actorName: input.actorName,
    after: toPrismaJson({ supplierId: input.supplierId, workOrderId: input.workOrderId, totalPurchase, items: orderItems }),
  });
  return created;
}

function checkoutFromOrder(order: { requestPayload: unknown; items: unknown }): SupplierOrderSubmitInput {
  const checkout = order.requestPayload && typeof order.requestPayload === "object" && !Array.isArray(order.requestPayload)
    ? order.requestPayload as Record<string, unknown>
    : {};
  const items = Array.isArray(order.items) ? order.items as Array<Record<string, unknown>> : [];
  const deliveryId = String(checkout.deliveryId ?? "");
  const deliveryDate = String(checkout.deliveryDate ?? "");
  const deliveryPointId = String(checkout.deliveryPointId ?? "");
  const paymentType = checkout.paymentType === "nal" ? "nal" : checkout.paymentType === "beznal" ? "beznal" : null;
  if (!deliveryId || !/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) || !deliveryPointId || !paymentType) throw new Error("Для відправки замовлення заповніть доставку, дату, точку та тип оплати.");
  const providerItems = items.map((item) => ({
    externalProductId: String(item.externalProductId ?? ""),
    quantity: numberValue(item.quantity),
    warehouseId: String(item.warehouseId ?? ""),
  }));
  if (providerItems.some((item) => !item.externalProductId || !item.warehouseId || item.quantity <= 0)) throw new Error("У draft замовлення є некоректна позиція.");
  return {
    comment: typeof checkout.comment === "string" ? checkout.comment : null,
    deliveryId,
    deliveryDate,
    deliveryPointId,
    paymentType,
    withoutDocument: checkout.withoutDocument === true,
    items: providerItems,
  };
}

export async function submitSupplierOrder(input: { orderId: string; confirmation: string; actorId?: string | null; actorName?: string | null }) {
  if (input.confirmation !== ORDER_CONFIRMATION) throw new Error("Потрібне явне підтвердження відправки замовлення постачальнику.");
  const prisma = getPrisma();
  const order = await prisma.supplierOrder.findUnique({ where: { id: input.orderId }, include: { supplier: true } });
  if (!order) throw new Error("Замовлення постачальнику не знайдено.");
  if (order.status !== "DRAFT") throw new Error("Відправити можна лише draft замовлення.");
  if (order.supplier.code !== "UNIQUE_TRADE") throw new Error("Live submit зараз увімкнений лише для Юнік Трейд.");
  if (!order.workOrderId) throw new Error("Supplier order не прив'язаний до комерційної пропозиції.");

  const request = await prisma.partsRequest.findFirst({
    where: { workOrderId: order.workOrderId, items: { some: { supplierOrderId: order.id } } },
    select: { id: true, status: true, paymentRequired: true, paymentConfirmedAt: true },
  });
  if (!request) throw new Error("Заявку на запчастини для supplier order не знайдено.");
  if (request.status !== "ORDER_REQUIRED") throw new Error("Реальне замовлення постачальнику дозволене лише зі статусу «До замовлення».");
  if (request.paymentRequired && !request.paymentConfirmedAt) throw new Error("Перед реальним замовленням потрібно підтвердити передоплату клієнта.");

  const adapter = getSupplierAdapter("unique-trade");
  if (!adapter?.submitOrder) throw new Error("Юнік Трейд order API недоступний.");
  const checkout = checkoutFromOrder(order);
  const provider = await adapter.submitOrder(checkout);
  const updated = await prisma.supplierOrder.update({
    where: { id: order.id },
    data: {
      externalOrderId: provider.externalOrderId,
      status: "CONFIRMED",
      totalPurchase: provider.totalPurchase ?? order.totalPurchase,
      currency: provider.currency || order.currency,
      responsePayload: toPrismaJson(provider.raw),
      submittedAt: new Date(),
      confirmedAt: new Date(),
    },
  });
  await transitionPartsRequest(request.id, "ORDERED", input.actorName || "CRM / Закупівлі");
  await writeAuditEvent({ entityType: "SupplierOrder", entityId: order.id, action: "SUBMIT", actorId: input.actorId, actorName: input.actorName, after: toPrismaJson({ externalOrderId: provider.externalOrderId, providerStatus: provider.providerStatus, totalPurchase: provider.totalPurchase }) });
  return updated;
}

function mapProviderStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  if (["cancelled", "canceled", "cancel"].includes(normalized)) return "CANCELLED" as const;
  if (["error", "failed"].includes(normalized)) return "ERROR" as const;
  if (["partial", "partially_fulfilled"].includes(normalized)) return "PARTIAL" as const;
  if (["fulfilled", "completed", "complete", "done", "closed"].includes(normalized)) return "FULFILLED" as const;
  return "CONFIRMED" as const;
}

export async function syncSupplierOrder(input: { orderId: string; actorId?: string | null; actorName?: string | null }) {
  const prisma = getPrisma();
  const order = await prisma.supplierOrder.findUnique({ where: { id: input.orderId }, include: { supplier: true } });
  if (!order) throw new Error("Замовлення постачальнику не знайдено.");
  if (!order.externalOrderId) throw new Error("Draft замовлення ще не має provider order id.");
  if (order.supplier.code !== "UNIQUE_TRADE") throw new Error("Live status sync зараз увімкнений лише для Юнік Трейд.");
  const adapter = getSupplierAdapter("unique-trade");
  if (!adapter?.getOrder) throw new Error("Юнік Трейд order status API недоступний.");
  const provider = await adapter.getOrder(order.externalOrderId);
  const status = mapProviderStatus(provider.providerStatus);
  const updated = await prisma.supplierOrder.update({
    where: { id: order.id },
    data: {
      status,
      totalPurchase: provider.totalPurchase ?? order.totalPurchase,
      currency: provider.currency || order.currency,
      responsePayload: toPrismaJson(provider.raw),
      completedAt: status === "FULFILLED" ? new Date() : order.completedAt,
    },
  });
  await writeAuditEvent({ entityType: "SupplierOrder", entityId: order.id, action: "SYNC_STATUS", actorId: input.actorId, actorName: input.actorName, after: toPrismaJson({ status, providerStatus: provider.providerStatus }) });
  return { order: updated, provider };
}

export async function getSupplierDeliveryPoints(id: SupplierId) {
  const adapter = getSupplierAdapter(id);
  if (!adapter?.listDeliveryPoints) throw new Error("Постачальник не підтримує точки доставки.");
  return adapter.listDeliveryPoints();
}

export async function getSupplierTransporters(id: SupplierId, input: { date: string; deliveryPointId: string }) {
  const adapter = getSupplierAdapter(id);
  if (!adapter?.listTransporters) throw new Error("Постачальник не підтримує список перевізників.");
  return adapter.listTransporters(input);
}

export async function getSupplierDeliveryOptions(id: SupplierId, input: { date: string; deliveryPointId: string; transporterId: string; warehouseIds: string[] }) {
  const adapter = getSupplierAdapter(id);
  if (!adapter?.listDeliveryOptions) throw new Error("Постачальник не підтримує варіанти доставки.");
  return adapter.listDeliveryOptions(input);
}

export { ORDER_CONFIRMATION };
