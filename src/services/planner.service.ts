import { getPrisma } from "@/src/lib/prisma";

export const PLANNER_BLOCKING_STATUSES = [
  "BOOKED",
  "ARRIVED",
  "DIAGNOSTICS",
  "WAITING_PARTS_SELECTION",
  "WAITING_CALCULATION",
  "WAITING_APPROVAL",
  "WAITING_PARTS",
  "READY_FOR_REPAIR",
  "IN_REPAIR",
  "WAITING_QC",
  "READY_FOR_PICKUP",
  "WARRANTY",
  "PAUSED",
  "RESERVE",
] as const;

export const PLANNER_STATUSES = [
  "BOOKED",
  "ARRIVED",
  "DIAGNOSTICS",
  "WAITING_PARTS_SELECTION",
  "WAITING_CALCULATION",
  "WAITING_APPROVAL",
  "WAITING_PARTS",
  "READY_FOR_REPAIR",
  "IN_REPAIR",
  "WAITING_QC",
  "READY_FOR_PICKUP",
  "COMPLETED",
  "WARRANTY",
  "PAUSED",
  "NO_SHOW",
  "CANCELLED",
  "RESERVE",
] as const;

export type PlannerStatus = (typeof PLANNER_STATUSES)[number];

export type AppointmentWrite = {
  locationId: string;
  postId?: string | null;
  mechanicId?: string | null;
  leadId?: string | null;
  clientId?: string | null;
  vehicleId?: string | null;
  workOrderId?: string | null;
  status?: PlannerStatus;
  customerName?: string | null;
  phone?: string | null;
  vehicleLabel?: string | null;
  plateNumber?: string | null;
  problem?: string | null;
  comment?: string | null;
  source?: string | null;
  estimatedAmount?: number | null;
  priority?: number;
  plannedStartAt: Date;
  plannedEndAt: Date;
  actualArrivalAt?: Date | null;
  actualStartAt?: Date | null;
  actualEndAt?: Date | null;
  partsEtaAt?: Date | null;
  noShowAt?: Date | null;
  createdById?: string | null;
};

export type PlannerResourceWarning = {
  type: "MECHANIC_PARALLEL_LOAD";
  mechanicId: string;
  mechanic: string;
  parallelCount: number;
  message: string;
};

function clean(value: unknown, max = 500) {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next ? next.slice(0, max) : null;
}

export function parsePlannerStatus(value: unknown): PlannerStatus | null {
  return typeof value === "string" && (PLANNER_STATUSES as readonly string[]).includes(value)
    ? (value as PlannerStatus)
    : null;
}

export function parseDateValue(value: unknown, required = false): Date | null {
  if (value == null || value === "") return required ? null : null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function normalizeAppointmentPayload(body: Record<string, unknown>, current?: AppointmentWrite): AppointmentWrite {
  const start = parseDateValue(body.plannedStartAt, true) ?? current?.plannedStartAt ?? null;
  const end = parseDateValue(body.plannedEndAt, true) ?? current?.plannedEndAt ?? null;
  if (!start || !end || end <= start) throw new Error("INVALID_TIME_RANGE");
  if (end.getTime() - start.getTime() > 24 * 60 * 60 * 1000) throw new Error("APPOINTMENT_TOO_LONG");

  const locationId = clean(body.locationId, 80) ?? current?.locationId ?? null;
  if (!locationId) throw new Error("LOCATION_REQUIRED");

  const amountRaw = body.estimatedAmount;
  const amount = amountRaw == null || amountRaw === "" ? current?.estimatedAmount ?? null : Number(amountRaw);
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) throw new Error("INVALID_AMOUNT");

  const status = parsePlannerStatus(body.status) ?? current?.status ?? "BOOKED";
  const explicitActualArrival = Object.prototype.hasOwnProperty.call(body, "actualArrivalAt");
  const explicitActualStart = Object.prototype.hasOwnProperty.call(body, "actualStartAt");
  const explicitActualEnd = Object.prototype.hasOwnProperty.call(body, "actualEndAt");
  const explicitPartsEta = Object.prototype.hasOwnProperty.call(body, "partsEtaAt");
  const explicitNoShow = Object.prototype.hasOwnProperty.call(body, "noShowAt");

  return {
    locationId,
    postId: Object.prototype.hasOwnProperty.call(body, "postId") ? clean(body.postId, 80) : current?.postId ?? null,
    mechanicId: Object.prototype.hasOwnProperty.call(body, "mechanicId") ? clean(body.mechanicId, 80) : current?.mechanicId ?? null,
    leadId: Object.prototype.hasOwnProperty.call(body, "leadId") ? clean(body.leadId, 80) : current?.leadId ?? null,
    clientId: Object.prototype.hasOwnProperty.call(body, "clientId") ? clean(body.clientId, 80) : current?.clientId ?? null,
    vehicleId: Object.prototype.hasOwnProperty.call(body, "vehicleId") ? clean(body.vehicleId, 80) : current?.vehicleId ?? null,
    workOrderId: Object.prototype.hasOwnProperty.call(body, "workOrderId") ? clean(body.workOrderId, 80) : current?.workOrderId ?? null,
    status,
    customerName: Object.prototype.hasOwnProperty.call(body, "customerName") ? clean(body.customerName, 160) : current?.customerName ?? null,
    phone: Object.prototype.hasOwnProperty.call(body, "phone") ? clean(body.phone, 32) : current?.phone ?? null,
    vehicleLabel: Object.prototype.hasOwnProperty.call(body, "vehicleLabel") ? clean(body.vehicleLabel, 180) : current?.vehicleLabel ?? null,
    plateNumber: Object.prototype.hasOwnProperty.call(body, "plateNumber") ? clean(body.plateNumber, 24)?.toUpperCase() ?? null : current?.plateNumber ?? null,
    problem: Object.prototype.hasOwnProperty.call(body, "problem") ? clean(body.problem, 4000) : current?.problem ?? null,
    comment: Object.prototype.hasOwnProperty.call(body, "comment") ? clean(body.comment, 4000) : current?.comment ?? null,
    source: Object.prototype.hasOwnProperty.call(body, "source") ? clean(body.source, 40) : current?.source ?? null,
    estimatedAmount: amount,
    priority: Object.prototype.hasOwnProperty.call(body, "priority") ? Math.max(0, Math.min(10, Number(body.priority) || 0)) : current?.priority ?? 0,
    plannedStartAt: start,
    plannedEndAt: end,
    actualArrivalAt: explicitActualArrival ? parseDateValue(body.actualArrivalAt) : current?.actualArrivalAt ?? null,
    actualStartAt: explicitActualStart ? parseDateValue(body.actualStartAt) : current?.actualStartAt ?? null,
    actualEndAt: explicitActualEnd ? parseDateValue(body.actualEndAt) : current?.actualEndAt ?? null,
    partsEtaAt: explicitPartsEta ? parseDateValue(body.partsEtaAt) : current?.partsEtaAt ?? null,
    noShowAt: explicitNoShow ? parseDateValue(body.noShowAt) : current?.noShowAt ?? null,
    createdById: Object.prototype.hasOwnProperty.call(body, "createdById") ? clean(body.createdById, 80) : current?.createdById ?? null,
  };
}

export async function getPlannerBoard(from: Date, to: Date, locationId?: string | null) {
  const prisma = getPrisma();
  const locations = await prisma.serviceLocation.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      posts: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      mechanics: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
    },
  });

  const activeLocationId = locationId && locations.some((location) => location.id === locationId)
    ? locationId
    : locations[0]?.id ?? null;

  const appointments = activeLocationId
    ? await prisma.serviceAppointment.findMany({
        where: {
          locationId: activeLocationId,
          plannedStartAt: { lt: to },
          plannedEndAt: { gt: from },
        },
        orderBy: [{ plannedStartAt: "asc" }, { priority: "desc" }],
        include: { post: true, mechanic: true },
      })
    : [];

  return { locations, activeLocationId, appointments };
}

export async function validatePlannerResources(input: AppointmentWrite, excludeId?: string) {
  if (input.status === "CANCELLED" || input.status === "NO_SHOW" || input.status === "COMPLETED") {
    return { conflict: null, warning: null };
  }

  const prisma = getPrisma();
  const overlapWhere = {
    id: excludeId ? { not: excludeId } : undefined,
    locationId: input.locationId,
    status: { in: [...PLANNER_BLOCKING_STATUSES] },
    plannedStartAt: { lt: input.plannedEndAt },
    plannedEndAt: { gt: input.plannedStartAt },
  };

  if (input.postId) {
    const postConflict = await prisma.serviceAppointment.findFirst({
      where: { ...overlapWhere, postId: input.postId },
      include: { post: true, mechanic: true },
    });
    if (postConflict) {
      return {
        conflict: {
          id: postConflict.id,
          resource: postConflict.post?.name ?? "цей пост",
          resourceType: "POST" as const,
          start: postConflict.plannedStartAt,
          end: postConflict.plannedEndAt,
          vehicle: postConflict.vehicleLabel ?? postConflict.plateNumber ?? "інший запис",
        },
        warning: null,
      };
    }
  }

  if (input.mechanicId) {
    const mechanicOverlaps = await prisma.serviceAppointment.findMany({
      where: { ...overlapWhere, mechanicId: input.mechanicId },
      include: { mechanic: true },
      orderBy: { plannedStartAt: "asc" },
      take: 2,
    });

    if (mechanicOverlaps.length >= 2) {
      const conflict = mechanicOverlaps[0];
      return {
        conflict: {
          id: conflict.id,
          resource: conflict.mechanic?.name ?? "цей механік",
          resourceType: "MECHANIC" as const,
          start: conflict.plannedStartAt,
          end: conflict.plannedEndAt,
          vehicle: conflict.vehicleLabel ?? conflict.plateNumber ?? "інший запис",
        },
        warning: null,
      };
    }

    if (mechanicOverlaps.length === 1) {
      const parallel = mechanicOverlaps[0];
      const mechanicName = parallel.mechanic?.name ?? "Механік";
      const warning: PlannerResourceWarning = {
        type: "MECHANIC_PARALLEL_LOAD",
        mechanicId: input.mechanicId,
        mechanic: mechanicName,
        parallelCount: 2,
        message: `${mechanicName} буде вести 2 автомобілі одночасно. CRM дозволяє це, але попереджає про паралельне завантаження.`,
      };
      return { conflict: null, warning };
    }
  }

  return { conflict: null, warning: null };
}

export async function createPlannerAppointment(input: AppointmentWrite) {
  const validation = await validatePlannerResources(input);
  if (validation.conflict) return { ok: false as const, conflict: validation.conflict };
  const prisma = getPrisma();
  const appointment = await prisma.serviceAppointment.create({ data: input, include: { post: true, mechanic: true } });
  return { ok: true as const, appointment, warning: validation.warning };
}

export async function updatePlannerAppointment(id: string, body: Record<string, unknown>) {
  const prisma = getPrisma();
  const existing = await prisma.serviceAppointment.findUnique({ where: { id } });
  if (!existing) return { ok: false as const, notFound: true as const };

  const current: AppointmentWrite = {
    locationId: existing.locationId,
    postId: existing.postId,
    mechanicId: existing.mechanicId,
    leadId: existing.leadId,
    clientId: existing.clientId,
    vehicleId: existing.vehicleId,
    workOrderId: existing.workOrderId,
    status: existing.status as PlannerStatus,
    customerName: existing.customerName,
    phone: existing.phone,
    vehicleLabel: existing.vehicleLabel,
    plateNumber: existing.plateNumber,
    problem: existing.problem,
    comment: existing.comment,
    source: existing.source,
    estimatedAmount: existing.estimatedAmount == null ? null : Number(existing.estimatedAmount),
    priority: existing.priority,
    plannedStartAt: existing.plannedStartAt,
    plannedEndAt: existing.plannedEndAt,
    actualArrivalAt: existing.actualArrivalAt,
    actualStartAt: existing.actualStartAt,
    actualEndAt: existing.actualEndAt,
    partsEtaAt: existing.partsEtaAt,
    noShowAt: existing.noShowAt,
    createdById: existing.createdById,
  };

  const input = normalizeAppointmentPayload(body, current);
  if (input.status === "ARRIVED" && !input.actualArrivalAt) input.actualArrivalAt = new Date();
  if (input.status === "IN_REPAIR" && !input.actualStartAt) input.actualStartAt = new Date();
  if (input.status === "COMPLETED" && !input.actualEndAt) input.actualEndAt = new Date();
  if (input.status === "NO_SHOW" && !input.noShowAt) input.noShowAt = new Date();

  const validation = await validatePlannerResources(input, id);
  if (validation.conflict) return { ok: false as const, conflict: validation.conflict };

  const appointment = await prisma.serviceAppointment.update({ where: { id }, data: input, include: { post: true, mechanic: true } });
  return { ok: true as const, appointment, warning: validation.warning };
}
