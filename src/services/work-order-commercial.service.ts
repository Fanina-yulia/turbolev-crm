import { createHash } from "node:crypto";
import { Prisma } from "@/src/generated/prisma/client";
import { evaluateWorkflowTransition, type WorkflowGateState } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

const ACTIVE_LINE_STATUSES = ["DRAFT", "APPROVED", "IN_PROGRESS", "COMPLETED"] as const;
const PARTS_STATUSES = [
  "NEW", "SELECTING", "SELECTED", "WAITING_APPROVAL", "APPROVED", "ORDER_REQUIRED", "ORDERED",
  "PARTIALLY_RECEIVED", "RECEIVED", "INSTALLED", "RETURNED", "CANCELLED",
] as const;
const PARTS_STATUS_SET = new Set<string>(PARTS_STATUSES);

type Tx = Prisma.TransactionClient;
type PartsStatus = (typeof PARTS_STATUSES)[number];
type CommercialLine = Prisma.WorkOrderLineGetPayload<{}>;

export class WorkOrderCommercialError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "WorkOrderCommercialError";
    this.code = code;
    this.details = details;
  }
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return toPrismaJson(value);
}

function isPartsStatus(value: string): value is PartsStatus {
  return PARTS_STATUS_SET.has(value);
}

function text(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function decimal(value: unknown, field: string) {
  try {
    const result = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(String(value ?? 0));
    if (!result.isFinite()) throw new Error("not finite");
    return result;
  } catch {
    throw new WorkOrderCommercialError("INVALID_NUMBER", `${field} must be numeric`);
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

async function ensureWorkOrder(tx: Tx, workOrderId: string) {
  const workOrder = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, status: true, clientId: true, vehicleId: true, diagnosticRequestId: true },
  });
  if (!workOrder) throw new WorkOrderCommercialError("WORK_ORDER_NOT_FOUND", "WorkOrder not found");
  return workOrder;
}

async function activeLines(tx: Tx, workOrderId: string) {
  return tx.workOrderLine.findMany({
    where: { workOrderId, status: { in: [...ACTIVE_LINE_STATUSES] } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

function buildSnapshot(lines: CommercialLine[]) {
  if (!lines.length) throw new WorkOrderCommercialError("NO_LINE_ITEMS", "Додайте роботи або деталі до комерційної пропозиції.");
  const currencies = [...new Set(lines.map((line) => line.currency.toUpperCase()))];
  if (currencies.length !== 1) {
    throw new WorkOrderCommercialError("MIXED_CURRENCIES", "Кошторис не може містити рядки в різних валютах.");
  }

  const snapshot = lines.map(lineSnapshot);
  const sums = {
    LABOR: new Prisma.Decimal(0),
    PART: new Prisma.Decimal(0),
    EXTERNAL: new Prisma.Decimal(0),
    CONSUMABLE: new Prisma.Decimal(0),
    OTHER: new Prisma.Decimal(0),
  } as Record<string, Prisma.Decimal>;
  let subtotal = new Prisma.Decimal(0);
  let discount = new Prisma.Decimal(0);

  for (const line of lines) {
    const gross = line.plannedQuantity.mul(line.plannedUnitPrice).toDecimalPlaces(2);
    subtotal = subtotal.plus(gross);
    discount = discount.plus(line.plannedDiscount);
    sums[line.type] = (sums[line.type] ?? new Prisma.Decimal(0)).plus(gross);
  }
  const total = Prisma.Decimal.max(new Prisma.Decimal(0), subtotal.minus(discount)).toDecimalPlaces(2);

  return {
    currency: currencies[0],
    snapshot,
    fingerprint: fingerprint(snapshot),
    subtotal: subtotal.toDecimalPlaces(2),
    discountAmount: discount.toDecimalPlaces(2),
    totalAmount: total,
    laborTotal: sums.LABOR.toDecimalPlaces(2),
    partsTotal: sums.PART.toDecimalPlaces(2),
    externalTotal: sums.EXTERNAL.toDecimalPlaces(2),
    consumablesTotal: sums.CONSUMABLE.toDecimalPlaces(2),
    otherTotal: sums.OTHER.toDecimalPlaces(2),
  };
}

async function latestEstimate(tx: Tx, workOrderId: string) {
  return tx.workOrderEstimate.findFirst({
    where: { workOrderId },
    orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
    include: { partsRequests: { include: { items: true } } },
  });
}

export async function ensureEstimateSnapshotTx(
  tx: Tx,
  workOrderId: string,
  options: { send?: boolean; actorName?: string } = {},
) {
  await ensureWorkOrder(tx, workOrderId);
  const lines = await activeLines(tx, workOrderId);
  const built = buildSnapshot(lines);
  const current = await latestEstimate(tx, workOrderId);
  const now = new Date();

  if (current && current.lineFingerprint === built.fingerprint && !["REJECTED", "SUPERSEDED", "CANCELLED"].includes(current.status)) {
    if (options.send && current.status === "DRAFT") {
      const sent = await tx.workOrderEstimate.update({
        where: { id: current.id },
        data: { status: "SENT", sentAt: current.sentAt ?? now },
        include: { partsRequests: { include: { items: true } } },
      });
      await tx.auditEvent.create({
        data: {
          actorName: options.actorName || "CRM / Сервіс-менеджер",
          entityType: "WorkOrderEstimate",
          entityId: sent.id,
          action: "ESTIMATE_SENT",
          after: jsonSafe(sent),
          metadata: jsonSafe({ workOrderId, revision: sent.revision, fingerprint: built.fingerprint }),
        },
      });
      return { estimate: sent, lines, built, created: false };
    }
    return { estimate: current, lines, built, created: false };
  }

  if (current && !["REJECTED", "SUPERSEDED", "CANCELLED"].includes(current.status)) {
    await tx.workOrderEstimate.update({
      where: { id: current.id },
      data: { status: "SUPERSEDED", supersededAt: now },
    });
  }

  const estimate = await tx.workOrderEstimate.create({
    data: {
      workOrderId,
      revision: (current?.revision ?? 0) + 1,
      status: options.send ? "SENT" : "DRAFT",
      currency: built.currency,
      lineFingerprint: built.fingerprint,
      lineSnapshot: jsonSafe(built.snapshot),
      subtotal: built.subtotal,
      discountAmount: built.discountAmount,
      totalAmount: built.totalAmount,
      laborTotal: built.laborTotal,
      partsTotal: built.partsTotal,
      externalTotal: built.externalTotal,
      consumablesTotal: built.consumablesTotal,
      otherTotal: built.otherTotal,
      sentAt: options.send ? now : null,
    },
    include: { partsRequests: { include: { items: true } } },
  });

  await tx.auditEvent.create({
    data: {
      actorName: options.actorName || "CRM / Сервіс-менеджер",
      entityType: "WorkOrderEstimate",
      entityId: estimate.id,
      action: options.send ? "ESTIMATE_CREATED_AND_SENT" : "ESTIMATE_CREATED",
      after: jsonSafe(estimate),
      metadata: jsonSafe({ workOrderId, revision: estimate.revision, fingerprint: built.fingerprint }),
    },
  });
  return { estimate, lines, built, created: true };
}

export async function ensurePartsRequestTx(
  tx: Tx,
  workOrderId: string,
  actorName = "CRM / Підбір запчастин",
) {
  const estimateState = await ensureEstimateSnapshotTx(tx, workOrderId, { actorName });
  const existing = await tx.partsRequest.findUnique({
    where: { estimateId: estimateState.estimate.id },
    include: { items: true, estimate: true },
  });
  if (existing) return existing;

  const partLines = estimateState.lines.filter((line) => line.type === "PART");
  if (!partLines.length) {
    throw new WorkOrderCommercialError("NO_PART_LINES", "У комерційній пропозиції немає деталей, для яких потрібен PartsRequest.");
  }

  const request = await tx.partsRequest.create({
    data: {
      workOrderId,
      estimateId: estimateState.estimate.id,
      status: "NEW",
      items: {
        create: partLines.map((line) => ({
          workOrderLineId: line.id,
          description: line.description,
          article: line.article,
          brand: line.brand,
          quantity: line.plannedQuantity,
          purchasePrice: line.plannedUnitCost,
          sellPrice: line.plannedUnitPrice,
          currency: line.currency,
          requiredForRepair: line.requiredForRepair,
          supplierId: line.supplierId,
          supplierQuoteId: line.supplierQuoteId,
          supplierOrderId: line.supplierOrderId,
          sourcingMode: line.supplierQuoteId ? "SUPPLIER_QUOTE" : null,
        })),
      },
    },
    include: { items: true, estimate: true },
  });

  await tx.auditEvent.create({
    data: {
      actorName,
      entityType: "PartsRequest",
      entityId: request.id,
      action: "PARTS_REQUEST_OPENED",
      after: jsonSafe(request),
      metadata: jsonSafe({ workOrderId, estimateId: request.estimateId, itemCount: request.items.length }),
    },
  });
  return request;
}

async function commercialStateTx(tx: Tx, workOrderId: string) {
  const workOrder = await ensureWorkOrder(tx, workOrderId);
  const lines = await activeLines(tx, workOrderId);
  const currentBuilt = lines.length ? buildSnapshot(lines) : null;
  const estimate = await latestEstimate(tx, workOrderId);
  const estimateIsCurrent = Boolean(currentBuilt && estimate && currentBuilt.fingerprint === estimate.lineFingerprint);
  const estimateApproved = Boolean(estimateIsCurrent && estimate?.status === "APPROVED" && estimate.approvedAt);
  const request = estimate?.partsRequests?.[0] ?? null;
  const requiredParts = lines.filter((line) => line.type === "PART" && line.requiredForRepair);
  const requestItems = request?.items ?? [];
  const partsReady = requiredParts.length === 0 || (
    Boolean(request) && requiredParts.every((line) => {
      const item = requestItems.find((candidate) => candidate.workOrderLineId === line.id);
      return Boolean(item && item.receivedQuantity.greaterThanOrEqualTo(item.quantity));
    })
  );
  const appointment = await tx.serviceAppointment.findFirst({
    where: { workOrderId, mechanicId: { not: null } },
    orderBy: [{ actualArrivalAt: "desc" }, { plannedStartAt: "desc" }],
    select: { id: true, mechanicId: true, postId: true, status: true },
  });
  const mechanicAssigned = Boolean(appointment?.mechanicId);
  const partsPaymentSatisfied = !request?.paymentRequired || Boolean(request.paymentConfirmedAt);

  const gates: WorkflowGateState = {
    ESTIMATE_APPROVED_BEFORE_REPAIR: estimateApproved,
    REQUIRED_PARTS_READY_BEFORE_REPAIR: partsReady,
    MECHANIC_ASSIGNED_BEFORE_REPAIR: mechanicAssigned,
    PARTS_PAYMENT_BEFORE_ORDER: partsPaymentSatisfied,
    ADDITIONAL_WORK_REQUIRES_APPROVAL: estimateApproved,
  };

  return {
    workOrder,
    lines,
    estimate,
    partsRequest: request,
    currentFingerprint: currentBuilt?.fingerprint ?? null,
    estimateIsCurrent,
    estimateApproved,
    requiredPartsCount: requiredParts.length,
    partsReady,
    mechanicAssigned,
    appointment,
    partsPaymentSatisfied,
    gates,
  };
}

export async function getWorkOrderCommercialState(workOrderId: string) {
  const prisma = getPrisma();
  return commercialStateTx(prisma, workOrderId);
}

export async function getWorkOrderGateStateTx(tx: Tx, workOrderId: string) {
  return (await commercialStateTx(tx, workOrderId)).gates;
}

export async function sendEstimate(workOrderId: string, actorName = "CRM / Сервіс-менеджер") {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`wo-commercial:${workOrderId}`}))`;
    return ensureEstimateSnapshotTx(tx, workOrderId, { send: true, actorName });
  });
}

export async function decideEstimate(
  workOrderId: string,
  input: { decision: "APPROVE" | "REJECT"; approvedByName?: string; source?: string; note?: string },
  actorName = "CRM / Сервіс-менеджер",
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`wo-commercial:${workOrderId}`}))`;
    await ensureWorkOrder(tx, workOrderId);
    const lines = await activeLines(tx, workOrderId);
    const current = buildSnapshot(lines);
    const estimate = await latestEstimate(tx, workOrderId);
    if (!estimate || estimate.status !== "SENT") {
      throw new WorkOrderCommercialError("ESTIMATE_NOT_SENT", "Спочатку сформуйте та відправте актуальний кошторис клієнту.");
    }
    if (estimate.lineFingerprint !== current.fingerprint) {
      await tx.workOrderEstimate.update({
        where: { id: estimate.id },
        data: { status: "SUPERSEDED", supersededAt: new Date() },
      });
      throw new WorkOrderCommercialError("ESTIMATE_SCOPE_CHANGED", "Склад або ціни наряду змінилися після відправки. Сформуйте нову ревізію кошторису.");
    }

    const now = new Date();
    const approved = input.decision === "APPROVE";
    const updated = await tx.workOrderEstimate.update({
      where: { id: estimate.id },
      data: approved ? {
        status: "APPROVED",
        approvedAt: now,
        approvedByName: text(input.approvedByName, 160) || null,
        approvalSource: text(input.source, 40) || "CRM",
        approvalNote: text(input.note, 2000) || null,
      } : {
        status: "REJECTED",
        rejectedAt: now,
        approvalSource: text(input.source, 40) || "CRM",
        approvalNote: text(input.note, 2000) || null,
      },
      include: { partsRequests: { include: { items: true } } },
    });

    if (approved) {
      await tx.workOrderLine.updateMany({
        where: { workOrderId, status: "DRAFT" },
        data: { status: "APPROVED", approvedAt: now },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrderEstimate",
        entityId: updated.id,
        action: approved ? "ESTIMATE_APPROVED" : "ESTIMATE_REJECTED",
        before: jsonSafe(estimate),
        after: jsonSafe(updated),
        metadata: jsonSafe({ workOrderId, revision: updated.revision, fingerprint: current.fingerprint }),
      },
    });
    return updated;
  });
}

export async function openPartsRequest(workOrderId: string, actorName = "CRM / Підбір запчастин") {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`wo-commercial:${workOrderId}`}))`;
    return ensurePartsRequestTx(tx, workOrderId, actorName);
  });
}

export async function transitionPartsRequest(
  partsRequestId: string,
  toStatus: string,
  actorName = "CRM / Підбір запчастин",
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`parts-request:${partsRequestId}`}))`;
    const request = await tx.partsRequest.findUnique({ where: { id: partsRequestId }, include: { items: true, estimate: true } });
    if (!request) throw new WorkOrderCommercialError("PARTS_REQUEST_NOT_FOUND", "PartsRequest not found");
    const target = text(toStatus, 40).toUpperCase();
    if (!isPartsStatus(target)) {
      throw new WorkOrderCommercialError("INVALID_PARTS_STATUS", "Unknown PartsRequest status");
    }
    const gates: WorkflowGateState = {
      PARTS_PAYMENT_BEFORE_ORDER: !request.paymentRequired || Boolean(request.paymentConfirmedAt),
    };
    const decision = evaluateWorkflowTransition({ entity: "PARTS_REQUEST", from: request.status, to: target, gates });
    if (!decision.allowed) {
      throw new WorkOrderCommercialError(decision.code, "Перехід PartsRequest заблоковано правилами workflow.", {
        missingGates: decision.missingGates,
        availableTargets: decision.availableTargets,
      });
    }
    if (decision.code === "NOOP") return request;
    if (!isPartsStatus(decision.normalizedTo)) {
      throw new WorkOrderCommercialError("INVALID_PARTS_STATUS", "Workflow returned an unsupported PartsRequest status");
    }
    const normalizedStatus = decision.normalizedTo;
    const now = new Date();
    const updated = await tx.partsRequest.update({
      where: { id: request.id },
      data: {
        status: normalizedStatus,
        selectedAt: normalizedStatus === "SELECTED" ? request.selectedAt ?? now : request.selectedAt,
        approvedAt: normalizedStatus === "APPROVED" ? request.approvedAt ?? now : request.approvedAt,
        orderedAt: normalizedStatus === "ORDERED" ? request.orderedAt ?? now : request.orderedAt,
        receivedAt: normalizedStatus === "RECEIVED" ? request.receivedAt ?? now : request.receivedAt,
        installedAt: normalizedStatus === "INSTALLED" ? request.installedAt ?? now : request.installedAt,
      },
      include: { items: true, estimate: true },
    });
    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "PartsRequest",
        entityId: updated.id,
        action: `STATUS_${request.status}_TO_${updated.status}`,
        before: jsonSafe(request),
        after: jsonSafe(updated),
        metadata: jsonSafe({ workflowCode: decision.code, requiredGates: decision.requiredGates }),
      },
    });
    return updated;
  });
}

export async function updatePartsRequest(
  partsRequestId: string,
  input: { paymentRequired?: boolean; paymentConfirmed?: boolean },
  actorName = "CRM / Підбір запчастин",
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`parts-request:${partsRequestId}`}))`;
    const before = await tx.partsRequest.findUnique({ where: { id: partsRequestId }, include: { items: true, estimate: true } });
    if (!before) throw new WorkOrderCommercialError("PARTS_REQUEST_NOT_FOUND", "PartsRequest not found");
    const after = await tx.partsRequest.update({
      where: { id: partsRequestId },
      data: {
        paymentRequired: typeof input.paymentRequired === "boolean" ? input.paymentRequired : before.paymentRequired,
        paymentConfirmedAt: input.paymentConfirmed === true ? before.paymentConfirmedAt ?? new Date() : input.paymentConfirmed === false ? null : before.paymentConfirmedAt,
      },
      include: { items: true, estimate: true },
    });
    await tx.auditEvent.create({ data: { actorName, entityType: "PartsRequest", entityId: after.id, action: "PARTS_REQUEST_TERMS_UPDATED", before: jsonSafe(before), after: jsonSafe(after) } });
    return after;
  });
}

export async function updatePartsRequestItem(
  partsRequestId: string,
  itemId: string,
  input: Record<string, unknown>,
  actorName = "CRM / Підбір запчастин",
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`parts-request:${partsRequestId}`}))`;
    const before = await tx.partsRequestItem.findFirst({ where: { id: itemId, partsRequestId } });
    if (!before) throw new WorkOrderCommercialError("PARTS_ITEM_NOT_FOUND", "PartsRequest item not found");

    const quantity = before.quantity;
    const received = Object.prototype.hasOwnProperty.call(input, "receivedQuantity") ? decimal(input.receivedQuantity, "receivedQuantity") : before.receivedQuantity;
    const installed = Object.prototype.hasOwnProperty.call(input, "installedQuantity") ? decimal(input.installedQuantity, "installedQuantity") : before.installedQuantity;
    if (received.lessThan(0) || received.greaterThan(quantity)) throw new WorkOrderCommercialError("INVALID_RECEIVED_QUANTITY", "Отримана кількість має бути від 0 до потрібної кількості.");
    if (installed.lessThan(0) || installed.greaterThan(received)) throw new WorkOrderCommercialError("INVALID_INSTALLED_QUANTITY", "Встановлена кількість не може перевищувати отриману.");

    const after = await tx.partsRequestItem.update({
      where: { id: before.id },
      data: {
        receivedQuantity: received,
        installedQuantity: installed,
        supplierId: Object.prototype.hasOwnProperty.call(input, "supplierId") ? text(input.supplierId, 64) || null : before.supplierId,
        supplierQuoteId: Object.prototype.hasOwnProperty.call(input, "supplierQuoteId") ? text(input.supplierQuoteId, 64) || null : before.supplierQuoteId,
        supplierOrderId: Object.prototype.hasOwnProperty.call(input, "supplierOrderId") ? text(input.supplierOrderId, 64) || null : before.supplierOrderId,
        sourcingMode: Object.prototype.hasOwnProperty.call(input, "sourcingMode") ? text(input.sourcingMode, 32) || null : before.sourcingMode,
        etaAt: Object.prototype.hasOwnProperty.call(input, "etaAt") ? (input.etaAt ? new Date(String(input.etaAt)) : null) : before.etaAt,
        note: Object.prototype.hasOwnProperty.call(input, "note") ? text(input.note, 2000) || null : before.note,
      },
    });

    const allItems = await tx.partsRequestItem.findMany({ where: { partsRequestId } });
    const allReceived = allItems.length > 0 && allItems.every((item) => item.receivedQuantity.greaterThanOrEqualTo(item.quantity));
    const anyReceived = allItems.some((item) => item.receivedQuantity.greaterThan(0));
    const allInstalled = allItems.length > 0 && allItems.every((item) => item.installedQuantity.greaterThanOrEqualTo(item.quantity));
    const request = await tx.partsRequest.findUnique({ where: { id: partsRequestId } });
    if (!request) throw new WorkOrderCommercialError("PARTS_REQUEST_NOT_FOUND", "PartsRequest not found");
    if (!isPartsStatus(request.status)) {
      throw new WorkOrderCommercialError("INVALID_PARTS_STATUS", "Stored PartsRequest status is unsupported");
    }
    const derivedStatus: PartsStatus = allInstalled ? "INSTALLED" : allReceived ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : request.status;
    const now = new Date();
    const updatedRequest = derivedStatus !== request.status
      ? await tx.partsRequest.update({
          where: { id: request.id },
          data: {
            status: derivedStatus,
            receivedAt: derivedStatus === "RECEIVED" || derivedStatus === "INSTALLED" ? request.receivedAt ?? now : request.receivedAt,
            installedAt: derivedStatus === "INSTALLED" ? request.installedAt ?? now : request.installedAt,
          },
          include: { items: true, estimate: true },
        })
      : await tx.partsRequest.findUniqueOrThrow({ where: { id: request.id }, include: { items: true, estimate: true } });

    await tx.auditEvent.create({ data: { actorName, entityType: "PartsRequestItem", entityId: after.id, action: "PARTS_ITEM_RECEIPT_UPDATED", before: jsonSafe(before), after: jsonSafe(after), metadata: jsonSafe({ partsRequestId, derivedStatus }) } });
    return { item: after, partsRequest: updatedRequest };
  });
}