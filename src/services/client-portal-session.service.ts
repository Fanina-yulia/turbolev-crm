import { createHash, randomBytes } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";
import { getDiagnosticReportByToken } from "@/src/services/diagnostic-report.service";
import { writeAuditEvent } from "@/src/services/audit.service";

export const CLIENT_PORTAL_SESSION_COOKIE = "turbolev_client_portal";
export const CLIENT_PORTAL_SESSION_DAYS = 180;

export class ClientPortalSessionError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ClientPortalSessionError";
    this.code = code;
    this.status = status;
  }
}

export type ClientGarageHistoryItem = {
  id: string;
  kind: "SERVICE" | "DIAGNOSTIC" | "APPOINTMENT";
  title: string;
  subtitle: string;
  status: string;
  date: string;
  amount: number | null;
  currency: string | null;
};

export type ClientGarageVehicle = {
  id: string;
  label: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  plateNumber: string | null;
  vin: string | null;
  mileageKm: number | null;
  status: {
    code: string;
    label: string;
    tone: "neutral" | "info" | "warning" | "success" | "danger";
  };
  eta: string | null;
  action: null | {
    kind: "ESTIMATE_DECISION" | "READY" | "INFO";
    title: string;
    description: string;
    amount: number | null;
    currency: string | null;
  };
  current: {
    workOrderId: string | null;
    diagnosticRequestId: string | null;
    appointmentId: string | null;
    updatedAt: string | null;
  };
  counts: {
    services: number;
    diagnostics: number;
  };
  history: ClientGarageHistoryItem[];
};

export type ClientGarageSnapshot = {
  client: {
    id: string;
    name: string | null;
    phoneMasked: string;
  };
  vehicles: ClientGarageVehicle[];
  generatedAt: string;
};

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hashUserAgent(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? hashToken(normalized).slice(0, 64) : null;
}

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `••• ••• ${digits.slice(-4)}`;
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; plateNumber: string | null }) {
  return [vehicle.brand, vehicle.model].filter(Boolean).join(" ") || vehicle.plateNumber || "Автомобіль";
}

const WORK_ORDER_STATUS: Record<string, { label: string; tone: ClientGarageVehicle["status"]["tone"] }> = {
  PARTS_REVIEW: { label: "Підбір деталей", tone: "warning" },
  WAITING_APPROVAL: { label: "Очікує погодження", tone: "warning" },
  WAITING_PARTS: { label: "Очікує деталі", tone: "warning" },
  READY_FOR_REPAIR: { label: "Готовий до ремонту", tone: "info" },
  IN_REPAIR: { label: "У ремонті", tone: "info" },
  PAUSED: { label: "У ремонті · призупинено", tone: "warning" },
  REWORK: { label: "У ремонті · доопрацювання", tone: "warning" },
  WAITING_QC: { label: "Контроль якості", tone: "info" },
  WAITING_PAYMENT: { label: "Готовий до видачі · очікує оплату", tone: "warning" },
  READY_FOR_PICKUP: { label: "Готовий до видачі", tone: "success" },
  CLOSED: { label: "Видано", tone: "neutral" },
  COMPLETED: { label: "Видано", tone: "neutral" },
  CANCELLED: { label: "Скасовано", tone: "neutral" },
};

const APPOINTMENT_STATUS: Record<string, { label: string; tone: ClientGarageVehicle["status"]["tone"] }> = {
  BOOKED: { label: "Заплановано", tone: "info" },
  ARRIVED: { label: "В роботі", tone: "info" },
  DIAGNOSTICS: { label: "В роботі", tone: "info" },
  WAITING_PARTS_SELECTION: { label: "Підбір деталей", tone: "warning" },
  WAITING_CALCULATION: { label: "Очікує погодження", tone: "warning" },
  WAITING_APPROVAL: { label: "Очікує погодження", tone: "warning" },
  WAITING_PARTS: { label: "Очікує деталі", tone: "warning" },
  READY_FOR_REPAIR: { label: "Готовий до ремонту", tone: "info" },
  IN_REPAIR: { label: "У ремонті", tone: "info" },
  WAITING_QC: { label: "Контроль якості", tone: "info" },
  WAITING_PAYMENT: { label: "Готовий до видачі · очікує оплату", tone: "warning" },
  READY_FOR_PICKUP: { label: "Готовий до видачі", tone: "success" },
  COMPLETED: { label: "Видано", tone: "neutral" },
  CANCELLED: { label: "Скасовано", tone: "neutral" },
  NO_SHOW: { label: "Візит не відбувся", tone: "neutral" },
  WARRANTY: { label: "Гарантійне звернення", tone: "warning" },
  PAUSED: { label: "Призупинено", tone: "warning" },
  RESERVE: { label: "Резерв", tone: "neutral" },
};

const DIAGNOSTIC_STATUS: Record<string, { label: string; tone: ClientGarageVehicle["status"]["tone"] }> = {
  PENDING: { label: "Заплановано", tone: "info" },
  IN_PROGRESS: { label: "В роботі", tone: "info" },
  CONFIRMED: { label: "Завершена діагностика", tone: "success" },
  CANCELLED: { label: "Скасовано", tone: "neutral" },
};

function iso(value?: Date | null) {
  return value?.toISOString() || null;
}

export async function createClientPortalSessionFromShareToken(shareToken: string, userAgent?: string | null) {
  const active = await getDiagnosticReportByToken(shareToken);
  const prisma = getPrisma();
  const diagnostic = await prisma.diagnosticRequest.findUnique({
    where: { id: active.diagnosticRequestId },
    select: {
      clientId: true,
      vehicleId: true,
      client: { select: { id: true, name: true, phone: true } },
    },
  });
  if (!diagnostic) {
    throw new ClientPortalSessionError("CLIENT_PORTAL_CASE_NOT_FOUND", "Сервісний випадок не знайдено.", 404);
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CLIENT_PORTAL_SESSION_DAYS * 24 * 60 * 60 * 1000);
  const session = await prisma.clientPortalSession.create({
    data: {
      clientId: diagnostic.clientId,
      tokenHash: hashToken(token),
      bootstrapShareId: active.id,
      userAgentHash: hashUserAgent(userAgent),
      expiresAt,
    },
  });

  await writeAuditEvent({
    entityType: "Client",
    entityId: diagnostic.clientId,
    action: "CLIENT_PORTAL_SESSION_CREATED",
    actorName: "Клієнт / magic link",
    metadata: {
      sessionId: session.id,
      shareId: active.id,
      vehicleId: diagnostic.vehicleId,
      expiresAt: expiresAt.toISOString(),
      source: "CLIENT_PORTAL_MAGIC_LINK",
    },
  }).catch(() => undefined);

  return {
    token,
    expiresAt,
    clientId: diagnostic.clientId,
    vehicleId: diagnostic.vehicleId,
    clientName: diagnostic.client.name,
    phoneMasked: maskPhone(diagnostic.client.phone),
  };
}

export async function resolveClientPortalSession(rawToken?: string | null) {
  if (!rawToken || rawToken.length < 20) return null;
  const prisma = getPrisma();
  const session = await prisma.clientPortalSession.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;

  const client = await prisma.client.findUnique({
    where: { id: session.clientId },
    select: { id: true },
  });
  if (!client) return null;

  if (Date.now() - session.lastSeenAt.getTime() > 15 * 60 * 1000) {
    await prisma.clientPortalSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    }).catch(() => undefined);
  }

  return {
    id: session.id,
    clientId: session.clientId,
    expiresAt: session.expiresAt,
    bootstrapShareId: session.bootstrapShareId,
  };
}

export async function revokeClientPortalSession(rawToken?: string | null) {
  if (!rawToken || rawToken.length < 20) return;
  const prisma = getPrisma();
  const session = await prisma.clientPortalSession.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!session || session.revokedAt) return;
  await prisma.clientPortalSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  await writeAuditEvent({
    entityType: "Client",
    entityId: session.clientId,
    action: "CLIENT_PORTAL_SESSION_REVOKED",
    actorName: "Клієнт / особистий кабінет",
    metadata: { sessionId: session.id, source: "CLIENT_PORTAL_LOGOUT" },
  }).catch(() => undefined);
}

export async function previewClientPortalAccess(shareToken: string) {
  const active = await getDiagnosticReportByToken(shareToken);
  const diagnostic = await getPrisma().diagnosticRequest.findUnique({
    where: { id: active.diagnosticRequestId },
    select: {
      client: { select: { name: true, phone: true } },
      vehicle: { select: { brand: true, model: true, plateNumber: true, year: true } },
    },
  });
  if (!diagnostic) throw new ClientPortalSessionError("CLIENT_PORTAL_CASE_NOT_FOUND", "Сервісний випадок не знайдено.", 404);
  return {
    clientName: diagnostic.client.name,
    phoneMasked: maskPhone(diagnostic.client.phone),
    vehicleLabel: vehicleLabel(diagnostic.vehicle),
    plateNumber: diagnostic.vehicle.plateNumber,
    year: diagnostic.vehicle.year,
    expiresAt: active.expiresAt?.toISOString() || null,
  };
}

export async function getClientGarageSnapshot(clientId: string): Promise<ClientGarageSnapshot> {
  const prisma = getPrisma();
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      phone: true,
      vehicles: {
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          brand: true,
          model: true,
          year: true,
          plateNumber: true,
          vin: true,
          mileageKm: true,
          updatedAt: true,
          diagnosticRequests: {
            orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
            take: 12,
            select: {
              id: true,
              status: true,
              technicalConclusion: true,
              confirmedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          workOrders: {
            orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
            take: 12,
            select: {
              id: true,
              diagnosticRequestId: true,
              status: true,
              closedAt: true,
              createdAt: true,
              updatedAt: true,
              estimates: {
                orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
                take: 1,
                select: {
                  id: true,
                  status: true,
                  totalAmount: true,
                  currency: true,
                  sentAt: true,
                  approvedAt: true,
                  rejectedAt: true,
                },
              },
            },
          },
          _count: { select: { workOrders: true, diagnosticRequests: true } },
        },
      },
    },
  });
  if (!client) throw new ClientPortalSessionError("CLIENT_NOT_FOUND", "Клієнта не знайдено.", 404);

  const appointments = await prisma.serviceAppointment.findMany({
    where: { clientId },
    orderBy: [{ plannedStartAt: "desc" }, { createdAt: "desc" }],
    take: 120,
    select: {
      id: true,
      vehicleId: true,
      workOrderId: true,
      status: true,
      plannedStartAt: true,
      plannedEndAt: true,
      actualArrivalAt: true,
      actualEndAt: true,
      updatedAt: true,
      location: { select: { name: true } },
    },
  });

  const vehicles: ClientGarageVehicle[] = client.vehicles.map((vehicle) => {
    const vehicleAppointments = appointments.filter((item) => item.vehicleId === vehicle.id);
    const activeWorkOrder = vehicle.workOrders.find((item) => !["CLOSED", "COMPLETED", "CANCELLED"].includes(item.status)) || null;
    const linkedDiagnosticIds = new Set(vehicle.workOrders.map((item) => item.diagnosticRequestId));
    const activeDiagnostic = vehicle.diagnosticRequests.find((item) => item.status !== "CANCELLED" && !linkedDiagnosticIds.has(item.id)) || null;
    const activeAppointment = vehicleAppointments.find((item) => !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(String(item.status))) || null;

    let statusCode = "OUTSIDE_SERVICE";
    let status: { label: string; tone: ClientGarageVehicle["status"]["tone"] } = { label: "Поза СТО", tone: "neutral" };
    if (activeWorkOrder) {
      statusCode = activeWorkOrder.status;
      status = WORK_ORDER_STATUS[statusCode] || { label: "В роботі", tone: "info" };
    } else if (activeDiagnostic) {
      statusCode = String(activeDiagnostic.status);
      status = DIAGNOSTIC_STATUS[statusCode] || { label: "Діагностика", tone: "info" };
    } else if (activeAppointment) {
      statusCode = String(activeAppointment.status);
      status = APPOINTMENT_STATUS[statusCode] || { label: "Заплановано", tone: "info" };
    }

    const appointmentForCurrent = activeWorkOrder
      ? vehicleAppointments.find((item) => item.workOrderId === activeWorkOrder.id) || activeAppointment
      : activeAppointment;
    const latestEstimate = activeWorkOrder?.estimates[0] || null;
    let action: ClientGarageVehicle["action"] = null;
    if (latestEstimate?.status === "SENT") {
      action = {
        kind: "ESTIMATE_DECISION",
        title: "Потрібне ваше погодження",
        description: "Сервіс-менеджер надіслав кошторис робіт і запчастин.",
        amount: numberValue(latestEstimate.totalAmount),
        currency: latestEstimate.currency,
      };
    } else if (statusCode === "READY_FOR_PICKUP" || statusCode === "WAITING_PAYMENT") {
      action = {
        kind: "READY",
        title: "Автомобіль готовий до видачі",
        description: statusCode === "WAITING_PAYMENT" ? "Перед видачею залишилося завершити розрахунок." : "Узгодьте з сервіс-менеджером зручний час отримання.",
        amount: null,
        currency: null,
      };
    }

    const history: ClientGarageHistoryItem[] = [];
    for (const order of vehicle.workOrders) {
      const estimate = order.estimates[0] || null;
      history.push({
        id: order.id,
        kind: "SERVICE",
        title: "Сервіс / ремонт",
        subtitle: `Замовлення-наряд ${order.id.slice(-8).toUpperCase()}`,
        status: (WORK_ORDER_STATUS[order.status]?.label || order.status),
        date: (order.closedAt || order.updatedAt || order.createdAt).toISOString(),
        amount: estimate ? numberValue(estimate.totalAmount) : null,
        currency: estimate?.currency || null,
      });
    }
    for (const diagnostic of vehicle.diagnosticRequests) {
      if (linkedDiagnosticIds.has(diagnostic.id)) continue;
      history.push({
        id: diagnostic.id,
        kind: "DIAGNOSTIC",
        title: "Діагностика",
        subtitle: diagnostic.technicalConclusion || "Перевірка автомобіля",
        status: DIAGNOSTIC_STATUS[String(diagnostic.status)]?.label || String(diagnostic.status),
        date: (diagnostic.confirmedAt || diagnostic.updatedAt || diagnostic.createdAt).toISOString(),
        amount: null,
        currency: null,
      });
    }
    for (const appointment of vehicleAppointments.slice(0, 8)) {
      if (appointment.workOrderId) continue;
      history.push({
        id: appointment.id,
        kind: "APPOINTMENT",
        title: "Візит на СТО",
        subtitle: appointment.location?.name || "Turbo LEV",
        status: APPOINTMENT_STATUS[String(appointment.status)]?.label || String(appointment.status),
        date: (appointment.actualEndAt || appointment.actualArrivalAt || appointment.plannedStartAt).toISOString(),
        amount: null,
        currency: null,
      });
    }
    history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return {
      id: vehicle.id,
      label: vehicleLabel(vehicle),
      brand: vehicle.brand,
      model: vehicle.model,
      year: vehicle.year,
      plateNumber: vehicle.plateNumber,
      vin: vehicle.vin,
      mileageKm: vehicle.mileageKm,
      status: { code: statusCode, label: status.label, tone: status.tone },
      eta: iso(appointmentForCurrent?.plannedEndAt),
      action,
      current: {
        workOrderId: activeWorkOrder?.id || null,
        diagnosticRequestId: activeWorkOrder?.diagnosticRequestId || activeDiagnostic?.id || null,
        appointmentId: appointmentForCurrent?.id || null,
        updatedAt: iso(activeWorkOrder?.updatedAt || activeDiagnostic?.updatedAt || appointmentForCurrent?.updatedAt || vehicle.updatedAt),
      },
      counts: {
        services: vehicle._count.workOrders,
        diagnostics: vehicle._count.diagnosticRequests,
      },
      history: history.slice(0, 20),
    };
  });

  vehicles.sort((a, b) => {
    const active = (item: ClientGarageVehicle) => item.status.code === "OUTSIDE_SERVICE" ? 1 : 0;
    return active(a) - active(b) || new Date(b.current.updatedAt || 0).getTime() - new Date(a.current.updatedAt || 0).getTime();
  });

  return {
    client: { id: client.id, name: client.name, phoneMasked: maskPhone(client.phone) },
    vehicles,
    generatedAt: new Date().toISOString(),
  };
}
