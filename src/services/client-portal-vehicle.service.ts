import { randomUUID } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import {
  ClientPortalSessionError,
  getClientGarageSnapshot,
} from "@/src/services/client-portal-session.service";
import {
  decideEstimate,
  WorkOrderCommercialError,
} from "@/src/services/work-order-commercial.service";
import { normalizeApprovedEstimateFingerprint } from "@/src/services/work-order-estimate-fingerprint.service";

export type ClientVehiclePortalMessage = {
  id: string;
  direction: "IN" | "OUT" | "SYSTEM";
  text: string;
  sentAt: string;
};

export type ClientVehicleEstimateLine = {
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
  requiredForRepair: boolean;
  decision: "APPROVE" | "REJECT" | null;
};

export type ClientVehiclePortalDetail = {
  client: {
    id: string;
    name: string | null;
    phoneMasked: string;
  };
  vehicle: {
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
    updatedAt: string | null;
  };
  service: {
    workOrderId: string | null;
    diagnosticRequestId: string | null;
    stationName: string | null;
    postName: string | null;
    mechanicName: string | null;
    plannedStartAt: string | null;
    plannedEndAt: string | null;
    actualArrivalAt: string | null;
    actualStartAt: string | null;
    actualEndAt: string | null;
    stageIndex: number;
    stages: Array<{
      key: string;
      label: string;
      state: "DONE" | "CURRENT" | "NEXT";
    }>;
  };
  estimate: null | {
    id: string;
    revision: number;
    status: string;
    currency: string;
    totalAmount: number;
    subtotal: number;
    discountAmount: number;
    sentAt: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
    selectionSubmitted: boolean;
    selectionMode: "ALL_APPROVED" | "ALL_REJECTED" | "MIXED" | null;
    lines: ClientVehicleEstimateLine[];
  };
  findings: Array<{
    id: string;
    lineId: string;
    text: string;
    recommendation: string | null;
    urgency: string;
    managerComment: string | null;
    submittedAt: string;
    media: Array<{
      id: string;
      mimeType: string;
      fileName: string;
      url: string;
    }>;
  }>;
  documents: Array<{
    key: string;
    title: string;
    subtitle: string;
    status: string;
    date: string | null;
  }>;
  history: Awaited<ReturnType<typeof getClientGarageSnapshot>>["vehicles"][number]["history"];
  chat: {
    inquiryId: string | null;
    messages: ClientVehiclePortalMessage[];
  };
};

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

function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
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

function estimateLines(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<Omit<ClientVehicleEstimateLine, "decision"> & { snapshot: Record<string, unknown> }>;
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
      requiredForRepair: item.requiredForRepair !== false,
      snapshot: item,
    };
  });
}

function stageIndexForStatus(status: string) {
  if (status === "BOOKED") return 0;
  if (status === "ARRIVED") return 1;
  if (["DIAGNOSTICS", "PENDING", "IN_PROGRESS", "CONFIRMED"].includes(status)) return 2;
  if (["PARTS_REVIEW", "WAITING_CALCULATION", "WAITING_APPROVAL"].includes(status)) return 3;
  if (["WAITING_PARTS_SELECTION", "WAITING_PARTS"].includes(status)) return 4;
  if (["READY_FOR_REPAIR", "IN_REPAIR", "PAUSED", "REWORK", "WARRANTY"].includes(status)) return 5;
  if (status === "WAITING_QC") return 6;
  if (status === "WAITING_PAYMENT") return 7;
  if (status === "READY_FOR_PICKUP") return 8;
  if (["CLOSED", "COMPLETED"].includes(status)) return 9;
  return 0;
}

function stageState(index: number, current: number) {
  if (index < current) return "DONE" as const;
  if (index === current) return "CURRENT" as const;
  return "NEXT" as const;
}

function threadId(clientId: string, vehicleId: string) {
  return `client-garage:${clientId}:${vehicleId}`;
}

async function loadOwnedVehicle(clientId: string, vehicleId: string) {
  const vehicle = await getPrisma().vehicle.findFirst({
    where: { id: vehicleId, clientId },
    select: {
      id: true,
      brand: true,
      model: true,
      plateNumber: true,
      plateNormalized: true,
      vin: true,
      year: true,
      mileageKm: true,
      client: { select: { id: true, name: true, phone: true, phoneNormalized: true } },
    },
  });
  if (!vehicle) throw new ClientPortalSessionError("VEHICLE_NOT_FOUND", "Автомобіль не знайдено у Вашому гаражі.", 404);
  return vehicle;
}

async function findVehicleInquiry(clientId: string, vehicleId: string) {
  return getPrisma().communicationInquiry.findFirst({
    where: { channel: "WEBSITE", externalThreadId: threadId(clientId, vehicleId) },
    orderBy: { createdAt: "desc" },
  });
}

async function ensureVehicleInquiry(clientId: string, vehicleId: string, preview: string, workOrderId?: string | null) {
  const existing = await findVehicleInquiry(clientId, vehicleId);
  if (existing) return existing;
  const vehicle = await loadOwnedVehicle(clientId, vehicleId);
  const label = [vehicle.brand, vehicle.model].filter(Boolean).join(" ") || vehicle.plateNumber || "Автомобіль";
  const now = new Date();
  return getPrisma().communicationInquiry.create({
    data: {
      id: makeId("inq"),
      externalId: threadId(clientId, vehicleId),
      channel: "WEBSITE",
      state: "NEW",
      name: vehicle.client.name,
      phone: vehicle.client.phone,
      phoneNormalized: vehicle.client.phoneNormalized,
      subject: `Мій гараж · ${label}`,
      preview: preview.slice(0, 500),
      vehicle: label,
      plate: vehicle.plateNumber,
      plateNormalized: vehicle.plateNormalized,
      unread: true,
      answered: false,
      receivedAt: now,
      sourceDetail: "Мій гараж Turbo LEV",
      externalThreadId: threadId(clientId, vehicleId),
      externalParticipantId: clientId,
      lastInboundAt: now,
      metadata: toPrismaJson({
        source: "CLIENT_GARAGE",
        clientId,
        vehicleId,
        workOrderId: workOrderId || null,
      }),
    },
  });
}

export async function listClientVehicleMessages(clientId: string, vehicleId: string) {
  await loadOwnedVehicle(clientId, vehicleId);
  const inquiry = await findVehicleInquiry(clientId, vehicleId);
  if (!inquiry) return { inquiryId: null, messages: [] as ClientVehiclePortalMessage[] };
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

export async function sendClientVehicleMessage(clientId: string, vehicleId: string, rawText: string, workOrderId?: string | null) {
  const messageText = rawText.trim().replace(/\u0000/g, "").slice(0, 2000);
  if (!messageText) throw new ClientPortalSessionError("MESSAGE_REQUIRED", "Напишіть повідомлення.", 400);
  await loadOwnedVehicle(clientId, vehicleId);
  const inquiry = await ensureVehicleInquiry(clientId, vehicleId, messageText, workOrderId);
  const prisma = getPrisma();
  const lastInbound = await prisma.communicationMessage.findFirst({
    where: { inquiryId: inquiry.id, direction: "IN" },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  if (lastInbound && Date.now() - lastInbound.sentAt.getTime() < 1500) {
    throw new ClientPortalSessionError("MESSAGE_RATE_LIMIT", "Повідомлення надсилаються занадто швидко. Спробуйте ще раз за кілька секунд.", 429);
  }
  const now = new Date();
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.communicationMessage.create({
      data: {
        id: makeId("msg"),
        inquiryId: inquiry.id,
        direction: "IN",
        text: messageText,
        sentAt: now,
        deliveryStatus: "RECEIVED",
        metadata: toPrismaJson({ source: "CLIENT_GARAGE", clientId, vehicleId, workOrderId: workOrderId || null }),
      },
      select: { id: true, direction: true, text: true, sentAt: true },
    });
    await tx.communicationInquiry.update({
      where: { id: inquiry.id },
      data: { preview: messageText.slice(0, 500), unread: true, answered: false, receivedAt: now, lastInboundAt: now },
    });
    return row;
  });
  return { id: created.id, direction: created.direction, text: created.text, sentAt: created.sentAt.toISOString() } satisfies ClientVehiclePortalMessage;
}

async function addVehicleSystemMessage(clientId: string, vehicleId: string, text: string, workOrderId?: string | null) {
  const inquiry = await ensureVehicleInquiry(clientId, vehicleId, text, workOrderId);
  const now = new Date();
  await getPrisma().$transaction(async (tx) => {
    await tx.communicationMessage.create({
      data: {
        id: makeId("msg"),
        inquiryId: inquiry.id,
        direction: "SYSTEM",
        text,
        sentAt: now,
        deliveryStatus: "CRM_ONLY",
        metadata: toPrismaJson({ source: "CLIENT_GARAGE", clientId, vehicleId, workOrderId: workOrderId || null }),
      },
    });
    await tx.communicationInquiry.update({
      where: { id: inquiry.id },
      data: { preview: text.slice(0, 500), unread: true, answered: false, receivedAt: now },
    });
  });
}

export async function getClientVehiclePortalDetail(clientId: string, vehicleId: string): Promise<ClientVehiclePortalDetail> {
  const garage = await getClientGarageSnapshot(clientId);
  const garageVehicle = garage.vehicles.find((item) => item.id === vehicleId);
  if (!garageVehicle) throw new ClientPortalSessionError("VEHICLE_NOT_FOUND", "Автомобіль не знайдено у Вашому гаражі.", 404);

  const prisma = getPrisma();
  const workOrder = garageVehicle.current.workOrderId ? await prisma.workOrder.findFirst({
    where: { id: garageVehicle.current.workOrderId, clientId, vehicleId },
    select: {
      id: true,
      status: true,
      diagnosticRequestId: true,
      createdAt: true,
      updatedAt: true,
      closedAt: true,
      diagnosticRequest: { select: { id: true, status: true, technicalConclusion: true, confirmedAt: true, createdAt: true } },
      estimates: {
        orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
        take: 10,
        select: {
          id: true,
          revision: true,
          status: true,
          currency: true,
          lineFingerprint: true,
          lineSnapshot: true,
          subtotal: true,
          discountAmount: true,
          totalAmount: true,
          sentAt: true,
          approvedAt: true,
          rejectedAt: true,
          createdAt: true,
        },
      },
    },
  }) : null;

  const appointment = await prisma.serviceAppointment.findFirst({
    where: workOrder?.id ? { workOrderId: workOrder.id } : { clientId, vehicleId },
    orderBy: [{ actualArrivalAt: "desc" }, { plannedStartAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      plannedStartAt: true,
      plannedEndAt: true,
      actualArrivalAt: true,
      actualStartAt: true,
      actualEndAt: true,
      location: { select: { name: true } },
      post: { select: { name: true } },
      mechanic: { select: { name: true } },
    },
  });

  const latestEstimate = workOrder?.estimates[0] || null;
  const storedDecisions = latestEstimate ? await prisma.clientEstimateLineDecision.findMany({
    where: { estimateId: latestEstimate.id, clientId, vehicleId },
    orderBy: { decidedAt: "asc" },
    select: { lineId: true, decision: true },
  }) : [];
  const decisionMap = new Map(storedDecisions.map((item) => [item.lineId, item.decision as "APPROVE" | "REJECT"]));
  const parsedLines = latestEstimate ? estimateLines(latestEstimate.lineSnapshot) : [];
  const approvedCount = storedDecisions.filter((item) => item.decision === "APPROVE").length;
  const rejectedCount = storedDecisions.filter((item) => item.decision === "REJECT").length;
  const selectionMode = storedDecisions.length
    ? rejectedCount === 0 ? "ALL_APPROVED" as const : approvedCount === 0 ? "ALL_REJECTED" as const : "MIXED" as const
    : null;

  const findings = workOrder ? await prisma.mechanicWorkFinding.findMany({
    where: { workOrderId: workOrder.id, status: { not: "REJECTED" } },
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    take: 12,
    select: {
      id: true,
      workOrderLineId: true,
      findingText: true,
      recommendation: true,
      urgency: true,
      managerComment: true,
      submittedAt: true,
      media: { orderBy: { createdAt: "asc" }, take: 8, select: { id: true, mimeType: true, fileName: true } },
    },
  }) : [];

  const chat = await listClientVehicleMessages(clientId, vehicleId);
  const statusCode = garageVehicle.status.code;
  const stageIndex = stageIndexForStatus(statusCode);
  const documents: ClientVehiclePortalDetail["documents"] = [];
  if (workOrder?.diagnosticRequest) {
    documents.push({
      key: `diagnostic-${workOrder.diagnosticRequest.id}`,
      title: "Діагностична карта",
      subtitle: workOrder.diagnosticRequest.technicalConclusion || "Результати діагностики автомобіля",
      status: workOrder.diagnosticRequest.status === "CONFIRMED" ? "Готово" : "В процесі",
      date: (workOrder.diagnosticRequest.confirmedAt || workOrder.diagnosticRequest.createdAt).toISOString(),
    });
  }
  for (const estimate of workOrder?.estimates || []) {
    documents.push({
      key: `estimate-${estimate.id}`,
      title: `Кошторис · ревізія ${estimate.revision}`,
      subtitle: `${numberValue(estimate.totalAmount).toLocaleString("uk-UA")} ${estimate.currency}`,
      status: estimate.status === "SENT" ? "Надіслано" : estimate.status === "APPROVED" ? "Погоджено" : estimate.status === "REJECTED" ? "Відхилено" : estimate.status,
      date: (estimate.sentAt || estimate.createdAt).toISOString(),
    });
  }
  if (workOrder) {
    documents.push({
      key: `work-order-${workOrder.id}`,
      title: "Замовлення-наряд",
      subtitle: `№ ${workOrder.id.slice(-8).toUpperCase()}`,
      status: ["CLOSED", "COMPLETED"].includes(workOrder.status) ? "Закрито" : "Активний",
      date: (workOrder.closedAt || workOrder.createdAt).toISOString(),
    });
  }

  return {
    client: garage.client,
    vehicle: {
      id: garageVehicle.id,
      label: garageVehicle.label,
      brand: garageVehicle.brand,
      model: garageVehicle.model,
      year: garageVehicle.year,
      plateNumber: garageVehicle.plateNumber,
      vin: garageVehicle.vin,
      mileageKm: garageVehicle.mileageKm,
      status: garageVehicle.status,
      eta: garageVehicle.eta,
      updatedAt: garageVehicle.current.updatedAt,
    },
    service: {
      workOrderId: workOrder?.id || null,
      diagnosticRequestId: workOrder?.diagnosticRequestId || garageVehicle.current.diagnosticRequestId,
      stationName: appointment?.location?.name || null,
      postName: appointment?.post?.name || null,
      mechanicName: appointment?.mechanic?.name || null,
      plannedStartAt: appointment?.plannedStartAt?.toISOString() || null,
      plannedEndAt: appointment?.plannedEndAt?.toISOString() || null,
      actualArrivalAt: appointment?.actualArrivalAt?.toISOString() || null,
      actualStartAt: appointment?.actualStartAt?.toISOString() || null,
      actualEndAt: appointment?.actualEndAt?.toISOString() || null,
      stageIndex,
      stages: STAGES.map((stage, index) => ({ ...stage, state: stageState(index, stageIndex) })),
    },
    estimate: latestEstimate ? {
      id: latestEstimate.id,
      revision: latestEstimate.revision,
      status: latestEstimate.status,
      currency: latestEstimate.currency,
      totalAmount: numberValue(latestEstimate.totalAmount),
      subtotal: numberValue(latestEstimate.subtotal),
      discountAmount: numberValue(latestEstimate.discountAmount),
      sentAt: latestEstimate.sentAt?.toISOString() || null,
      approvedAt: latestEstimate.approvedAt?.toISOString() || null,
      rejectedAt: latestEstimate.rejectedAt?.toISOString() || null,
      selectionSubmitted: storedDecisions.length > 0,
      selectionMode,
      lines: parsedLines.map(({ snapshot: _snapshot, ...line }) => ({ ...line, decision: decisionMap.get(line.id) || null })),
    } : null,
    findings: findings.map((finding) => ({
      id: finding.id,
      lineId: finding.workOrderLineId,
      text: finding.findingText,
      recommendation: finding.recommendation,
      urgency: finding.urgency,
      managerComment: finding.managerComment,
      submittedAt: finding.submittedAt.toISOString(),
      media: finding.media.map((media) => ({
        id: media.id,
        mimeType: media.mimeType,
        fileName: media.fileName,
        url: `/api/public/diagnostic-report/client-session/vehicles/${encodeURIComponent(vehicleId)}/findings/${encodeURIComponent(finding.id)}/media/${encodeURIComponent(media.id)}`,
      })),
    })),
    documents,
    history: garageVehicle.history,
    chat,
  };
}

export async function submitClientEstimateLineDecisions(input: {
  sessionId: string;
  clientId: string;
  vehicleId: string;
  estimateId: string;
  decisions: Array<{ lineId: string; decision: "APPROVE" | "REJECT" }>;
  note?: string;
}) {
  await loadOwnedVehicle(input.clientId, input.vehicleId);
  const prisma = getPrisma();
  const estimate = await prisma.workOrderEstimate.findFirst({
    where: { id: input.estimateId, workOrder: { clientId: input.clientId, vehicleId: input.vehicleId } },
    select: {
      id: true,
      workOrderId: true,
      revision: true,
      status: true,
      currency: true,
      totalAmount: true,
      lineFingerprint: true,
      lineSnapshot: true,
    },
  });
  if (!estimate) throw new ClientPortalSessionError("ESTIMATE_NOT_FOUND", "Кошторис не знайдено.", 404);

  const latest = await prisma.workOrderEstimate.findFirst({
    where: { workOrderId: estimate.workOrderId },
    orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!latest || latest.id !== estimate.id) {
    throw new ClientPortalSessionError("ESTIMATE_SUPERSEDED", "Цей кошторис уже замінено новішою версією. Оновіть сторінку.", 409);
  }

  const existing = await prisma.clientEstimateLineDecision.findMany({
    where: { estimateId: estimate.id, clientId: input.clientId, vehicleId: input.vehicleId },
    select: { id: true },
  });
  if (existing.length) return getClientVehiclePortalDetail(input.clientId, input.vehicleId);
  if (estimate.status !== "SENT") {
    throw new ClientPortalSessionError("ESTIMATE_NOT_AWAITING_DECISION", "Цей кошторис уже не очікує рішення клієнта.", 409);
  }

  const lines = estimateLines(estimate.lineSnapshot);
  if (!lines.length) throw new ClientPortalSessionError("ESTIMATE_EMPTY", "У кошторисі немає позицій для погодження.", 409);
  const unique = new Map<string, "APPROVE" | "REJECT">();
  for (const item of input.decisions) {
    if ((item.decision !== "APPROVE" && item.decision !== "REJECT") || unique.has(item.lineId)) {
      throw new ClientPortalSessionError("INVALID_DECISIONS", "Перевірте вибір по позиціях кошторису.", 400);
    }
    unique.set(item.lineId, item.decision);
  }
  const lineIds = new Set(lines.map((line) => line.id));
  if (unique.size !== lines.length || [...unique.keys()].some((id) => !lineIds.has(id))) {
    throw new ClientPortalSessionError("DECISION_REQUIRED_FOR_EACH_LINE", "Оберіть «Погодити» або «Відмовитись» для кожної позиції.", 400);
  }

  const decisions = lines.map((line) => ({ line, decision: unique.get(line.id)! }));
  const approvedCount = decisions.filter((item) => item.decision === "APPROVE").length;
  const rejectedCount = decisions.length - approvedCount;
  const mode = rejectedCount === 0 ? "ALL_APPROVED" : approvedCount === 0 ? "ALL_REJECTED" : "MIXED";
  const note = input.note?.trim().slice(0, 1000) || null;

  if (mode !== "MIXED") {
    try {
      const decided = await decideEstimate(estimate.workOrderId, {
        decision: mode === "ALL_APPROVED" ? "APPROVE" : "REJECT",
        approvedByName: mode === "ALL_APPROVED" ? "Клієнт" : undefined,
        source: "CLIENT_GARAGE",
        note: note || undefined,
      }, "Клієнт / Мій гараж");
      if (mode === "ALL_APPROVED") {
        await normalizeApprovedEstimateFingerprint(estimate.workOrderId, decided.id, "Клієнт / Мій гараж");
      }
    } catch (error) {
      if (error instanceof WorkOrderCommercialError) {
        throw new ClientPortalSessionError(error.code, error.message, 409);
      }
      throw error;
    }
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const item of decisions) {
      await tx.clientEstimateLineDecision.create({
        data: {
          estimateId: estimate.id,
          workOrderId: estimate.workOrderId,
          clientId: input.clientId,
          vehicleId: input.vehicleId,
          sessionId: input.sessionId,
          estimateRevision: estimate.revision,
          estimateFingerprint: estimate.lineFingerprint,
          lineId: item.line.id,
          decision: item.decision,
          lineSnapshot: toPrismaJson(item.line.snapshot),
          note,
          decidedAt: now,
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        actorName: "Клієнт / Мій гараж",
        entityType: "WorkOrderEstimate",
        entityId: estimate.id,
        action: mode === "MIXED" ? "ESTIMATE_LINE_SELECTION_SUBMITTED" : mode === "ALL_APPROVED" ? "ESTIMATE_ALL_LINES_APPROVED" : "ESTIMATE_ALL_LINES_REJECTED",
        metadata: toPrismaJson({
          workOrderId: estimate.workOrderId,
          vehicleId: input.vehicleId,
          clientId: input.clientId,
          sessionId: input.sessionId,
          revision: estimate.revision,
          fingerprint: estimate.lineFingerprint,
          approvedCount,
          rejectedCount,
          decisions: decisions.map((item) => ({ lineId: item.line.id, decision: item.decision })),
          note,
        }),
      },
    });
  });

  const amount = numberValue(estimate.totalAmount).toLocaleString("uk-UA");
  const message = mode === "MIXED"
    ? `Клієнт надіслав вибір по кошторису ревізії ${estimate.revision}: погоджено ${approvedCount}, відмовлено ${rejectedCount}. Потрібна перевірка менеджера та, за потреби, нова ревізія кошторису.${note ? ` Коментар: ${note}` : ""}`
    : mode === "ALL_APPROVED"
      ? `Клієнт погодив усі ${approvedCount} позицій кошторису на ${amount} ${estimate.currency}.`
      : `Клієнт відмовився від усіх ${rejectedCount} позицій кошторису на ${amount} ${estimate.currency}.${note ? ` Коментар: ${note}` : ""}`;
  await addVehicleSystemMessage(input.clientId, input.vehicleId, message, estimate.workOrderId);
  return getClientVehiclePortalDetail(input.clientId, input.vehicleId);
}

export async function getClientVehicleFindingMedia(clientId: string, vehicleId: string, findingId: string, mediaId: string) {
  await loadOwnedVehicle(clientId, vehicleId);
  const media = await getPrisma().mechanicWorkFindingMedia.findFirst({
    where: {
      id: mediaId,
      findingId,
      finding: { workOrderId: { in: (await getPrisma().workOrder.findMany({ where: { clientId, vehicleId }, select: { id: true } })).map((item) => item.id) } },
    },
    select: { fileName: true, mimeType: true, fileSize: true, fileData: true },
  });
  if (!media) throw new ClientPortalSessionError("MEDIA_NOT_FOUND", "Файл не знайдено.", 404);
  return media;
}
