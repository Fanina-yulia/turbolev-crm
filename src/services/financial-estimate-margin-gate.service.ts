import { createHash } from "node:crypto";
import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import type { FinanceActor } from "@/src/services/financial-center-v2.service";

const ACTIVE_LINE_STATUSES = ["DRAFT", "APPROVED", "IN_PROGRESS", "COMPLETED"] as const;
const ENTITY_TYPE = "WorkOrderMarginApproval";
const REQUESTED = "MARGIN_APPROVAL_REQUESTED";
const APPROVED = "MARGIN_APPROVAL_APPROVED";

type CommercialLine = Prisma.WorkOrderLineGetPayload<{}>;

export class EstimateMarginGateError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, status = 409, details?: Record<string, unknown>) {
    super(message);
    this.name = "EstimateMarginGateError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function lineSnapshot(line: CommercialLine) {
  return {
    id: line.id,
    type: line.type,
    status: line.status,
    description: line.description,
    code: line.code,
    article: line.article,
    brand: line.brand,
    unit: line.unit,
    currency: line.currency.toUpperCase(),
    requiredForRepair: line.requiredForRepair,
    plannedQuantity: line.plannedQuantity.toFixed(3),
    plannedUnitPrice: line.plannedUnitPrice.toFixed(2),
    plannedUnitCost: line.plannedUnitCost.toFixed(2),
    plannedDiscount: line.plannedDiscount.toFixed(2),
    laborHours: line.laborHours?.toFixed(2) ?? null,
    mechanicId: line.mechanicId,
    supplierId: line.supplierId,
    supplierQuoteId: line.supplierQuoteId,
    supplierOrderId: line.supplierOrderId,
    catalogItemId: line.catalogItemId,
    sortOrder: line.sortOrder,
  };
}

function fingerprint(snapshot: unknown) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function approvalEntityId(workOrderId: string, lineFingerprint: string) {
  return `mg_${createHash("sha256").update(`${workOrderId}:${lineFingerprint}`).digest("hex")}`.slice(0, 96);
}

function number(value: Prisma.Decimal) {
  return Number(value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toString());
}

async function calculateMarginState(workOrderId: string) {
  const prisma = getPrisma();
  const workOrder = await prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true } });
  if (!workOrder) throw new EstimateMarginGateError("WORK_ORDER_NOT_FOUND", "Замовлення-наряд не знайдено.", 404);

  const [lines, appointment] = await Promise.all([
    prisma.workOrderLine.findMany({
      where: { workOrderId, status: { in: [...ACTIVE_LINE_STATUSES] } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.serviceAppointment.findFirst({
      where: { workOrderId },
      orderBy: [{ actualArrivalAt: "desc" }, { plannedStartAt: "desc" }, { createdAt: "desc" }],
      select: { locationId: true },
    }),
  ]);
  if (!lines.length) throw new EstimateMarginGateError("NO_LINE_ITEMS", "Додайте роботи або деталі до комерційної пропозиції.");

  const currencies = [...new Set(lines.map((line) => line.currency.toUpperCase()))];
  if (currencies.length !== 1) throw new EstimateMarginGateError("MIXED_CURRENCIES", "Кошторис не може містити рядки в різних валютах.");

  const snapshot = lines.map(lineSnapshot);
  const lineFingerprint = fingerprint(snapshot);
  let subtotal = new Prisma.Decimal(0);
  let discount = new Prisma.Decimal(0);
  let plannedCost = new Prisma.Decimal(0);
  for (const line of lines) {
    subtotal = subtotal.plus(line.plannedQuantity.mul(line.plannedUnitPrice));
    discount = discount.plus(line.plannedDiscount);
    plannedCost = plannedCost.plus(line.plannedQuantity.mul(line.plannedUnitCost));
  }
  const revenue = Prisma.Decimal.max(new Prisma.Decimal(0), subtotal.minus(discount)).toDecimalPlaces(2);
  const cost = plannedCost.toDecimalPlaces(2);
  const marginAmount = revenue.minus(cost).toDecimalPlaces(2);
  const marginPercent = revenue.greaterThan(0)
    ? marginAmount.div(revenue).mul(100).toDecimalPlaces(2)
    : new Prisma.Decimal(0);

  const locationId = appointment?.locationId || null;
  const settings = locationId
    ? await prisma.financialSettings.findUnique({ where: { scopeKey: `LOCATION:${locationId}` } })
    : null;
  const globalSettings = settings ? null : await prisma.financialSettings.findUnique({ where: { scopeKey: "GLOBAL" } });
  const threshold = settings?.warningGrossMarginPercent ?? globalSettings?.warningGrossMarginPercent ?? new Prisma.Decimal(25);
  const required = marginPercent.lessThan(threshold);
  const entityId = approvalEntityId(workOrderId, lineFingerprint);
  const approval = required ? await prisma.auditEvent.findFirst({
    where: { entityType: ENTITY_TYPE, entityId, action: APPROVED },
    orderBy: { createdAt: "desc" },
  }) : null;

  return {
    workOrderId,
    fingerprint: lineFingerprint,
    entityId,
    currency: currencies[0],
    locationId,
    revenue: number(revenue),
    plannedCost: number(cost),
    grossMarginAmount: number(marginAmount),
    grossMarginPercent: number(marginPercent),
    warningMarginPercent: number(threshold),
    approvalRequired: required,
    approved: !required || Boolean(approval),
    approvedAt: approval?.createdAt ?? null,
    approvedByName: approval?.actorName ?? null,
  };
}

async function ensureRequestAudit(state: Awaited<ReturnType<typeof calculateMarginState>>, actorName: string) {
  const prisma = getPrisma();
  const existing = await prisma.auditEvent.findFirst({ where: { entityType: ENTITY_TYPE, entityId: state.entityId, action: REQUESTED } });
  if (existing) return existing;
  return prisma.auditEvent.create({
    data: {
      actorName,
      entityType: ENTITY_TYPE,
      entityId: state.entityId,
      action: REQUESTED,
      after: toPrismaJson(state),
      metadata: toPrismaJson(state),
    },
  });
}

export async function assertEstimateMarginApprovedBeforeSend(workOrderId: string, actorName = "CRM / Сервіс-менеджер") {
  const state = await calculateMarginState(workOrderId);
  if (!state.approvalRequired || state.approved) return state;
  await ensureRequestAudit(state, actorName);
  throw new EstimateMarginGateError(
    "ESTIMATE_MARGIN_APPROVAL_REQUIRED",
    `Маржа КП ${state.grossMarginPercent.toFixed(1)}% нижча за контрольний поріг ${state.warningMarginPercent.toFixed(1)}%. Потрібне фінансове погодження перед відправленням клієнту.`,
    409,
    state,
  );
}

export async function approveEstimateMargin(workOrderId: string, note: unknown, actor: FinanceActor) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`estimate-margin:${workOrderId}`}))`;
    const state = await calculateMarginState(workOrderId);
    if (!state.approvalRequired) return { ...state, approved: true, reused: true };
    const existing = await tx.auditEvent.findFirst({ where: { entityType: ENTITY_TYPE, entityId: state.entityId, action: APPROVED }, orderBy: { createdAt: "desc" } });
    if (existing) return { ...state, approved: true, approvedAt: existing.createdAt, approvedByName: existing.actorName, reused: true };
    await ensureRequestAudit(state, actor.name);
    const approval = await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        actorName: actor.name,
        entityType: ENTITY_TYPE,
        entityId: state.entityId,
        action: APPROVED,
        before: toPrismaJson(state),
        after: toPrismaJson({ ...state, approved: true, note: typeof note === "string" ? note.trim().slice(0, 2000) : null }),
        metadata: toPrismaJson({ ...state, note: typeof note === "string" ? note.trim().slice(0, 2000) : null }),
      },
    });
    return { ...state, approved: true, approvedAt: approval.createdAt, approvedByName: approval.actorName, reused: false };
  });
}

export async function listPendingEstimateMarginApprovals(locationId?: string | null, allowedLocationIds?: string[] | null) {
  const prisma = getPrisma();
  const requests = await prisma.auditEvent.findMany({
    where: { entityType: ENTITY_TYPE, action: REQUESTED },
    orderBy: { createdAt: "desc" },
    take: 250,
  });
  const entityIds = [...new Set(requests.map((row) => row.entityId))];
  const approvals = entityIds.length ? await prisma.auditEvent.findMany({
    where: { entityType: ENTITY_TYPE, action: APPROVED, entityId: { in: entityIds } },
    select: { entityId: true },
  }) : [];
  const approvedIds = new Set(approvals.map((row) => row.entityId));
  const seen = new Set<string>();
  const pending: Array<Record<string, unknown>> = [];
  for (const row of requests) {
    if (seen.has(row.entityId) || approvedIds.has(row.entityId)) continue;
    seen.add(row.entityId);
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {};
    const rowLocation = typeof metadata.locationId === "string" ? metadata.locationId : null;
    if (locationId && rowLocation !== locationId) continue;
    if (!locationId && allowedLocationIds?.length && (!rowLocation || !allowedLocationIds.includes(rowLocation))) continue;
    const workOrderId = typeof metadata.workOrderId === "string" ? metadata.workOrderId : null;
    if (!workOrderId) continue;
    let current: Awaited<ReturnType<typeof calculateMarginState>> | null = null;
    try { current = await calculateMarginState(workOrderId); } catch { current = null; }
    if (!current || current.entityId !== row.entityId || !current.approvalRequired || current.approved) continue;
    pending.push({ ...current, requestedAt: row.createdAt, requestedByName: row.actorName });
  }
  return pending;
}
