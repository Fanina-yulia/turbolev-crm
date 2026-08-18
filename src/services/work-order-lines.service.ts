import { Prisma } from "@/src/generated/prisma/client";
import {
  calculateWorkOrderFinance,
  normalizeFinanceCurrency,
  type WorkOrderFinanceInput,
} from "@/src/domain/work-order-finance";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import {
  finalizeWorkOrderFinance,
  WorkOrderFinanceError,
} from "@/src/services/work-order-finance.service";

const LINE_TYPES = ["LABOR", "PART", "EXTERNAL", "CONSUMABLE", "OTHER"] as const;
const LINE_STATUSES = ["DRAFT", "APPROVED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
const LINE_TYPE_SET = new Set<string>(LINE_TYPES);
const LINE_STATUS_SET = new Set<string>(LINE_STATUSES);

type LineType = (typeof LINE_TYPES)[number];
type LineStatus = (typeof LINE_STATUSES)[number];
type FinanceMode = "PLANNED" | "ACTUAL";
type WorkOrderLineRecord = Prisma.WorkOrderLineGetPayload<{}>;

type CatalogWorkRow = {
  id: string;
  name: string;
  code: string | null;
  data: unknown;
};

export class WorkOrderLineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkOrderLineError";
    this.code = code;
  }
}

function hasOwn(source: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function optionalString(value: unknown, max = 160) {
  const result = clean(value, max);
  return result || null;
}

function decimal(value: unknown, field: string, fallback: string | number = 0) {
  const source = value == null || value === "" ? fallback : value;
  if (typeof source !== "string" && typeof source !== "number" && !(source instanceof Prisma.Decimal)) {
    throw new WorkOrderLineError("INVALID_NUMBER", `${field} must be numeric`);
  }
  let result: Prisma.Decimal;
  try {
    result = source instanceof Prisma.Decimal ? source : new Prisma.Decimal(String(source));
  } catch {
    throw new WorkOrderLineError("INVALID_NUMBER", `${field} must be numeric`);
  }
  if (!result.isFinite()) throw new WorkOrderLineError("INVALID_NUMBER", `${field} must be finite`);
  return result;
}

function optionalDecimal(value: unknown, field: string) {
  if (value == null || value === "") return null;
  return decimal(value, field);
}

function nonNegative(value: Prisma.Decimal, field: string) {
  if (value.lessThan(0)) throw new WorkOrderLineError("NEGATIVE_AMOUNT", `${field} cannot be negative`);
  return value;
}

function positive(value: Prisma.Decimal, field: string) {
  if (!value.greaterThan(0)) throw new WorkOrderLineError("INVALID_QUANTITY", `${field} must be greater than zero`);
  return value;
}

function isLineType(value: string): value is LineType {
  return LINE_TYPE_SET.has(value);
}

function isLineStatus(value: string): value is LineStatus {
  return LINE_STATUS_SET.has(value);
}

function normalizeType(value: unknown, fallback: LineType = "OTHER"): LineType {
  const type = clean(value, 32).toUpperCase();
  if (!type) return fallback;
  if (!isLineType(type)) {
    throw new WorkOrderLineError("INVALID_LINE_TYPE", `Unsupported line type: ${type}`);
  }
  return type;
}

function normalizeStatus(value: unknown, fallback: LineStatus = "DRAFT"): LineStatus {
  const status = clean(value, 32).toUpperCase();
  if (!status) return fallback;
  if (!isLineStatus(status)) {
    throw new WorkOrderLineError("INVALID_LINE_STATUS", `Unsupported line status: ${status}`);
  }
  return status;
}

function validateTransition(from: LineStatus, to: LineStatus) {
  if (from === to) return;
  const allowed: Record<LineStatus, readonly LineStatus[]> = {
    DRAFT: ["APPROVED", "CANCELLED"],
    APPROVED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
    IN_PROGRESS: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
  };
  if (!allowed[from].includes(to)) {
    throw new WorkOrderLineError("INVALID_STATUS_TRANSITION", `WorkOrder line cannot move ${from} → ${to}`);
  }
}

function validateAmounts(
  plannedQuantity: Prisma.Decimal,
  plannedUnitPrice: Prisma.Decimal,
  plannedUnitCost: Prisma.Decimal,
  plannedDiscount: Prisma.Decimal,
  actualQuantity: Prisma.Decimal | null,
  actualUnitPrice: Prisma.Decimal | null,
  actualUnitCost: Prisma.Decimal | null,
  actualDiscount: Prisma.Decimal | null,
) {
  positive(plannedQuantity, "plannedQuantity");
  nonNegative(plannedUnitPrice, "plannedUnitPrice");
  nonNegative(plannedUnitCost, "plannedUnitCost");
  nonNegative(plannedDiscount, "plannedDiscount");
  const plannedGross = plannedQuantity.mul(plannedUnitPrice);
  if (plannedDiscount.greaterThan(plannedGross)) {
    throw new WorkOrderLineError("DISCOUNT_EXCEEDS_LINE_REVENUE", "plannedDiscount cannot exceed planned line revenue");
  }

  if (actualQuantity) positive(actualQuantity, "actualQuantity");
  if (actualUnitPrice) nonNegative(actualUnitPrice, "actualUnitPrice");
  if (actualUnitCost) nonNegative(actualUnitCost, "actualUnitCost");
  if (actualDiscount) nonNegative(actualDiscount, "actualDiscount");
  if (actualDiscount) {
    const actualGross = (actualQuantity ?? plannedQuantity).mul(actualUnitPrice ?? plannedUnitPrice);
    if (actualDiscount.greaterThan(actualGross)) {
      throw new WorkOrderLineError("DISCOUNT_EXCEEDS_LINE_REVENUE", "actualDiscount cannot exceed actual line revenue");
    }
  }
}

async function ensureWorkOrder(tx: Prisma.TransactionClient, workOrderId: string) {
  const workOrder = await tx.workOrder.findUnique({ where: { id: workOrderId } });
  if (!workOrder) throw new WorkOrderLineError("WORK_ORDER_NOT_FOUND", "WorkOrder not found");
  return workOrder;
}

async function ensureFinanceUnlocked(tx: Prisma.TransactionClient, workOrderId: string) {
  const actual = await tx.workOrderFinanceSnapshot.findUnique({
    where: { workOrderId_kind: { workOrderId, kind: "ACTUAL" } },
    select: { id: true, lockedAt: true },
  });
  if (actual?.lockedAt) {
    throw new WorkOrderLineError(
      "ACTUAL_ALREADY_LOCKED",
      "WorkOrder line items are locked because actual finance has already been finalized",
    );
  }
}

async function loadCatalogWork(tx: Prisma.TransactionClient, catalogItemId: string) {
  const rows = await tx.$queryRawUnsafe<CatalogWorkRow[]>(
    `SELECT "id","name","code","data" FROM "CrmDirectoryItem" WHERE "id"=$1 AND "category"='WORK_PRICE' AND "isActive"=TRUE LIMIT 1`,
    catalogItemId,
  );
  const row = rows[0];
  if (!row) throw new WorkOrderLineError("CATALOG_WORK_NOT_FOUND", "Work price catalog item not found or inactive");
  return row;
}

function decimalFromUnknown(value: unknown, fallback = new Prisma.Decimal(0)) {
  if (value == null || value === "") return fallback;
  try {
    const result = new Prisma.Decimal(String(value));
    return result.isFinite() ? result : fallback;
  } catch {
    return fallback;
  }
}

async function deriveCreateInput(tx: Prisma.TransactionClient, body: Record<string, unknown>) {
  const catalogItemId = optionalString(body.catalogItemId, 160);
  const supplierQuoteId = optionalString(body.supplierQuoteId, 160);
  if (catalogItemId && supplierQuoteId) {
    throw new WorkOrderLineError("AMBIGUOUS_SOURCE", "Use either catalogItemId or supplierQuoteId, not both");
  }

  let derived: Record<string, unknown> = {};
  let derivedMetadata: Record<string, unknown> = {};

  if (catalogItemId) {
    const item = await loadCatalogWork(tx, catalogItemId);
    const data = isRecord(item.data) ? item.data : {};
    derived = {
      type: "LABOR",
      description: item.name,
      code: item.code,
      unit: clean(data.unit, 32) || "робота",
      plannedUnitPrice: decimalFromUnknown(data.price),
      plannedUnitCost: 0,
      laborHours: data.normHours == null ? null : decimalFromUnknown(data.normHours),
      catalogItemId: item.id,
      sourceEntity: "WORK_PRICE",
      sourceEntityId: item.id,
    };
    derivedMetadata = { source: "WORK_PRICE", catalogItemId: item.id };
  }

  if (supplierQuoteId) {
    const quote = await tx.supplierProductQuote.findUnique({
      where: { id: supplierQuoteId },
      include: { supplier: true },
    });
    if (!quote) throw new WorkOrderLineError("SUPPLIER_QUOTE_NOT_FOUND", "Supplier quote not found");
    if (quote.expiresAt && quote.expiresAt.getTime() < Date.now()) {
      throw new WorkOrderLineError("SUPPLIER_QUOTE_EXPIRED", "Supplier quote has expired; refresh supplier price before adding it");
    }
    const purchasePrice = quote.purchasePrice ?? new Prisma.Decimal(0);
    const markupPercent = hasOwn(body, "markupPercent")
      ? nonNegative(decimal(body.markupPercent, "markupPercent"), "markupPercent")
      : quote.supplier.defaultMarkupPercent;
    const salePrice = purchasePrice.mul(new Prisma.Decimal(1).plus(markupPercent.div(100))).toDecimalPlaces(2);
    derived = {
      type: "PART",
      description: quote.name || [quote.brand, quote.article].filter(Boolean).join(" ") || quote.article,
      article: quote.article,
      brand: quote.brand,
      unit: "шт",
      currency: quote.currency || quote.supplier.defaultCurrency || "UAH",
      plannedUnitPrice: salePrice,
      plannedUnitCost: purchasePrice,
      supplierId: quote.supplierId,
      supplierQuoteId: quote.id,
      sourceEntity: "SUPPLIER_QUOTE",
      sourceEntityId: quote.id,
    };
    derivedMetadata = {
      source: "SUPPLIER_QUOTE",
      supplierQuoteId: quote.id,
      quoteFetchedAt: quote.fetchedAt.toISOString(),
      markupPercent: markupPercent.toFixed(2),
    };
  }

  const value = (key: string) => (hasOwn(body, key) ? body[key] : derived[key]);
  const type = normalizeType(value("type"), catalogItemId ? "LABOR" : supplierQuoteId ? "PART" : "OTHER");
  const description = clean(value("description"), 500);
  if (!description) throw new WorkOrderLineError("DESCRIPTION_REQUIRED", "WorkOrder line description is required");

  const plannedQuantity = positive(decimal(value("plannedQuantity"), "plannedQuantity", 1), "plannedQuantity");
  const plannedUnitPrice = nonNegative(decimal(value("plannedUnitPrice"), "plannedUnitPrice", 0), "plannedUnitPrice");
  const plannedUnitCost = nonNegative(decimal(value("plannedUnitCost"), "plannedUnitCost", 0), "plannedUnitCost");
  const plannedDiscount = nonNegative(decimal(value("plannedDiscount"), "plannedDiscount", 0), "plannedDiscount");
  const actualQuantity = optionalDecimal(value("actualQuantity"), "actualQuantity");
  const actualUnitPrice = optionalDecimal(value("actualUnitPrice"), "actualUnitPrice");
  const actualUnitCost = optionalDecimal(value("actualUnitCost"), "actualUnitCost");
  const actualDiscount = optionalDecimal(value("actualDiscount"), "actualDiscount");
  validateAmounts(
    plannedQuantity,
    plannedUnitPrice,
    plannedUnitCost,
    plannedDiscount,
    actualQuantity,
    actualUnitPrice,
    actualUnitCost,
    actualDiscount,
  );

  const status = normalizeStatus(value("status"), "DRAFT");
  const now = new Date();
  const bodyMetadata = isRecord(body.metadata) ? body.metadata : {};

  return {
    type,
    status,
    description,
    code: optionalString(value("code"), 120),
    article: optionalString(value("article"), 120),
    brand: optionalString(value("brand"), 120),
    unit: clean(value("unit"), 32) || "шт",
    currency: normalizeFinanceCurrency(value("currency")),
    plannedQuantity,
    plannedUnitPrice,
    plannedUnitCost,
    plannedDiscount,
    actualQuantity,
    actualUnitPrice,
    actualUnitCost,
    actualDiscount,
    laborHours: optionalDecimal(value("laborHours"), "laborHours"),
    mechanicId: optionalString(value("mechanicId"), 160),
    supplierId: optionalString(value("supplierId"), 160),
    supplierQuoteId: optionalString(value("supplierQuoteId"), 160),
    supplierOrderId: optionalString(value("supplierOrderId"), 160),
    catalogItemId: optionalString(value("catalogItemId"), 160),
    sourceEntity: optionalString(value("sourceEntity"), 40),
    sourceEntityId: optionalString(value("sourceEntityId"), 96),
    approvedAt: status === "APPROVED" || status === "IN_PROGRESS" || status === "COMPLETED" ? now : null,
    startedAt: status === "IN_PROGRESS" || status === "COMPLETED" ? now : null,
    completedAt: status === "COMPLETED" ? now : null,
    cancelledAt: status === "CANCELLED" ? now : null,
    metadata: toPrismaJson({ ...derivedMetadata, ...bodyMetadata }),
  };
}

function summarizeLines(lines: readonly WorkOrderLineRecord[], mode: FinanceMode, strictActual = true) {
  if (mode === "ACTUAL" && strictActual) {
    const unfinished = lines.filter((line) => !["COMPLETED", "CANCELLED"].includes(line.status));
    if (unfinished.length) {
      throw new WorkOrderLineError(
        "LINES_NOT_COMPLETED",
        `${unfinished.length} WorkOrder line item(s) must be completed or cancelled before financial finalization`,
      );
    }
  }

  const included = lines.filter((line) => mode === "PLANNED" ? line.status !== "CANCELLED" : line.status === "COMPLETED");
  const currencies = [...new Set(included.map((line) => line.currency.toUpperCase()))];
  if (currencies.length > 1) {
    throw new WorkOrderLineError("MIXED_CURRENCIES", "A WorkOrder cannot be finalized with line items in multiple currencies");
  }

  const totals = {
    laborRevenue: new Prisma.Decimal(0),
    partsRevenue: new Prisma.Decimal(0),
    externalRevenue: new Prisma.Decimal(0),
    otherRevenue: new Prisma.Decimal(0),
    discountAmount: new Prisma.Decimal(0),
    refundAmount: new Prisma.Decimal(0),
    partsCost: new Prisma.Decimal(0),
    laborCost: new Prisma.Decimal(0),
    externalCost: new Prisma.Decimal(0),
    consumablesCost: new Prisma.Decimal(0),
    otherDirectCost: new Prisma.Decimal(0),
  };

  for (const line of included) {
    const quantity = mode === "ACTUAL" ? line.actualQuantity ?? line.plannedQuantity : line.plannedQuantity;
    const unitPrice = mode === "ACTUAL" ? line.actualUnitPrice ?? line.plannedUnitPrice : line.plannedUnitPrice;
    const unitCost = mode === "ACTUAL" ? line.actualUnitCost ?? line.plannedUnitCost : line.plannedUnitCost;
    const discount = mode === "ACTUAL" ? line.actualDiscount ?? line.plannedDiscount : line.plannedDiscount;
    const revenue = quantity.mul(unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const cost = quantity.mul(unitCost).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    totals.discountAmount = totals.discountAmount.plus(discount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    switch (line.type) {
      case "LABOR":
        totals.laborRevenue = totals.laborRevenue.plus(revenue);
        totals.laborCost = totals.laborCost.plus(cost);
        break;
      case "PART":
        totals.partsRevenue = totals.partsRevenue.plus(revenue);
        totals.partsCost = totals.partsCost.plus(cost);
        break;
      case "EXTERNAL":
        totals.externalRevenue = totals.externalRevenue.plus(revenue);
        totals.externalCost = totals.externalCost.plus(cost);
        break;
      case "CONSUMABLE":
        totals.otherRevenue = totals.otherRevenue.plus(revenue);
        totals.consumablesCost = totals.consumablesCost.plus(cost);
        break;
      case "OTHER":
        totals.otherRevenue = totals.otherRevenue.plus(revenue);
        totals.otherDirectCost = totals.otherDirectCost.plus(cost);
        break;
    }
  }

  const input: WorkOrderFinanceInput = {
    currency: currencies[0] ?? "UAH",
    ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value.toFixed(2)])),
  };
  return {
    input,
    calculation: calculateWorkOrderFinance(input),
    includedLineCount: included.length,
    totalLineCount: lines.length,
  };
}

async function syncPlannedSnapshotTx(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  actorName: string,
) {
  const lines = await tx.workOrderLine.findMany({
    where: { workOrderId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const summary = summarizeLines(lines, "PLANNED");
  const calculation = summary.calculation;
  const now = new Date();
  const metadata = toPrismaJson({
    version: 3,
    source: "WORK_ORDER_LINES",
    fingerprint: calculation.fingerprint,
    lineCount: summary.includedLineCount,
    actorName,
  });

  const snapshot = await tx.workOrderFinanceSnapshot.upsert({
    where: { workOrderId_kind: { workOrderId, kind: "PLANNED" } },
    update: {
      currency: calculation.currency,
      laborRevenue: calculation.laborRevenue,
      partsRevenue: calculation.partsRevenue,
      externalRevenue: calculation.externalRevenue,
      otherRevenue: calculation.otherRevenue,
      discountAmount: calculation.discountAmount,
      refundAmount: calculation.refundAmount,
      partsCost: calculation.partsCost,
      laborCost: calculation.laborCost,
      externalCost: calculation.externalCost,
      consumablesCost: calculation.consumablesCost,
      otherDirectCost: calculation.otherDirectCost,
      grossRevenue: calculation.grossRevenue,
      directCost: calculation.directCost,
      grossProfit: calculation.grossProfit,
      grossMarginPercent: calculation.grossMarginPercent,
      calculatedAt: now,
      metadata,
    },
    create: {
      workOrderId,
      kind: "PLANNED",
      currency: calculation.currency,
      laborRevenue: calculation.laborRevenue,
      partsRevenue: calculation.partsRevenue,
      externalRevenue: calculation.externalRevenue,
      otherRevenue: calculation.otherRevenue,
      discountAmount: calculation.discountAmount,
      refundAmount: calculation.refundAmount,
      partsCost: calculation.partsCost,
      laborCost: calculation.laborCost,
      externalCost: calculation.externalCost,
      consumablesCost: calculation.consumablesCost,
      otherDirectCost: calculation.otherDirectCost,
      grossRevenue: calculation.grossRevenue,
      directCost: calculation.directCost,
      grossProfit: calculation.grossProfit,
      grossMarginPercent: calculation.grossMarginPercent,
      calculatedAt: now,
      metadata,
    },
  });

  return { lines, snapshot, summary };
}

export async function hasWorkOrderLines(workOrderId: string) {
  const prisma = getPrisma();
  return (await prisma.workOrderLine.count({ where: { workOrderId } })) > 0;
}

export async function getWorkOrderLines(workOrderId: string) {
  const prisma = getPrisma();
  const workOrder = await prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, status: true } });
  if (!workOrder) throw new WorkOrderLineError("WORK_ORDER_NOT_FOUND", "WorkOrder not found");

  const lines = await prisma.workOrderLine.findMany({
    where: { workOrderId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const planned = summarizeLines(lines, "PLANNED");
  const actualPreview = summarizeLines(lines, "ACTUAL", false);
  const actualReady = lines.length > 0 && lines.every((line) => ["COMPLETED", "CANCELLED"].includes(line.status));
  const statusCounts = Object.fromEntries(LINE_STATUSES.map((status) => [status, lines.filter((line) => line.status === status).length]));

  return {
    workOrder,
    sourceOfTruth: "WORK_ORDER_LINES" as const,
    lines,
    statusCounts,
    actualReady,
    planned: planned.calculation,
    actualPreview: actualPreview.calculation,
  };
}

export async function rebuildPlannedSnapshotFromLines(
  workOrderId: string,
  actorName = "CRM / Сервіс-менеджер",
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`wo-lines:${workOrderId}`}))`;
    await ensureWorkOrder(tx, workOrderId);
    await ensureFinanceUnlocked(tx, workOrderId);
    const result = await syncPlannedSnapshotTx(tx, workOrderId, actorName);
    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: "FINANCE_PLAN_REBUILT_FROM_LINES",
        after: toPrismaJson(result.snapshot),
        metadata: toPrismaJson({ source: "WORK_ORDER_LINES", lineCount: result.summary.includedLineCount }),
      },
    });
    return result;
  });
}

export async function createWorkOrderLine(
  workOrderId: string,
  body: Record<string, unknown>,
  actorName = "CRM / Сервіс-менеджер",
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`wo-lines:${workOrderId}`}))`;
    await ensureWorkOrder(tx, workOrderId);
    await ensureFinanceUnlocked(tx, workOrderId);
    const derived = await deriveCreateInput(tx, body);
    const last = await tx.workOrderLine.findFirst({
      where: { workOrderId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const requestedSort = Number(body.sortOrder);
    const sortOrder = Number.isInteger(requestedSort) ? Math.max(-100000, Math.min(100000, requestedSort)) : (last?.sortOrder ?? 0) + 10;
    const line = await tx.workOrderLine.create({ data: { workOrderId, ...derived, sortOrder } });
    const finance = await syncPlannedSnapshotTx(tx, workOrderId, actorName);

    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrderLine",
        entityId: line.id,
        action: "WORK_ORDER_LINE_CREATED",
        after: toPrismaJson(line),
        metadata: toPrismaJson({ workOrderId, financeFingerprint: finance.summary.calculation.fingerprint }),
      },
    });
    return { line, planned: finance.summary.calculation, snapshot: finance.snapshot };
  });
}

export async function updateWorkOrderLine(
  workOrderId: string,
  lineId: string,
  body: Record<string, unknown>,
  actorName = "CRM / Сервіс-менеджер",
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`wo-lines:${workOrderId}`}))`;
    await ensureWorkOrder(tx, workOrderId);
    await ensureFinanceUnlocked(tx, workOrderId);
    const current = await tx.workOrderLine.findFirst({ where: { id: lineId, workOrderId } });
    if (!current) throw new WorkOrderLineError("LINE_NOT_FOUND", "WorkOrder line not found");

    const status = hasOwn(body, "status") ? normalizeStatus(body.status, current.status) : current.status;
    validateTransition(current.status, status);
    const plannedQuantity = hasOwn(body, "plannedQuantity") ? decimal(body.plannedQuantity, "plannedQuantity") : current.plannedQuantity;
    const plannedUnitPrice = hasOwn(body, "plannedUnitPrice") ? decimal(body.plannedUnitPrice, "plannedUnitPrice") : current.plannedUnitPrice;
    const plannedUnitCost = hasOwn(body, "plannedUnitCost") ? decimal(body.plannedUnitCost, "plannedUnitCost") : current.plannedUnitCost;
    const plannedDiscount = hasOwn(body, "plannedDiscount") ? decimal(body.plannedDiscount, "plannedDiscount") : current.plannedDiscount;
    const actualQuantity = hasOwn(body, "actualQuantity") ? optionalDecimal(body.actualQuantity, "actualQuantity") : current.actualQuantity;
    const actualUnitPrice = hasOwn(body, "actualUnitPrice") ? optionalDecimal(body.actualUnitPrice, "actualUnitPrice") : current.actualUnitPrice;
    const actualUnitCost = hasOwn(body, "actualUnitCost") ? optionalDecimal(body.actualUnitCost, "actualUnitCost") : current.actualUnitCost;
    const actualDiscount = hasOwn(body, "actualDiscount") ? optionalDecimal(body.actualDiscount, "actualDiscount") : current.actualDiscount;
    validateAmounts(
      plannedQuantity,
      plannedUnitPrice,
      plannedUnitCost,
      plannedDiscount,
      actualQuantity,
      actualUnitPrice,
      actualUnitCost,
      actualDiscount,
    );

    if (current.status === "COMPLETED") {
      const plannedFields = ["type", "description", "currency", "plannedQuantity", "plannedUnitPrice", "plannedUnitCost", "plannedDiscount", "catalogItemId", "supplierQuoteId"];
      if (plannedFields.some((field) => hasOwn(body, field))) {
        throw new WorkOrderLineError("COMPLETED_LINE_PLANNED_LOCKED", "Planned fields cannot be changed after line completion");
      }
    }

    const now = new Date();
    const data: Prisma.WorkOrderLineUncheckedUpdateInput = {
      type: hasOwn(body, "type") ? normalizeType(body.type, current.type) : current.type,
      status,
      description: hasOwn(body, "description") ? clean(body.description, 500) : current.description,
      code: hasOwn(body, "code") ? optionalString(body.code, 120) : current.code,
      article: hasOwn(body, "article") ? optionalString(body.article, 120) : current.article,
      brand: hasOwn(body, "brand") ? optionalString(body.brand, 120) : current.brand,
      unit: hasOwn(body, "unit") ? clean(body.unit, 32) || current.unit : current.unit,
      currency: hasOwn(body, "currency") ? normalizeFinanceCurrency(body.currency) : current.currency,
      plannedQuantity,
      plannedUnitPrice,
      plannedUnitCost,
      plannedDiscount,
      actualQuantity,
      actualUnitPrice,
      actualUnitCost,
      actualDiscount,
      laborHours: hasOwn(body, "laborHours") ? optionalDecimal(body.laborHours, "laborHours") : current.laborHours,
      mechanicId: hasOwn(body, "mechanicId") ? optionalString(body.mechanicId, 160) : current.mechanicId,
      supplierId: hasOwn(body, "supplierId") ? optionalString(body.supplierId, 160) : current.supplierId,
      supplierQuoteId: hasOwn(body, "supplierQuoteId") ? optionalString(body.supplierQuoteId, 160) : current.supplierQuoteId,
      supplierOrderId: hasOwn(body, "supplierOrderId") ? optionalString(body.supplierOrderId, 160) : current.supplierOrderId,
      catalogItemId: hasOwn(body, "catalogItemId") ? optionalString(body.catalogItemId, 160) : current.catalogItemId,
      sourceEntity: hasOwn(body, "sourceEntity") ? optionalString(body.sourceEntity, 40) : current.sourceEntity,
      sourceEntityId: hasOwn(body, "sourceEntityId") ? optionalString(body.sourceEntityId, 96) : current.sourceEntityId,
      sortOrder: hasOwn(body, "sortOrder") && Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : current.sortOrder,
      approvedAt: status === "APPROVED" && !current.approvedAt ? now : current.approvedAt,
      startedAt: status === "IN_PROGRESS" && !current.startedAt ? now : current.startedAt,
      completedAt: status === "COMPLETED" && !current.completedAt ? now : current.completedAt,
      cancelledAt: status === "CANCELLED" && !current.cancelledAt ? now : current.cancelledAt,
      metadata: hasOwn(body, "metadata") && isRecord(body.metadata)
        ? toPrismaJson(body.metadata)
        : current.metadata === null ? Prisma.JsonNull : current.metadata,
    };
    if (!String(data.description ?? "").trim()) throw new WorkOrderLineError("DESCRIPTION_REQUIRED", "WorkOrder line description is required");

    const line = await tx.workOrderLine.update({ where: { id: current.id }, data });
    const finance = await syncPlannedSnapshotTx(tx, workOrderId, actorName);
    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrderLine",
        entityId: line.id,
        action: "WORK_ORDER_LINE_UPDATED",
        before: toPrismaJson(current),
        after: toPrismaJson(line),
        metadata: toPrismaJson({ workOrderId, financeFingerprint: finance.summary.calculation.fingerprint }),
      },
    });
    return { line, planned: finance.summary.calculation, snapshot: finance.snapshot };
  });
}

export async function cancelWorkOrderLine(
  workOrderId: string,
  lineId: string,
  actorName = "CRM / Сервіс-менеджер",
) {
  return updateWorkOrderLine(workOrderId, lineId, { status: "CANCELLED" }, actorName);
}

export async function finalizeWorkOrderFinanceFromLines(
  workOrderId: string,
  options: Record<string, unknown> = {},
  actorName = "CRM / Сервіс-менеджер",
) {
  const prisma = getPrisma();
  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`wo-lines:${workOrderId}`}))`;
    await ensureWorkOrder(tx, workOrderId);
    const lines = await tx.workOrderLine.findMany({
      where: { workOrderId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    if (!lines.length) throw new WorkOrderLineError("NO_LINE_ITEMS", "WorkOrder has no canonical line items to finalize");
    const summary = summarizeLines(lines, "ACTUAL", true);
    const calculation = summary.calculation;
    const existing = await tx.workOrderFinanceSnapshot.findUnique({
      where: { workOrderId_kind: { workOrderId, kind: "ACTUAL" } },
    });
    if (existing?.lockedAt) {
      const fingerprint = isRecord(existing.metadata) ? existing.metadata.fingerprint : null;
      if (fingerprint !== calculation.fingerprint) {
        throw new WorkOrderLineError(
          "ACTUAL_ALREADY_LOCKED",
          "Actual finance was finalized with a different line-item fingerprint; use the reversal/correction workflow",
        );
      }
      return { summary, snapshot: existing, alreadyLocked: true };
    }

    const now = new Date();
    const metadata = toPrismaJson({
      version: 3,
      source: "WORK_ORDER_LINES",
      fingerprint: calculation.fingerprint,
      lineCount: summary.includedLineCount,
      lockedBy: actorName,
    });
    const snapshot = await tx.workOrderFinanceSnapshot.upsert({
      where: { workOrderId_kind: { workOrderId, kind: "ACTUAL" } },
      update: {
        currency: calculation.currency,
        laborRevenue: calculation.laborRevenue,
        partsRevenue: calculation.partsRevenue,
        externalRevenue: calculation.externalRevenue,
        otherRevenue: calculation.otherRevenue,
        discountAmount: calculation.discountAmount,
        refundAmount: calculation.refundAmount,
        partsCost: calculation.partsCost,
        laborCost: calculation.laborCost,
        externalCost: calculation.externalCost,
        consumablesCost: calculation.consumablesCost,
        otherDirectCost: calculation.otherDirectCost,
        grossRevenue: calculation.grossRevenue,
        directCost: calculation.directCost,
        grossProfit: calculation.grossProfit,
        grossMarginPercent: calculation.grossMarginPercent,
        calculatedAt: now,
        lockedAt: now,
        metadata,
      },
      create: {
        workOrderId,
        kind: "ACTUAL",
        currency: calculation.currency,
        laborRevenue: calculation.laborRevenue,
        partsRevenue: calculation.partsRevenue,
        externalRevenue: calculation.externalRevenue,
        otherRevenue: calculation.otherRevenue,
        discountAmount: calculation.discountAmount,
        refundAmount: calculation.refundAmount,
        partsCost: calculation.partsCost,
        laborCost: calculation.laborCost,
        externalCost: calculation.externalCost,
        consumablesCost: calculation.consumablesCost,
        otherDirectCost: calculation.otherDirectCost,
        grossRevenue: calculation.grossRevenue,
        directCost: calculation.directCost,
        grossProfit: calculation.grossProfit,
        grossMarginPercent: calculation.grossMarginPercent,
        calculatedAt: now,
        lockedAt: now,
        metadata,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: "FINANCE_ACTUAL_LOCKED_FROM_LINES",
        after: toPrismaJson(snapshot),
        metadata: toPrismaJson({ lineCount: summary.includedLineCount, fingerprint: calculation.fingerprint }),
      },
    });
    return { summary, snapshot, alreadyLocked: false };
  });

  const input: WorkOrderFinanceInput = {
    ...prepared.summary.input,
    recognizedAt: options.recognizedAt,
    dueAt: options.dueAt,
  };
  try {
    const posted = await finalizeWorkOrderFinance(workOrderId, input, actorName);
    return { ...posted, sourceOfTruth: "WORK_ORDER_LINES" as const, lineCount: prepared.summary.includedLineCount };
  } catch (error) {
    if (error instanceof WorkOrderFinanceError) throw error;
    throw error;
  }
}
