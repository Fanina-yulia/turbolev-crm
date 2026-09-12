import "server-only";

import {
  OperationalBlockerPriority,
  OperationalBlockerSourceType,
  OperationalBlockerStatus,
} from "@/src/generated/prisma/client";
import type { BlockerCode } from "@/src/domain/workflow";
import { BLOCKER_LABELS } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

export const OPERATIONAL_BLOCKER_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "CANCELLED"] as const;
export type OperationalBlockerStatusCode = (typeof OPERATIONAL_BLOCKER_STATUSES)[number];

export const OPERATIONAL_BLOCKER_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type OperationalBlockerPriorityCode = (typeof OPERATIONAL_BLOCKER_PRIORITIES)[number];

export const OPERATIONAL_BLOCKER_SOURCE_TYPES = [
  "APPOINTMENT",
  "WORK_ORDER",
  "WORK_ORDER_LINE",
  "VEHICLE",
  "DIAGNOSTIC",
  "PARTS_REQUEST",
  "SUPPLIER_ORDER",
  "PAYMENT",
  "SYSTEM",
] as const;
export type OperationalBlockerSourceTypeCode = (typeof OPERATIONAL_BLOCKER_SOURCE_TYPES)[number];

export type OpenOperationalBlockerInput = {
  code: BlockerCode;
  priority?: OperationalBlockerPriorityCode;
  sourceType: OperationalBlockerSourceTypeCode;
  sourceId: string;
  locationId?: string | null;
  appointmentId?: string | null;
  workOrderId?: string | null;
  workOrderLineId?: string | null;
  vehicleId?: string | null;
  clientId?: string | null;
  title?: string | null;
  reason: string;
  nextAction?: string | null;
  openedByUserId?: string | null;
  openedByName?: string | null;
  dueAt?: Date | null;
  metadata?: unknown;
};

export type OperationalBlockerFilters = {
  locationId?: string | null;
  status?: OperationalBlockerStatusCode | OperationalBlockerStatusCode[] | null;
  sourceType?: OperationalBlockerSourceTypeCode | null;
  sourceId?: string | null;
  appointmentId?: string | null;
  workOrderId?: string | null;
  workOrderLineId?: string | null;
  vehicleId?: string | null;
  limit?: number;
};

export type OperationalBlockerAction = "ACKNOWLEDGE" | "RESOLVE" | "CANCEL" | "REOPEN";

const ACTIVE_STATUSES = [OperationalBlockerStatus.OPEN, OperationalBlockerStatus.ACKNOWLEDGED] as const;

function clean(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export function parseOperationalBlockerCode(value: unknown): BlockerCode | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return Object.prototype.hasOwnProperty.call(BLOCKER_LABELS, code) ? code as BlockerCode : null;
}

export function parseOperationalBlockerPriority(value: unknown): OperationalBlockerPriorityCode | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (OPERATIONAL_BLOCKER_PRIORITIES as readonly string[]).includes(code)
    ? code as OperationalBlockerPriorityCode
    : null;
}

export function parseOperationalBlockerSourceType(value: unknown): OperationalBlockerSourceTypeCode | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (OPERATIONAL_BLOCKER_SOURCE_TYPES as readonly string[]).includes(code)
    ? code as OperationalBlockerSourceTypeCode
    : null;
}

export function parseOperationalBlockerStatus(value: unknown): OperationalBlockerStatusCode | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (OPERATIONAL_BLOCKER_STATUSES as readonly string[]).includes(code)
    ? code as OperationalBlockerStatusCode
    : null;
}

export function blockerCodeForExecutionIssue(reasonCode: string): BlockerCode {
  const map: Record<string, BlockerCode> = {
    VEHICLE_NOT_PRESENT: "INTERNAL_HOLD",
    VEHICLE_NOT_HANDED_OVER: "INTERNAL_HOLD",
    BAY_OCCUPIED: "POST_UNAVAILABLE",
    EQUIPMENT_UNAVAILABLE: "INTERNAL_HOLD",
    EQUIPMENT_BROKEN: "INTERNAL_HOLD",
    PARTS_UNAVAILABLE: "PARTS_MISSING",
    ASSISTANCE_REQUIRED: "TECHNICAL_DECISION",
    ALREADY_IN_PROGRESS: "INTERNAL_HOLD",
    INCORRECT_ASSIGNMENT_DATA: "INTERNAL_HOLD",
    LICENSE_PLATE_MISMATCH: "INTERNAL_HOLD",
    TIME_UNAVAILABLE: "MECHANIC_UNAVAILABLE",
    OTHER: "OTHER",
  };
  return map[reasonCode] || "OTHER";
}

function sourceWhere(filters: OperationalBlockerFilters) {
  const status = filters.status
    ? Array.isArray(filters.status)
      ? { in: filters.status as OperationalBlockerStatus[] }
      : filters.status as OperationalBlockerStatus
    : undefined;
  return {
    ...(filters.locationId ? { locationId: filters.locationId } : {}),
    ...(status ? { status } : {}),
    ...(filters.sourceType ? { sourceType: filters.sourceType as OperationalBlockerSourceType } : {}),
    ...(filters.sourceId ? { sourceId: filters.sourceId } : {}),
    ...(filters.appointmentId ? { appointmentId: filters.appointmentId } : {}),
    ...(filters.workOrderId ? { workOrderId: filters.workOrderId } : {}),
    ...(filters.workOrderLineId ? { workOrderLineId: filters.workOrderLineId } : {}),
    ...(filters.vehicleId ? { vehicleId: filters.vehicleId } : {}),
  };
}

export async function createOperationalBlocker(input: OpenOperationalBlockerInput) {
  const code = parseOperationalBlockerCode(input.code);
  const sourceType = parseOperationalBlockerSourceType(input.sourceType);
  const priority = parseOperationalBlockerPriority(input.priority || "MEDIUM") || OperationalBlockerPriority.MEDIUM;
  const reason = clean(input.reason, 4000);
  if (!code || !sourceType || !clean(input.sourceId, 96) || !reason) throw new Error("INVALID_OPERATIONAL_BLOCKER");
  const sourceId = clean(input.sourceId, 96)!;
  const title = clean(input.title, 240) || BLOCKER_LABELS[code];
  const now = new Date();
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`operational-blocker:${sourceType}:${sourceId}:${code}`}))`;
    const existing = await tx.operationalBlocker.findFirst({
      where: { sourceType: sourceType as OperationalBlockerSourceType, sourceId, code, status: { in: [...ACTIVE_STATUSES] } },
      orderBy: { createdAt: "desc" },
    });
    const data = {
      code,
      status: OperationalBlockerStatus.OPEN,
      priority,
      sourceType,
      sourceId,
      locationId: clean(input.locationId, 64),
      appointmentId: clean(input.appointmentId, 64),
      workOrderId: clean(input.workOrderId, 64),
      workOrderLineId: clean(input.workOrderLineId, 64),
      vehicleId: clean(input.vehicleId, 64),
      clientId: clean(input.clientId, 64),
      title,
      reason,
      nextAction: clean(input.nextAction, 4000),
      openedByUserId: clean(input.openedByUserId, 64),
      openedByName: clean(input.openedByName, 160),
      dueAt: input.dueAt || null,
      metadata: input.metadata === undefined ? undefined : toPrismaJson(input.metadata),
    };
    const row = existing
      ? await tx.operationalBlocker.update({
          where: { id: existing.id },
          data: { priority, title, reason, nextAction: data.nextAction, dueAt: data.dueAt, metadata: data.metadata },
        })
      : await tx.operationalBlocker.create({ data });
    await tx.auditEvent.create({
      data: {
        actorId: data.openedByUserId,
        actorName: data.openedByName,
        entityType: "OperationalBlocker",
        entityId: row.id,
        action: existing ? "OPERATIONAL_BLOCKER_REFRESHED" : "OPERATIONAL_BLOCKER_OPENED",
        before: existing ? toPrismaJson(existing) : undefined,
        after: toPrismaJson(row),
        metadata: toPrismaJson({ code, sourceType, sourceId }),
      },
    });
    return row;
  });
}

export async function listOperationalBlockers(filters: OperationalBlockerFilters = {}) {
  const limit = Math.min(Math.max(filters.limit || 100, 1), 250);
  return getPrisma().operationalBlocker.findMany({
    where: sourceWhere(filters),
    orderBy: [{ priority: "desc" }, { dueAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
}

export async function getOperationalBlocker(id: string) {
  return getPrisma().operationalBlocker.findUnique({ where: { id } });
}

function nextStatus(current: OperationalBlockerStatus, action: OperationalBlockerAction) {
  if (action === "ACKNOWLEDGE" && current === OperationalBlockerStatus.OPEN) return OperationalBlockerStatus.ACKNOWLEDGED;
  if (action === "RESOLVE" && ACTIVE_STATUSES.includes(current as typeof ACTIVE_STATUSES[number])) return OperationalBlockerStatus.RESOLVED;
  if (action === "CANCEL" && ACTIVE_STATUSES.includes(current as typeof ACTIVE_STATUSES[number])) return OperationalBlockerStatus.CANCELLED;
  if (action === "REOPEN" && [OperationalBlockerStatus.RESOLVED, OperationalBlockerStatus.CANCELLED].includes(current)) return OperationalBlockerStatus.OPEN;
  return null;
}

export async function transitionOperationalBlocker(input: {
  id: string;
  action: OperationalBlockerAction;
  actorId: string;
  actorName?: string | null;
  resolutionComment?: string | null;
}) {
  const prisma = getPrisma();
  const comment = clean(input.resolutionComment, 4000);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`operational-blocker-transition:${input.id}`}))`;
    const current = await tx.operationalBlocker.findUnique({ where: { id: input.id } });
    if (!current) throw new Error("OPERATIONAL_BLOCKER_NOT_FOUND");
    const status = nextStatus(current.status, input.action);
    if (!status) throw new Error("OPERATIONAL_BLOCKER_INVALID_TRANSITION");
    const now = new Date();
    const row = await tx.operationalBlocker.update({
      where: { id: current.id },
      data: {
        status,
        acknowledgedAt: input.action === "ACKNOWLEDGE" || current.acknowledgedAt ? current.acknowledgedAt || now : null,
        acknowledgedByUserId: input.action === "ACKNOWLEDGE" || current.acknowledgedByUserId ? current.acknowledgedByUserId || input.actorId : null,
        resolvedAt: status === OperationalBlockerStatus.RESOLVED || status === OperationalBlockerStatus.CANCELLED ? now : null,
        resolvedByUserId: status === OperationalBlockerStatus.RESOLVED || status === OperationalBlockerStatus.CANCELLED ? input.actorId : null,
        resolutionComment: status === OperationalBlockerStatus.OPEN ? null : comment || current.resolutionComment,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: input.actorId,
        actorName: clean(input.actorName, 160),
        entityType: "OperationalBlocker",
        entityId: row.id,
        action: `OPERATIONAL_BLOCKER_${input.action}`,
        before: toPrismaJson(current),
        after: toPrismaJson(row),
        metadata: toPrismaJson({ action: input.action }),
      },
    });
    return row;
  });
}

export async function transitionOperationalBlockersForSource(input: {
  sourceType: OperationalBlockerSourceTypeCode;
  sourceId: string;
  action: "RESOLVE" | "CANCEL";
  actorId: string;
  actorName?: string | null;
  resolutionComment?: string | null;
}) {
  const rows = await listOperationalBlockers({
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    status: [...ACTIVE_STATUSES] as OperationalBlockerStatusCode[],
    limit: 250,
  });
  const results = [];
  for (const row of rows) {
    results.push(await transitionOperationalBlocker({
      id: row.id,
      action: input.action,
      actorId: input.actorId,
      actorName: input.actorName,
      resolutionComment: input.resolutionComment,
    }));
  }
  return results;
}
