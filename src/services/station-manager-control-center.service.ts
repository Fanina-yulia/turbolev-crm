import "server-only";

import { InquiryState, WorkOrderEstimateStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { listStationAttentionVehicles, type StationAttentionVehicle } from "@/src/services/station-vehicle-attention.service";

const MINUTE_MS = 60_000;

export type StationManagerControlPriority = "CRITICAL" | "HIGH" | "NORMAL";

export type StationManagerControlAction = {
  label: string;
  section: string;
  params?: Record<string, string>;
};

export type StationManagerControlSignal = {
  id: string;
  sourceType: "INQUIRY" | "APPOINTMENT" | "ESTIMATE";
  sourceId: string;
  code: string;
  title: string;
  description: string | null;
  priority: StationManagerControlPriority;
  reason: string;
  overdue: boolean;
  waitingMinutes: number;
  plate: string | null;
  vehicle: string | null;
  customer: string | null;
  action: StationManagerControlAction;
};

export type StationManagerControlCenter = {
  kpis: {
    missedCalls: number;
    newInquiries: number;
    stuckCars: number;
    proposalsNotSent: number;
    waitingCustomerDecision: number;
    partsBlocking: number;
    unpaidWorks: number;
  };
  attention: StationManagerControlSignal[];
};

type StationInquiry = {
  id: string;
  channel: string;
  subject: string;
  preview: string;
  phone: string | null;
  vehicle: string | null;
  plate: string | null;
  name: string | null;
  receivedAt: Date;
  answered: boolean;
  assignedUserId: string | null;
  leadId: string | null;
  metadata: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function ageMinutes(anchor: Date, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / MINUTE_MS));
}

function formatMoney(value: unknown, currency: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(amount)} ${currency}`;
}

function isMissedCall(row: StationInquiry) {
  const metadata = record(row.metadata);
  const callStatus = text(metadata.callStatus)?.toUpperCase();
  if (callStatus === "MISSED" || callStatus === "BUSY" || metadata.missedCall === true) return true;
  if (row.channel !== "BINOTEL") return false;
  if (row.answered === false) return true;
  const copy = `${row.subject} ${row.preview}`.toLocaleLowerCase("uk-UA");
  return copy.includes("пропущ") || copy.includes("не з'єдна") || copy.includes("не з’єдна");
}

function priorityRank(priority: StationManagerControlPriority) {
  return priority === "CRITICAL" ? 0 : priority === "HIGH" ? 1 : 2;
}

function vehicleAction(row: StationAttentionVehicle): StationManagerControlAction {
  const primaryCode = row.issues[0]?.code || "VEHICLE_ATTENTION";
  if (primaryCode === "DIAGNOSTIC_REVIEW_PENDING" && row.diagnosticRequestId) {
    return { label: "Перевірити ДК", section: "Діагностика", params: { diagnosticId: row.diagnosticRequestId, filter: "SUBMITTED" } };
  }
  if (["NO_SHOW", "MISSED_ARRIVAL"].includes(primaryCode)) {
    return { label: "Відкрити запис", section: "Планувальник", params: { appointmentId: row.appointmentId } };
  }
  if (["PARTS_SELECTION_STALLED", "PARTS_ETA_OVERDUE", "PARTS_ETA_MISSING"].includes(primaryCode)) {
    return row.workOrderId
      ? { label: "Відкрити запчастини", section: "Комерційна пропозиція", params: { workOrderId: row.workOrderId, workOrderTab: "parts" } }
      : { label: "Відкрити запис", section: "Планувальник", params: { appointmentId: row.appointmentId } };
  }
  if (["CALCULATION_STALLED", "APPROVAL_STALLED"].includes(primaryCode) && row.workOrderId) {
    return { label: "Відкрити кошторис", section: "Комерційна пропозиція", params: { workOrderId: row.workOrderId, workOrderTab: "estimate" } };
  }
  if (primaryCode === "QC_STALLED" && row.workOrderId) {
    return { label: "Відкрити QC", section: "Комерційна пропозиція", params: { workOrderId: row.workOrderId, workOrderTab: "qc" } };
  }
  if (primaryCode === "PAYMENT_STALLED" && row.workOrderId) {
    return { label: "Відкрити оплату", section: "Комерційна пропозиція", params: { workOrderId: row.workOrderId, workOrderTab: "payment" } };
  }
  if (primaryCode === "WARRANTY_OPEN" && row.workOrderId) {
    return { label: "Відкрити гарантію", section: "Комерційна пропозиція", params: { workOrderId: row.workOrderId, workOrderTab: "history" } };
  }
  if (row.workOrderId) {
    return { label: "Відкрити КП", section: "Комерційна пропозиція", params: { workOrderId: row.workOrderId, workOrderTab: "overview" } };
  }
  return { label: "Відкрити запис", section: "Планувальник", params: { appointmentId: row.appointmentId } };
}

const STUCK_CODES = new Set([
  "ARRIVED_STALLED",
  "DIAGNOSTIC_REVIEW_PENDING",
  "PARTS_SELECTION_STALLED",
  "CALCULATION_STALLED",
  "APPROVAL_STALLED",
  "PARTS_ETA_OVERDUE",
  "PARTS_ETA_MISSING",
  "READY_FOR_REPAIR_STALLED",
  "REPAIR_OVERRUN",
  "QC_STALLED",
  "PICKUP_STALLED",
  "PAUSED_STALLED",
  "PLAN_OVERRUN",
]);

function vehicleSignal(row: StationAttentionVehicle, now: Date): StationManagerControlSignal {
  const issue = row.issues[0];
  const dueAt = issue ? new Date(issue.dueAt) : new Date(row.attentionAt);
  return {
    id: `vehicle:${row.appointmentId}:${issue?.code || "attention"}`,
    sourceType: "APPOINTMENT",
    sourceId: row.appointmentId,
    code: issue?.code || "VEHICLE_ATTENTION",
    title: issue?.title || row.attentionTitle,
    description: row.problem,
    priority: row.attentionLevel === "MEDIUM" ? "NORMAL" : row.attentionLevel,
    reason: issue?.reason || row.attentionReason,
    overdue: dueAt.getTime() <= now.getTime(),
    waitingMinutes: ageMinutes(dueAt, now),
    plate: row.plate,
    vehicle: row.vehicle,
    customer: null,
    action: vehicleAction(row),
  };
}

async function stationInquiries(locationId: string): Promise<StationInquiry[]> {
  const prisma = getPrisma();
  const now = new Date();
  const [activeLocationCount, stationLinks, stationUsers, inquiries] = await Promise.all([
    prisma.serviceLocation.count({ where: { isActive: true } }),
    prisma.serviceAppointment.findMany({
      where: { locationId, OR: [{ leadId: { not: null } }, { workOrderId: { not: null } }] },
      select: { leadId: true, workOrderId: true },
      take: 5000,
    }),
    prisma.userAccessRole.findMany({
      where: {
        locationId,
        isActive: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      select: { userId: true },
      take: 500,
    }),
    prisma.communicationInquiry.findMany({
      where: { state: InquiryState.NEW },
      select: {
        id: true,
        channel: true,
        subject: true,
        preview: true,
        phone: true,
        vehicle: true,
        plate: true,
        name: true,
        receivedAt: true,
        answered: true,
        assignedUserId: true,
        leadId: true,
        metadata: true,
      },
      orderBy: { receivedAt: "asc" },
      take: 250,
    }),
  ]);

  if (activeLocationCount <= 1) return inquiries;

  const stationLeadIds = new Set(stationLinks.map((row) => row.leadId).filter((id): id is string => Boolean(id)));
  const stationWorkOrderIds = new Set(stationLinks.map((row) => row.workOrderId).filter((id): id is string => Boolean(id)));
  const stationUserIds = new Set(stationUsers.map((row) => row.userId));

  return inquiries.filter((row) => {
    if (row.assignedUserId && stationUserIds.has(row.assignedUserId)) return true;
    if (row.leadId && stationLeadIds.has(row.leadId)) return true;
    const metadataWorkOrderId = text(record(row.metadata).workOrderId);
    return Boolean(metadataWorkOrderId && stationWorkOrderIds.has(metadataWorkOrderId));
  });
}

export async function buildStationManagerControlCenter(input: {
  locationId: string;
  canCommunications: boolean;
  canWorkOrders: boolean;
}): Promise<StationManagerControlCenter> {
  const prisma = getPrisma();
  const now = new Date();

  const [vehicleAttention, inquiries, workOrderAppointments] = await Promise.all([
    listStationAttentionVehicles(now, input.locationId),
    input.canCommunications ? stationInquiries(input.locationId) : Promise.resolve([]),
    input.canWorkOrders
      ? prisma.serviceAppointment.findMany({
          where: {
            locationId: input.locationId,
            workOrderId: { not: null },
            status: { notIn: ["COMPLETED", "CANCELLED", "RESERVE"] },
          },
          select: {
            id: true,
            workOrderId: true,
            status: true,
            plateNumber: true,
            vehicleLabel: true,
            customerName: true,
            problem: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: "desc" },
          take: 500,
        })
      : Promise.resolve([]),
  ]);

  const appointmentByWorkOrder = new Map<string, (typeof workOrderAppointments)[number]>();
  for (const row of workOrderAppointments) {
    if (row.workOrderId && !appointmentByWorkOrder.has(row.workOrderId)) appointmentByWorkOrder.set(row.workOrderId, row);
  }
  const workOrderIds = [...appointmentByWorkOrder.keys()];
  const estimates = workOrderIds.length
    ? await prisma.workOrderEstimate.findMany({
        where: { workOrderId: { in: workOrderIds } },
        select: {
          id: true,
          workOrderId: true,
          revision: true,
          status: true,
          currency: true,
          totalAmount: true,
          sentAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ workOrderId: "asc" }, { revision: "desc" }],
        take: Math.min(1500, workOrderIds.length * 6),
      })
    : [];

  const latestEstimate = new Map<string, (typeof estimates)[number]>();
  for (const estimate of estimates) {
    if (!latestEstimate.has(estimate.workOrderId)) latestEstimate.set(estimate.workOrderId, estimate);
  }

  const draftEstimates = [...latestEstimate.values()].filter((row) =>
    row.status === WorkOrderEstimateStatus.DRAFT
    && Number(row.totalAmount) > 0
    && row.createdAt.getTime() + 60 * MINUTE_MS <= now.getTime()
  );
  const sentEstimates = [...latestEstimate.values()].filter((row) => row.status === WorkOrderEstimateStatus.SENT);

  const signals: StationManagerControlSignal[] = [];
  for (const row of inquiries) {
    if (isMissedCall(row)) continue;
    const age = ageMinutes(row.receivedAt, now);
    const dueAt = new Date(row.receivedAt.getTime() + 15 * MINUTE_MS);
    signals.push({
      id: `inquiry:${row.id}`,
      sourceType: "INQUIRY",
      sourceId: row.id,
      code: "NEW_INQUIRY",
      title: "Нове звернення без опрацювання",
      description: [row.subject, row.preview].filter(Boolean).join(" · ").slice(0, 360) || null,
      priority: age >= 60 ? "CRITICAL" : age >= 15 ? "HIGH" : "NORMAL",
      reason: "Звернення ще не взяте в роботу. Норматив першої реакції — до 15 хв.",
      overdue: dueAt <= now,
      waitingMinutes: age,
      plate: row.plate,
      vehicle: row.vehicle,
      customer: row.name || row.phone,
      action: { label: "Відкрити звернення", section: "Нові звернення", params: { inquiryId: row.id } },
    });
  }

  const commercialWorkOrderIds = new Set<string>();
  for (const estimate of draftEstimates) {
    const appointment = appointmentByWorkOrder.get(estimate.workOrderId);
    if (!appointment) continue;
    commercialWorkOrderIds.add(estimate.workOrderId);
    const age = ageMinutes(estimate.createdAt, now);
    const dueAt = new Date(estimate.createdAt.getTime() + 60 * MINUTE_MS);
    const label = appointment.plateNumber || appointment.vehicleLabel || appointment.customerName || "Авто";
    const amount = formatMoney(estimate.totalAmount, estimate.currency);
    signals.push({
      id: `estimate:${estimate.id}:not-sent`,
      sourceType: "ESTIMATE",
      sourceId: estimate.id,
      code: "COMMERCIAL_PROPOSAL_NOT_SENT",
      title: `${label}: комерційна пропозиція не відправлена`,
      description: [appointment.problem, amount ? `Сума: ${amount}` : null].filter(Boolean).join(" · ") || null,
      priority: age >= 4 * 60 ? "CRITICAL" : "HIGH",
      reason: "Остання ревізія кошторису залишається DRAFT. Клієнт ще не отримав комерційну пропозицію.",
      overdue: dueAt <= now,
      waitingMinutes: age,
      plate: appointment.plateNumber,
      vehicle: appointment.vehicleLabel,
      customer: appointment.customerName,
      action: { label: "Відкрити кошторис", section: "Комерційна пропозиція", params: { workOrderId: estimate.workOrderId, workOrderTab: "estimate" } },
    });
  }

  for (const estimate of sentEstimates) {
    const appointment = appointmentByWorkOrder.get(estimate.workOrderId);
    if (!appointment) continue;
    commercialWorkOrderIds.add(estimate.workOrderId);
    const anchor = estimate.sentAt || estimate.updatedAt;
    const age = ageMinutes(anchor, now);
    const dueAt = new Date(anchor.getTime() + 60 * MINUTE_MS);
    const label = appointment.plateNumber || appointment.vehicleLabel || appointment.customerName || "Авто";
    signals.push({
      id: `estimate:${estimate.id}:waiting-decision`,
      sourceType: "ESTIMATE",
      sourceId: estimate.id,
      code: "CUSTOMER_DECISION_WAIT",
      title: `${label}: очікуємо рішення клієнта`,
      description: appointment.problem,
      priority: age >= 4 * 60 ? "CRITICAL" : age >= 60 ? "HIGH" : "NORMAL",
      reason: "Комерційна пропозиція відправлена, але в останній ревізії ще немає погодження або відмови клієнта.",
      overdue: dueAt <= now,
      waitingMinutes: age,
      plate: appointment.plateNumber,
      vehicle: appointment.vehicleLabel,
      customer: appointment.customerName,
      action: { label: "Відкрити погодження", section: "Комерційна пропозиція", params: { workOrderId: estimate.workOrderId, workOrderTab: "estimate" } },
    });
  }

  for (const row of vehicleAttention) {
    const primaryCode = row.issues[0]?.code || "VEHICLE_ATTENTION";
    if (commercialWorkOrderIds.has(row.workOrderId || "") && ["CALCULATION_STALLED", "APPROVAL_STALLED"].includes(primaryCode)) continue;
    signals.push(vehicleSignal(row, now));
  }

  signals.sort((a, b) => {
    const priority = priorityRank(a.priority) - priorityRank(b.priority);
    if (priority) return priority;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return b.waitingMinutes - a.waitingMinutes;
  });

  return {
    kpis: {
      missedCalls: inquiries.filter(isMissedCall).length,
      newInquiries: inquiries.filter((row) => !isMissedCall(row)).length,
      stuckCars: vehicleAttention.filter((row) => row.issues.some((issue) => STUCK_CODES.has(issue.code))).length,
      proposalsNotSent: draftEstimates.length,
      waitingCustomerDecision: sentEstimates.length,
      partsBlocking: vehicleAttention.filter((row) => row.issues.some((issue) => ["PARTS_SELECTION_STALLED", "PARTS_ETA_OVERDUE", "PARTS_ETA_MISSING"].includes(issue.code))).length,
      unpaidWorks: vehicleAttention.filter((row) => row.issues.some((issue) => issue.code === "PAYMENT_STALLED")).length,
    },
    attention: signals.slice(0, 40),
  };
}
