import { randomUUID } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import {
  DiagnosticReportError,
  getDiagnosticReportByToken,
  type DiagnosticReportSnapshot,
} from "@/src/services/diagnostic-report.service";
import {
  decideEstimate,
  WorkOrderCommercialError,
} from "@/src/services/work-order-commercial.service";
import { normalizeApprovedEstimateFingerprint } from "@/src/services/work-order-estimate-fingerprint.service";

export class ClientPortalError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ClientPortalError";
    this.code = code;
    this.status = status;
  }
}

export type ClientPortalMessage = {
  id: string;
  direction: "IN" | "OUT" | "SYSTEM";
  text: string;
  sentAt: string;
};

export type ClientPortalEstimateLine = {
  id: string;
  type: string;
  description: string;
  article: string | null;
  brand: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  discount: number;
  total: number;
};

export type ClientPortalSnapshot = {
  share: {
    id: string;
    diagnosticRequestId: string;
    expiresAt: string | null;
    requestedPricingAt: string | null;
  };
  report: DiagnosticReportSnapshot;
  client: {
    id: string;
    name: string | null;
  };
  vehicle: {
    id: string;
    label: string;
    plateNumber: string | null;
    vin: string | null;
    year: number | null;
    mileageKm: number | null;
  };
  service: {
    workOrderId: string | null;
    workOrderStatus: string | null;
    appointmentStatus: string | null;
    statusCode: string;
    statusLabel: string;
    stageIndex: number;
    stages: Array<{
      key: string;
      label: string;
      state: "DONE" | "CURRENT" | "NEXT";
    }>;
    stationName: string | null;
    postName: string | null;
    mechanicName: string | null;
    plannedStartAt: string | null;
    plannedEndAt: string | null;
    actualArrivalAt: string | null;
    actualStartAt: string | null;
    actualEndAt: string | null;
    partsEtaAt: string | null;
  };
  estimate: null | {
    id: string;
    revision: number;
    status: string;
    currency: string;
    subtotal: number;
    discountAmount: number;
    totalAmount: number;
    laborTotal: number;
    partsTotal: number;
    sentAt: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
    approvedByName: string | null;
    lines: ClientPortalEstimateLine[];
  };
  action: null | {
    kind: "ESTIMATE_DECISION" | "PRICING_PENDING";
    title: string;
    description: string;
  };
  documents: Array<{
    key: string;
    title: string;
    subtitle: string;
    status: string;
  }>;
  chat: {
    inquiryId: string | null;
    messages: ClientPortalMessage[];
  };
};

type PortalContext = Awaited<ReturnType<typeof loadPortalContext>>;

const STAGES = [
  { key: "BOOKED", label: "Запис" },
  { key: "ARRIVED", label: "Авто на СТО" },
  { key: "DIAGNOSTICS", label: "Діагностика" },
  { key: "APPROVAL", label: "Погодження" },
  { key: "PARTS", label: "Запчастини" },
  { key: "REPAIR", label: "Ремонт" },
  { key: "QC", label: "Контроль" },
  { key: "PAYMENT", label: "Оплата" },
  { key: "READY", label: "Готово" },
  { key: "COMPLETED", label: "Видано" },
] as const;

const STATUS_LABELS: Record<string, string> = {
  BOOKED: "Заплановано",
  ARRIVED: "Автомобіль на СТО",
  DIAGNOSTICS: "Діагностика",
  PARTS_REVIEW: "Формуємо кошторис",
  WAITING_CALCULATION: "Розраховуємо вартість",
  WAITING_APPROVAL: "Очікуємо вашого погодження",
  WAITING_PARTS_SELECTION: "Підбираємо запчастини",
  WAITING_PARTS: "Очікуємо запчастини",
  READY_FOR_REPAIR: "Готово до ремонту",
  IN_REPAIR: "Автомобіль у ремонті",
  PAUSED: "Роботу призупинено",
  REWORK: "Доопрацювання",
  WAITING_QC: "Контроль якості",
  WAITING_PAYMENT: "Очікуємо оплату",
  READY_FOR_PICKUP: "Автомобіль готовий до видачі",
  COMPLETED: "Автомобіль видано",
  WARRANTY: "Гарантійне звернення",
  NO_SHOW: "Візит не відбувся",
  CANCELLED: "Запис скасовано",
};

function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function normalizePlate(value?: string | null) {
  return (value || "").toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/g, "");
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function jsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function estimateLines(value: unknown): ClientPortalEstimateLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const item = jsonObject(raw);
    const quantity = numberValue(item.plannedQuantity);
    const unitPrice = numberValue(item.plannedUnitPrice);
    const discount = numberValue(item.plannedDiscount);
    return {
      id: typeof item.id === "string" ? item.id : `line-${index}`,
      type: typeof item.type === "string" ? item.type : "OTHER",
      description: typeof item.description === "string" ? item.description : "Робота / матеріал",
      article: typeof item.article === "string" ? item.article : null,
      brand: typeof item.brand === "string" ? item.brand : null,
      quantity,
      unit: typeof item.unit === "string" ? item.unit : "шт",
      unitPrice,
      discount,
      total: Math.max(0, Math.round((quantity * unitPrice - discount) * 100) / 100),
    };
  });
}

function stageForStatus(status: string) {
  if (status === "BOOKED") return 0;
  if (status === "ARRIVED") return 1;
  if (status === "DIAGNOSTICS") return 2;
  if (["PARTS_REVIEW", "WAITING_CALCULATION", "WAITING_APPROVAL"].includes(status)) return 3;
  if (["WAITING_PARTS_SELECTION", "WAITING_PARTS"].includes(status)) return 4;
  if (["READY_FOR_REPAIR", "IN_REPAIR", "PAUSED", "REWORK", "WARRANTY"].includes(status)) return 5;
  if (status === "WAITING_QC") return 6;
  if (status === "WAITING_PAYMENT") return 7;
  if (status === "READY_FOR_PICKUP") return 8;
  if (status === "COMPLETED") return 9;
  return 2;
}

function stageState(index: number, current: number) {
  if (index < current) return "DONE" as const;
  if (index === current) return "CURRENT" as const;
  return "NEXT" as const;
}

function portalThreadId(shareId: string) {
  return `client-portal:${shareId}`;
}

async function loadPortalContext(token: string) {
  const report = await getDiagnosticReportByToken(token);
  const prisma = getPrisma();
  const diagnostic = await prisma.diagnosticRequest.findUnique({
    where: { id: report.diagnosticRequestId },
    select: {
      id: true,
      status: true,
      clientId: true,
      vehicleId: true,
      client: {
        select: {
          id: true,
          name: true,
          phone: true,
          phoneNormalized: true,
        },
      },
      vehicle: {
        select: {
          id: true,
          brand: true,
          model: true,
          plateNumber: true,
          plateNormalized: true,
          vin: true,
          year: true,
          mileageKm: true,
        },
      },
      workOrder: {
        select: {
          id: true,
          status: true,
          closedAt: true,
          updatedAt: true,
          estimates: {
            orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: {
              id: true,
              revision: true,
              status: true,
              currency: true,
              lineSnapshot: true,
              subtotal: true,
              discountAmount: true,
              totalAmount: true,
              laborTotal: true,
              partsTotal: true,
              sentAt: true,
              approvedAt: true,
              rejectedAt: true,
              approvedByName: true,
            },
          },
        },
      },
    },
  });
  if (!diagnostic) {
    throw new ClientPortalError("PORTAL_CASE_NOT_FOUND", "Сервісний випадок не знайдено.", 404);
  }

  const appointmentWhere = diagnostic.workOrder?.id
    ? { workOrderId: diagnostic.workOrder.id }
    : { clientId: diagnostic.clientId, vehicleId: diagnostic.vehicleId };
  const appointment = await prisma.serviceAppointment.findFirst({
    where: appointmentWhere,
    orderBy: [{ actualArrivalAt: "desc" }, { plannedStartAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      plannedStartAt: true,
      plannedEndAt: true,
      actualArrivalAt: true,
      actualStartAt: true,
      actualEndAt: true,
      partsEtaAt: true,
      location: { select: { name: true } },
      post: { select: { name: true } },
      mechanic: { select: { name: true } },
    },
  });

  return { report, diagnostic, appointment };
}

async function findPortalInquiry(shareId: string) {
  return getPrisma().communicationInquiry.findFirst({
    where: {
      channel: "WEBSITE",
      externalThreadId: portalThreadId(shareId),
    },
    orderBy: { createdAt: "desc" },
  });
}

async function ensurePortalInquiry(context: PortalContext, preview: string) {
  const existing = await findPortalInquiry(context.report.id);
  if (existing) return existing;

  const prisma = getPrisma();
  const now = new Date();
  const label = [context.diagnostic.vehicle.brand, context.diagnostic.vehicle.model]
    .filter(Boolean)
    .join(" ") || context.report.snapshot.vehicle.label;
  const threadId = portalThreadId(context.report.id);
  return prisma.communicationInquiry.create({
    data: {
      id: makeId("inq"),
      externalId: threadId,
      channel: "WEBSITE",
      state: "NEW",
      name: context.diagnostic.client.name,
      phone: context.diagnostic.client.phone,
      phoneNormalized: context.diagnostic.client.phoneNormalized,
      subject: `Особистий кабінет · ${label}`,
      preview: preview.slice(0, 500),
      vehicle: label,
      plate: context.diagnostic.vehicle.plateNumber,
      plateNormalized: context.diagnostic.vehicle.plateNormalized || normalizePlate(context.diagnostic.vehicle.plateNumber),
      unread: true,
      answered: false,
      receivedAt: now,
      sourceDetail: "Особистий кабінет Turbo LEV",
      externalThreadId: threadId,
      externalParticipantId: context.diagnostic.client.id,
      lastInboundAt: now,
      metadata: toPrismaJson({
        source: "CLIENT_PORTAL",
        reportShareId: context.report.id,
        diagnosticRequestId: context.report.diagnosticRequestId,
        clientId: context.diagnostic.client.id,
        vehicleId: context.diagnostic.vehicle.id,
        workOrderId: context.diagnostic.workOrder?.id || null,
      }),
    },
  });
}

async function listPortalMessagesByShareId(shareId: string): Promise<{ inquiryId: string | null; messages: ClientPortalMessage[] }> {
  const inquiry = await findPortalInquiry(shareId);
  if (!inquiry) return { inquiryId: null, messages: [] };
  const rows = await getPrisma().communicationMessage.findMany({
    where: { inquiryId: inquiry.id },
    orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: { id: true, direction: true, text: true, sentAt: true },
  });
  return {
    inquiryId: inquiry.id,
    messages: rows.reverse().map((item) => ({
      id: item.id,
      direction: item.direction,
      text: item.text,
      sentAt: item.sentAt.toISOString(),
    })),
  };
}

function serializeEstimate(estimate: PortalContext["diagnostic"]["workOrder"] extends infer W
  ? W extends { estimates: infer E }
    ? E extends Array<infer I> ? I | null : null
    : null
  : null) {
  if (!estimate) return null;
  return {
    id: estimate.id,
    revision: estimate.revision,
    status: estimate.status,
    currency: estimate.currency,
    subtotal: numberValue(estimate.subtotal),
    discountAmount: numberValue(estimate.discountAmount),
    totalAmount: numberValue(estimate.totalAmount),
    laborTotal: numberValue(estimate.laborTotal),
    partsTotal: numberValue(estimate.partsTotal),
    sentAt: estimate.sentAt?.toISOString() || null,
    approvedAt: estimate.approvedAt?.toISOString() || null,
    rejectedAt: estimate.rejectedAt?.toISOString() || null,
    approvedByName: estimate.approvedByName,
    lines: estimateLines(estimate.lineSnapshot),
  };
}

export async function getClientPortalSnapshot(token: string): Promise<ClientPortalSnapshot> {
  const context = await loadPortalContext(token);
  const estimate = context.diagnostic.workOrder?.estimates?.[0] ?? null;
  const statusCode = context.diagnostic.workOrder?.status || context.appointment?.status || context.diagnostic.status;
  const stageIndex = stageForStatus(statusCode);
  const chat = await listPortalMessagesByShareId(context.report.id);
  const vehicleLabel = [context.diagnostic.vehicle.brand, context.diagnostic.vehicle.model]
    .filter(Boolean)
    .join(" ") || context.report.snapshot.vehicle.label;

  let action: ClientPortalSnapshot["action"] = null;
  if (estimate?.status === "SENT") {
    action = {
      kind: "ESTIMATE_DECISION",
      title: "Потрібне ваше погодження",
      description: "Перевірте роботи та запчастини, після чого погодьте або відхиліть кошторис.",
    };
  } else if (context.report.requestedPricingAt && !estimate) {
    action = {
      kind: "PRICING_PENDING",
      title: "Кошторис готується",
      description: "Сервіс-менеджер отримав ваш запит і готує розрахунок робіт та запчастин.",
    };
  }

  const documents: ClientPortalSnapshot["documents"] = [
    {
      key: "diagnostic",
      title: "Звіт діагностики",
      subtitle: `Сформовано ${new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", dateStyle: "medium", timeStyle: "short" }).format(new Date(context.report.snapshot.generatedAt))}`,
      status: "Готово",
    },
  ];
  if (estimate) {
    documents.push({
      key: `estimate-${estimate.id}`,
      title: `Кошторис · ревізія ${estimate.revision}`,
      subtitle: `${numberValue(estimate.totalAmount).toLocaleString("uk-UA")} ${estimate.currency}`,
      status: estimate.status === "SENT" ? "Очікує погодження" : estimate.status === "APPROVED" ? "Погоджено" : estimate.status === "REJECTED" ? "Відхилено" : estimate.status,
    });
  }

  return {
    share: {
      id: context.report.id,
      diagnosticRequestId: context.report.diagnosticRequestId,
      expiresAt: context.report.expiresAt?.toISOString() || null,
      requestedPricingAt: context.report.requestedPricingAt?.toISOString() || null,
    },
    report: context.report.snapshot,
    client: {
      id: context.diagnostic.client.id,
      name: context.diagnostic.client.name,
    },
    vehicle: {
      id: context.diagnostic.vehicle.id,
      label: vehicleLabel,
      plateNumber: context.diagnostic.vehicle.plateNumber,
      vin: context.diagnostic.vehicle.vin,
      year: context.diagnostic.vehicle.year,
      mileageKm: context.diagnostic.vehicle.mileageKm,
    },
    service: {
      workOrderId: context.diagnostic.workOrder?.id || null,
      workOrderStatus: context.diagnostic.workOrder?.status || null,
      appointmentStatus: context.appointment?.status || null,
      statusCode,
      statusLabel: STATUS_LABELS[statusCode] || "Сервісний випадок активний",
      stageIndex,
      stages: STAGES.map((stage, index) => ({ ...stage, state: stageState(index, stageIndex) })),
      stationName: context.appointment?.location.name || context.report.snapshot.stationName || null,
      postName: context.appointment?.post?.name || null,
      mechanicName: context.appointment?.mechanic?.name || context.report.snapshot.mechanicName || null,
      plannedStartAt: context.appointment?.plannedStartAt.toISOString() || null,
      plannedEndAt: context.appointment?.plannedEndAt.toISOString() || null,
      actualArrivalAt: context.appointment?.actualArrivalAt?.toISOString() || null,
      actualStartAt: context.appointment?.actualStartAt?.toISOString() || null,
      actualEndAt: context.appointment?.actualEndAt?.toISOString() || null,
      partsEtaAt: context.appointment?.partsEtaAt?.toISOString() || null,
    },
    estimate: serializeEstimate(estimate),
    action,
    documents,
    chat,
  };
}

export async function getClientPortalMessages(token: string) {
  const active = await getDiagnosticReportByToken(token);
  return listPortalMessagesByShareId(active.id);
}

export async function sendClientPortalMessage(token: string, rawText: string) {
  const text = rawText.trim().replace(/\u0000/g, "").slice(0, 2000);
  if (text.length < 1) throw new ClientPortalError("MESSAGE_REQUIRED", "Напишіть повідомлення.", 400);

  const context = await loadPortalContext(token);
  const prisma = getPrisma();
  const inquiry = await ensurePortalInquiry(context, text);
  const lastInbound = await prisma.communicationMessage.findFirst({
    where: { inquiryId: inquiry.id, direction: "IN" },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  if (lastInbound && Date.now() - lastInbound.sentAt.getTime() < 1500) {
    throw new ClientPortalError("MESSAGE_RATE_LIMIT", "Повідомлення надсилаються занадто швидко. Спробуйте ще раз за кілька секунд.", 429);
  }

  const now = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.communicationMessage.create({
      data: {
        id: makeId("msg"),
        inquiryId: inquiry.id,
        direction: "IN",
        text,
        sentAt: now,
        deliveryStatus: "RECEIVED",
        metadata: toPrismaJson({ source: "CLIENT_PORTAL", reportShareId: context.report.id }),
      },
      select: { id: true, direction: true, text: true, sentAt: true },
    });
    await tx.communicationInquiry.update({
      where: { id: inquiry.id },
      data: {
        preview: text.slice(0, 500),
        unread: true,
        answered: false,
        receivedAt: now,
        lastInboundAt: now,
      },
    });
    return created;
  });

  return {
    id: message.id,
    direction: message.direction,
    text: message.text,
    sentAt: message.sentAt.toISOString(),
  } satisfies ClientPortalMessage;
}

async function addPortalSystemMessage(context: PortalContext, text: string) {
  const prisma = getPrisma();
  const inquiry = await ensurePortalInquiry(context, text);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.communicationMessage.create({
      data: {
        id: makeId("msg"),
        inquiryId: inquiry.id,
        direction: "SYSTEM",
        text,
        sentAt: now,
        deliveryStatus: "CRM_ONLY",
        metadata: toPrismaJson({ source: "CLIENT_PORTAL", reportShareId: context.report.id }),
      },
    });
    await tx.communicationInquiry.update({
      where: { id: inquiry.id },
      data: {
        preview: text.slice(0, 500),
        unread: true,
        answered: false,
        receivedAt: now,
      },
    });
  });
}

export async function decideClientPortalEstimate(token: string, decision: "APPROVE" | "REJECT", note?: string) {
  const context = await loadPortalContext(token);
  const workOrderId = context.diagnostic.workOrder?.id;
  if (!workOrderId) {
    throw new ClientPortalError("WORK_ORDER_NOT_READY", "Кошторис для цього сервісного випадку ще не сформовано.", 409);
  }

  const actorName = context.diagnostic.client.name || "Клієнт";
  try {
    const estimate = await decideEstimate(workOrderId, {
      decision,
      approvedByName: actorName,
      source: "CLIENT_PORTAL",
      note: note?.trim().slice(0, 1000) || undefined,
    }, "Клієнт / особистий кабінет");
    if (decision === "APPROVE") {
      await normalizeApprovedEstimateFingerprint(workOrderId, estimate.id, "Клієнт / особистий кабінет");
    }
    const amount = numberValue(estimate.totalAmount).toLocaleString("uk-UA");
    await addPortalSystemMessage(
      context,
      decision === "APPROVE"
        ? `Клієнт погодив кошторис на ${amount} ${estimate.currency}.`
        : `Клієнт відхилив кошторис на ${amount} ${estimate.currency}.${note?.trim() ? ` Коментар: ${note.trim().slice(0, 500)}` : ""}`,
    );
    return getClientPortalSnapshot(token);
  } catch (error) {
    if (error instanceof WorkOrderCommercialError) {
      throw new ClientPortalError(error.code, error.message, error.code === "WORK_ORDER_NOT_FOUND" ? 404 : 409);
    }
    throw error;
  }
}

export function clientPortalErrorResponse(error: unknown) {
  if (error instanceof ClientPortalError || error instanceof DiagnosticReportError) {
    return { status: error.status, body: { ok: false, error: error.code, message: error.message } };
  }
  return null;
}
