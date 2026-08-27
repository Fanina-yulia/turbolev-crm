import { getPrisma } from "@/src/lib/prisma";
import { formatWorkOrderNumber } from "@/src/domain/work-order-number";

export type TimelineKind = "STATUS" | "APPOINTMENT" | "DIAGNOSTIC" | "ESTIMATE" | "PARTS" | "WORK" | "QC" | "PAYMENT" | "FINANCE" | "SYSTEM";

export type TimelineEvent = {
  id: string;
  occurredAt: Date;
  kind: TimelineKind;
  title: string;
  detail?: string | null;
  actor?: string | null;
  workOrderId?: string | null;
  workOrderNumber?: number | null;
  vehicleId?: string | null;
  clientId?: string | null;
  plateNumber?: string | null;
  amount?: number | null;
  currency?: string | null;
};

export type TimelineScope = { workOrderId?: string; vehicleId?: string; clientId?: string };
export type TimelineOptions = { includeCommercial?: boolean; includePayments?: boolean; includeFinance?: boolean; includeActors?: boolean; take?: number };

const STATUS_LABELS: Record<string, string> = {
  PARTS_REVIEW: "Опрацювання",
  WAITING_APPROVAL: "Очікує погодження",
  WAITING_PARTS: "Очікує запчастини",
  READY_FOR_REPAIR: "Готовий до ремонту",
  IN_REPAIR: "У ремонті",
  WAITING_QC: "Очікує контроль якості",
  READY_FOR_PICKUP: "Готовий до видачі",
  WAITING_PAYMENT: "Очікує оплату",
  CLOSED: "Закритий",
  CANCELLED: "Скасований",
};

function numberOf(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}
function statusLabel(value: string) {
  return STATUS_LABELS[value] || value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
function estimateStatusLabel(value: string) {
  return value === "DRAFT" ? "чернетка" : value === "SENT" ? "відправлено клієнту" : value === "APPROVED" ? "погоджено" : value === "REJECTED" ? "відхилено" : value === "SUPERSEDED" ? "замінено новою ревізією" : value.toLowerCase();
}
function qcStatusLabel(value: string) {
  return value === "PASSED" ? "пройдено" : value === "FAILED" ? "не пройдено" : value === "RECHECK" ? "повторна перевірка" : value === "IN_PROGRESS" ? "на перевірці" : value.toLowerCase();
}
function partStatusLabel(value: string) {
  const map: Record<string, string> = {
    NEW: "створено заявку", SELECTING: "підбір", SELECTED: "підібрано", WAITING_APPROVAL: "очікує погодження",
    APPROVED: "погоджено", ORDER_REQUIRED: "до замовлення", ORDERED: "замовлено", PARTIALLY_RECEIVED: "частково отримано",
    RECEIVED: "отримано", INSTALLED: "видано / встановлено", RETURNED: "повернено", CANCELLED: "скасовано",
  };
  return map[value] || value.toLowerCase();
}

export async function getServiceTimeline(scope: TimelineScope, options: TimelineOptions = {}) {
  const prisma = getPrisma();
  const take = Math.min(Math.max(options.take || 120, 20), 300);
  const where = scope.workOrderId
    ? { id: scope.workOrderId }
    : scope.vehicleId
      ? { vehicleId: scope.vehicleId }
      : scope.clientId
        ? { clientId: scope.clientId }
        : { id: "__missing_scope__" };

  const workOrders = await prisma.workOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: scope.workOrderId ? 1 : 50,
    select: { id: true, clientId: true, vehicleId: true, diagnosticRequestId: true, status: true, createdAt: true, updatedAt: true, closedAt: true },
  });
  const workOrderIds = workOrders.map((row) => row.id);
  const workOrderById = new Map(workOrders.map((row) => [row.id, row]));

  const [numbers, vehicles] = await Promise.all([
    workOrderIds.length ? prisma.workOrderNumber.findMany({ where: { workOrderId: { in: workOrderIds } }, select: { workOrderId: true, number: true } }) : [],
    workOrders.length ? prisma.vehicle.findMany({ where: { id: { in: [...new Set(workOrders.map((row) => row.vehicleId))] } }, select: { id: true, plateNumber: true } }) : [],
  ]);
  const numberByWorkOrder = new Map(numbers.map((row) => [row.workOrderId, row.number]));
  const plateByVehicle = new Map(vehicles.map((row) => [row.id, row.plateNumber]));
  const contextFor = (workOrderId: string) => {
    const row = workOrderById.get(workOrderId);
    return {
      workOrderId,
      workOrderNumber: numberByWorkOrder.get(workOrderId) ?? null,
      vehicleId: row?.vehicleId ?? null,
      clientId: row?.clientId ?? null,
      plateNumber: row ? plateByVehicle.get(row.vehicleId) ?? null : null,
    };
  };
  const events: TimelineEvent[] = [];
  const push = (event: TimelineEvent) => {
    if (!event.occurredAt || Number.isNaN(event.occurredAt.getTime())) return;
    events.push(event);
  };

  for (const workOrder of workOrders) {
    const ctx = contextFor(workOrder.id);
    push({ id: `wo-created-${workOrder.id}`, occurredAt: workOrder.createdAt, kind: "STATUS", title: "Комерційна пропозиція створено", detail: formatWorkOrderNumber(ctx.workOrderNumber), ...ctx });
  }

  const diagnosticWhere = scope.workOrderId
    ? { id: { in: workOrders.map((row) => row.diagnosticRequestId) } }
    : scope.vehicleId
      ? { vehicleId: scope.vehicleId }
      : scope.clientId
        ? { clientId: scope.clientId }
        : { id: "__missing_scope__" };
  const diagnostics = await prisma.diagnosticRequest.findMany({
    where: diagnosticWhere,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, clientId: true, vehicleId: true, status: true, technicalConclusion: true, confirmedAt: true, createdAt: true },
  });
  const woByDiagnostic = new Map(workOrders.map((row) => [row.diagnosticRequestId, row.id]));
  for (const diagnostic of diagnostics) {
    const linkedWorkOrderId = woByDiagnostic.get(diagnostic.id) || null;
    const ctx = linkedWorkOrderId ? contextFor(linkedWorkOrderId) : { workOrderId: null, workOrderNumber: null, vehicleId: diagnostic.vehicleId, clientId: diagnostic.clientId, plateNumber: null };
    push({ id: `diag-created-${diagnostic.id}`, occurredAt: diagnostic.createdAt, kind: "DIAGNOSTIC", title: "Діагностику створено", detail: null, ...ctx });
    if (diagnostic.confirmedAt) push({ id: `diag-confirmed-${diagnostic.id}`, occurredAt: diagnostic.confirmedAt, kind: "DIAGNOSTIC", title: "Діагностику підтверджено", detail: diagnostic.technicalConclusion ? diagnostic.technicalConclusion.slice(0, 220) : null, ...ctx });
  }

  const appointmentWhere = scope.workOrderId
    ? { workOrderId: scope.workOrderId }
    : scope.vehicleId
      ? { vehicleId: scope.vehicleId }
      : scope.clientId
        ? { clientId: scope.clientId }
        : { id: "__missing_scope__" };
  const appointments = await prisma.serviceAppointment.findMany({
    where: appointmentWhere,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, workOrderId: true, clientId: true, vehicleId: true, plannedStartAt: true, actualArrivalAt: true, actualStartAt: true, actualEndAt: true, noShowAt: true, createdAt: true },
  });
  for (const appointment of appointments) {
    const ctx = appointment.workOrderId && workOrderById.has(appointment.workOrderId)
      ? contextFor(appointment.workOrderId)
      : { workOrderId: appointment.workOrderId, workOrderNumber: appointment.workOrderId ? numberByWorkOrder.get(appointment.workOrderId) ?? null : null, vehicleId: appointment.vehicleId, clientId: appointment.clientId, plateNumber: appointment.vehicleId ? plateByVehicle.get(appointment.vehicleId) ?? null : null };
    push({ id: `appointment-created-${appointment.id}`, occurredAt: appointment.createdAt, kind: "APPOINTMENT", title: "Запис на СТО створено", detail: `Заплановано: ${appointment.plannedStartAt.toISOString()}`, ...ctx });
    if (appointment.actualArrivalAt) push({ id: `appointment-arrival-${appointment.id}`, occurredAt: appointment.actualArrivalAt, kind: "APPOINTMENT", title: "Автомобіль прибув на СТО", ...ctx });
    if (appointment.actualStartAt) push({ id: `appointment-start-${appointment.id}`, occurredAt: appointment.actualStartAt, kind: "WORK", title: "Роботу з автомобілем розпочато", ...ctx });
    if (appointment.actualEndAt) push({ id: `appointment-end-${appointment.id}`, occurredAt: appointment.actualEndAt, kind: "WORK", title: "Роботу з автомобілем завершено", ...ctx });
    if (appointment.noShowAt) push({ id: `appointment-noshow-${appointment.id}`, occurredAt: appointment.noShowAt, kind: "APPOINTMENT", title: "Клієнт не приїхав на запис", ...ctx });
  }

  if (workOrderIds.length && options.includeCommercial !== false) {
    const [estimates, partsRequests, lines, qcRows] = await Promise.all([
      prisma.workOrderEstimate.findMany({ where: { workOrderId: { in: workOrderIds } }, orderBy: [{ workOrderId: "asc" }, { revision: "asc" }], select: { id: true, workOrderId: true, revision: true, status: true, totalAmount: true, sentAt: true, approvedAt: true, rejectedAt: true, approvedByName: true, approvalNote: true, supersededAt: true, createdAt: true } }),
      prisma.partsRequest.findMany({ where: { workOrderId: { in: workOrderIds } }, select: { id: true, workOrderId: true, status: true, paymentConfirmedAt: true, selectedAt: true, approvedAt: true, orderedAt: true, receivedAt: true, installedAt: true, createdAt: true } }),
      prisma.workOrderLine.findMany({ where: { workOrderId: { in: workOrderIds } }, select: { id: true, workOrderId: true, type: true, description: true, mechanicId: true, approvedAt: true, startedAt: true, completedAt: true, cancelledAt: true, createdAt: true } }),
      prisma.workOrderQualityControl.findMany({ where: { workOrderId: { in: workOrderIds } }, select: { id: true, workOrderId: true, attempt: true, status: true, resultNote: true, performedByName: true, startedAt: true, completedAt: true, createdAt: true } }),
    ]);
    for (const estimate of estimates) {
      const ctx = contextFor(estimate.workOrderId);
      push({ id: `estimate-created-${estimate.id}`, occurredAt: estimate.createdAt, kind: "ESTIMATE", title: `Кошторис №${estimate.revision} створено`, detail: `${numberOf(estimate.totalAmount).toLocaleString("uk-UA")} ₴ · ${estimateStatusLabel(estimate.status)}`, ...ctx });
      if (estimate.sentAt) push({ id: `estimate-sent-${estimate.id}`, occurredAt: estimate.sentAt, kind: "ESTIMATE", title: `Кошторис №${estimate.revision} відправлено клієнту`, detail: `${numberOf(estimate.totalAmount).toLocaleString("uk-UA")} ₴`, ...ctx });
      if (estimate.approvedAt) push({ id: `estimate-approved-${estimate.id}`, occurredAt: estimate.approvedAt, kind: "ESTIMATE", title: `Кошторис №${estimate.revision} погоджено`, detail: [estimate.approvedByName, estimate.approvalNote].filter(Boolean).join(" · ") || null, actor: estimate.approvedByName, ...ctx });
      if (estimate.rejectedAt) push({ id: `estimate-rejected-${estimate.id}`, occurredAt: estimate.rejectedAt, kind: "ESTIMATE", title: `Кошторис №${estimate.revision} відхилено`, detail: estimate.approvalNote || null, ...ctx });
      if (estimate.supersededAt) push({ id: `estimate-superseded-${estimate.id}`, occurredAt: estimate.supersededAt, kind: "ESTIMATE", title: `Кошторис №${estimate.revision} замінено новою ревізією`, ...ctx });
    }
    for (const request of partsRequests) {
      const ctx = contextFor(request.workOrderId);
      push({ id: `parts-created-${request.id}`, occurredAt: request.createdAt, kind: "PARTS", title: "Заявку на запчастини створено", detail: partStatusLabel(request.status), ...ctx });
      if (request.selectedAt) push({ id: `parts-selected-${request.id}`, occurredAt: request.selectedAt, kind: "PARTS", title: "Запчастини підібрано", ...ctx });
      if (request.paymentConfirmedAt) push({ id: `parts-payment-${request.id}`, occurredAt: request.paymentConfirmedAt, kind: "PARTS", title: "Передоплату за запчастини підтверджено", ...ctx });
      if (request.approvedAt) push({ id: `parts-approved-${request.id}`, occurredAt: request.approvedAt, kind: "PARTS", title: "Запчастини погоджено", ...ctx });
      if (request.orderedAt) push({ id: `parts-ordered-${request.id}`, occurredAt: request.orderedAt, kind: "PARTS", title: "Запчастини замовлено", ...ctx });
      if (request.receivedAt) push({ id: `parts-received-${request.id}`, occurredAt: request.receivedAt, kind: "PARTS", title: "Запчастини отримано", ...ctx });
      if (request.installedAt) push({ id: `parts-installed-${request.id}`, occurredAt: request.installedAt, kind: "PARTS", title: "Запчастини видано / встановлено", ...ctx });
    }
    for (const line of lines) {
      const ctx = contextFor(line.workOrderId);
      const label = line.description.length > 120 ? `${line.description.slice(0, 117)}…` : line.description;
      if (line.approvedAt) push({ id: `line-approved-${line.id}`, occurredAt: line.approvedAt, kind: "WORK", title: line.type === "LABOR" ? "Роботу погоджено" : "Позицію погоджено", detail: label, ...ctx });
      if (line.startedAt) push({ id: `line-started-${line.id}`, occurredAt: line.startedAt, kind: "WORK", title: "Роботу розпочато", detail: label, ...ctx });
      if (line.completedAt) push({ id: `line-completed-${line.id}`, occurredAt: line.completedAt, kind: "WORK", title: "Роботу завершено", detail: label, ...ctx });
      if (line.cancelledAt) push({ id: `line-cancelled-${line.id}`, occurredAt: line.cancelledAt, kind: "WORK", title: "Позицію скасовано", detail: label, ...ctx });
    }
    for (const qc of qcRows) {
      const ctx = contextFor(qc.workOrderId);
      push({ id: `qc-created-${qc.id}`, occurredAt: qc.createdAt, kind: "QC", title: `QC #${qc.attempt} створено`, detail: qcStatusLabel(qc.status), ...ctx });
      if (qc.startedAt) push({ id: `qc-start-${qc.id}`, occurredAt: qc.startedAt, kind: "QC", title: `Контроль якості #${qc.attempt} розпочато`, actor: qc.performedByName, ...ctx });
      if (qc.completedAt) push({ id: `qc-complete-${qc.id}`, occurredAt: qc.completedAt, kind: "QC", title: `Контроль якості #${qc.attempt}: ${qcStatusLabel(qc.status)}`, detail: qc.resultNote || null, actor: qc.performedByName, ...ctx });
    }
  }

  if (workOrderIds.length && options.includePayments) {
    const payments = await prisma.cashTransaction.findMany({
      where: { workOrderId: { in: workOrderIds }, status: "POSTED", sourceEntity: "WORK_ORDER_PAYMENT" },
      orderBy: { occurredAt: "asc" },
      select: { id: true, workOrderId: true, amount: true, currency: true, occurredAt: true, description: true },
    });
    for (const payment of payments) {
      if (!payment.workOrderId) continue;
      push({ id: `payment-${payment.id}`, occurredAt: payment.occurredAt, kind: "PAYMENT", title: "Оплату клієнта зафіксовано", detail: payment.description || null, amount: numberOf(payment.amount), currency: payment.currency, ...contextFor(payment.workOrderId) });
    }
  }

  if (workOrderIds.length && options.includeFinance) {
    const snapshots = await prisma.workOrderFinanceSnapshot.findMany({
      where: { workOrderId: { in: workOrderIds }, kind: "ACTUAL" },
      select: { id: true, workOrderId: true, grossRevenue: true, grossProfit: true, grossMarginPercent: true, calculatedAt: true, lockedAt: true },
    });
    for (const snapshot of snapshots) {
      const at = snapshot.lockedAt || snapshot.calculatedAt;
      push({ id: `finance-${snapshot.id}`, occurredAt: at, kind: "FINANCE", title: "Фінанси ЗН фіналізовано", detail: `Виручка ${numberOf(snapshot.grossRevenue).toLocaleString("uk-UA")} ₴ · валовий прибуток ${numberOf(snapshot.grossProfit).toLocaleString("uk-UA")} ₴ · маржа ${numberOf(snapshot.grossMarginPercent).toLocaleString("uk-UA")}%`, ...contextFor(snapshot.workOrderId) });
    }
  }

  if (workOrderIds.length) {
    const audits = await prisma.auditEvent.findMany({
      where: { entityType: "WorkOrder", entityId: { in: workOrderIds }, action: { startsWith: "STATUS_" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, entityId: true, action: true, actorName: true, createdAt: true },
    });
    const auditClosed = new Set<string>();
    for (const audit of audits) {
      const match = audit.action.match(/^STATUS_(.+)_TO_(.+)$/);
      if (!match) continue;
      const from = match[1];
      const to = match[2];
      if (to === "CLOSED") auditClosed.add(audit.entityId);
      push({ id: `audit-${audit.id}`, occurredAt: audit.createdAt, kind: "STATUS", title: `Статус ЗН → ${statusLabel(to)}`, detail: `${statusLabel(from)} → ${statusLabel(to)}`, actor: options.includeActors ? audit.actorName : null, ...contextFor(audit.entityId) });
    }
    for (const workOrder of workOrders) {
      if (workOrder.closedAt && !auditClosed.has(workOrder.id)) push({ id: `wo-closed-${workOrder.id}`, occurredAt: workOrder.closedAt, kind: "STATUS", title: "Комерційна пропозиція закрито", ...contextFor(workOrder.id) });
    }
  }

  const unique = new Map<string, TimelineEvent>();
  for (const event of events) unique.set(event.id, event);
  return [...unique.values()].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, take);
}
