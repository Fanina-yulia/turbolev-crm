import "server-only";

import { VehicleLocationCode as PrismaVehicleLocationCode } from "@/src/generated/prisma/client";
import {
  VEHICLE_LOCATION_LABELS,
  type VehicleLocationCode as DomainVehicleLocationCode,
} from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

export const VEHICLE_LOCATION_CODES = [
  "OUTSIDE",
  "RECEPTION",
  "QUEUE",
  "POST",
  "PARKING",
  "WAITING_PARTS",
  "QUALITY_CONTROL",
  "READY_ZONE",
  "DELIVERED",
] as const;

export type VehicleLocationCodeValue = (typeof VEHICLE_LOCATION_CODES)[number];

export const VEHICLE_LOCATION_SOURCE_TYPES = [
  "MANUAL",
  "APPOINTMENT",
  "WORK_ORDER",
  "SYSTEM",
] as const;

export type VehicleLocationSourceType = (typeof VEHICLE_LOCATION_SOURCE_TYPES)[number];

export type MoveVehicleLocationInput = {
  vehicleId: string;
  code: VehicleLocationCodeValue;
  serviceLocationId?: string | null;
  servicePostId?: string | null;
  sourceType: VehicleLocationSourceType;
  sourceId: string;
  reason?: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
  idempotencyKey?: string | null;
  occurredAt?: Date;
};

function clean(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function prismaCode(code: VehicleLocationCodeValue) {
  return code as PrismaVehicleLocationCode;
}

export function parseVehicleLocationCode(value: unknown): VehicleLocationCodeValue | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (VEHICLE_LOCATION_CODES as readonly string[]).includes(code)
    ? code as VehicleLocationCodeValue
    : null;
}

export function parseVehicleLocationSourceType(value: unknown): VehicleLocationSourceType | null {
  const source = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (VEHICLE_LOCATION_SOURCE_TYPES as readonly string[]).includes(source)
    ? source as VehicleLocationSourceType
    : null;
}

export function vehicleLocationLabel(code: VehicleLocationCodeValue | string) {
  return VEHICLE_LOCATION_LABELS[code as DomainVehicleLocationCode] || code;
}

function sameProjection(
  current: {
    code: PrismaVehicleLocationCode;
    serviceLocationId: string | null;
    servicePostId: string | null;
  } | null,
  code: PrismaVehicleLocationCode,
  serviceLocationId: string | null,
  servicePostId: string | null,
) {
  return Boolean(
    current
      && current.code === code
      && current.serviceLocationId === serviceLocationId
      && current.servicePostId === servicePostId,
  );
}

export async function moveVehicleLocation(input: MoveVehicleLocationInput) {
  const vehicleId = clean(input.vehicleId, 64);
  const code = parseVehicleLocationCode(input.code);
  const sourceType = parseVehicleLocationSourceType(input.sourceType);
  const sourceId = clean(input.sourceId, 96);
  if (!vehicleId || !code || !sourceType || !sourceId) {
    throw new Error("INVALID_VEHICLE_LOCATION");
  }

  const reason = clean(input.reason, 4000);
  const actorUserId = clean(input.actorUserId, 64);
  const actorName = clean(input.actorName, 160);
  const idempotencyKey = clean(input.idempotencyKey, 160);
  const requestedLocationId = clean(input.serviceLocationId, 64);
  const requestedPostId = clean(input.servicePostId, 64);
  const targetCode = prismaCode(code);
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", "vehicle-location:" + vehicleId);
    if (requestedPostId) {
      await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", "vehicle-location-post:" + requestedPostId);
    }

    if (idempotencyKey) {
      const replayEvent = await tx.vehicleLocationEvent.findUnique({ where: { idempotencyKey } });
      if (replayEvent) {
        const replayLocation = await tx.vehicleLocation.findUnique({ where: { vehicleId } });
        return {
          location: replayLocation,
          event: replayEvent,
          changed: false as const,
          replayed: true as const,
        };
      }
    }

    const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true } });
    if (!vehicle) throw new Error("VEHICLE_NOT_FOUND");

    const current = await tx.vehicleLocation.findUnique({ where: { vehicleId } });
    let serviceLocationId = code === "OUTSIDE" || code === "DELIVERED"
      ? null
      : requestedLocationId || current?.serviceLocationId || null;
    let servicePostId = code === "POST" ? requestedPostId : null;

    if (serviceLocationId) {
      const location = await tx.serviceLocation.findUnique({
        where: { id: serviceLocationId },
        select: { id: true, isActive: true },
      });
      if (!location || !location.isActive) throw new Error("SERVICE_LOCATION_NOT_FOUND");
    }

    if (code === "POST") {
      if (!servicePostId) throw new Error("SERVICE_POST_REQUIRED");
      const post = await tx.servicePost.findUnique({
        where: { id: servicePostId },
        select: { id: true, locationId: true, isActive: true },
      });
      if (!post || !post.isActive) throw new Error("SERVICE_POST_NOT_FOUND");
      if (serviceLocationId && post.locationId !== serviceLocationId) {
        throw new Error("SERVICE_POST_LOCATION_MISMATCH");
      }
      serviceLocationId = post.locationId;
      const occupied = await tx.vehicleLocation.findFirst({
        where: {
          code: PrismaVehicleLocationCode.POST,
          servicePostId,
          vehicleId: { not: vehicleId },
        },
        select: { vehicleId: true },
      });
      if (occupied) throw new Error("VEHICLE_POST_OCCUPIED:" + occupied.vehicleId);
    }

    if (sameProjection(current, targetCode, serviceLocationId, servicePostId)) {
      return {
        location: current,
        event: null,
        changed: false as const,
        replayed: false as const,
      };
    }

    const location = await tx.vehicleLocation.upsert({
      where: { vehicleId },
      create: {
        vehicleId,
        code: targetCode,
        serviceLocationId,
        servicePostId,
        reason,
        sourceType,
        sourceId,
        updatedByUserId: actorUserId,
        updatedByName: actorName,
      },
      update: {
        code: targetCode,
        serviceLocationId,
        servicePostId,
        reason,
        sourceType,
        sourceId,
        updatedByUserId: actorUserId,
        updatedByName: actorName,
      },
    });

    const event = await tx.vehicleLocationEvent.create({
      data: {
        vehicleId,
        fromCode: current?.code || null,
        fromServiceLocationId: current?.serviceLocationId || null,
        fromServicePostId: current?.servicePostId || null,
        toCode: targetCode,
        toServiceLocationId: serviceLocationId,
        toServicePostId: servicePostId,
        serviceLocationId,
        sourceType,
        sourceId,
        reason,
        actorUserId,
        actorName,
        idempotencyKey,
        occurredAt: input.occurredAt || new Date(),
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId: actorUserId,
        actorName,
        entityType: "VehicleLocation",
        entityId: vehicleId,
        action: "VEHICLE_LOCATION_MOVED",
        before: current ? toPrismaJson(current) : undefined,
        after: toPrismaJson(location),
        metadata: toPrismaJson({
          eventId: event.id,
          fromCode: current?.code || null,
          toCode: targetCode,
          sourceType,
          sourceId,
          serviceLocationId,
          servicePostId,
        }),
      },
    });

    return {
      location,
      event,
      changed: true as const,
      replayed: false as const,
    };
  });
}

export async function getVehicleLocation(vehicleId: string) {
  const id = clean(vehicleId, 64);
  if (!id) return null;
  return getPrisma().vehicleLocation.findUnique({ where: { vehicleId: id } });
}

export async function listVehicleLocationEvents(vehicleId: string, limit = 50) {
  const id = clean(vehicleId, 64);
  if (!id) return [];
  return getPrisma().vehicleLocationEvent.findMany({
    where: { vehicleId: id },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: Math.min(Math.max(limit, 1), 250),
  });
}

export function locationForAppointmentStatus(status: string, hasPost = false): VehicleLocationCodeValue | null {
  const normalized = status.trim().toUpperCase();
  if (normalized === "ARRIVED") return "RECEPTION";
  if (normalized === "DIAGNOSTICS") return hasPost ? "POST" : "RECEPTION";
  if (["WAITING_PARTS_SELECTION", "WAITING_CALCULATION", "WAITING_APPROVAL", "WAITING_PARTS"].includes(normalized)) {
    return normalized === "WAITING_PARTS" ? "WAITING_PARTS" : "PARKING";
  }
  if (normalized === "READY_FOR_REPAIR" || normalized === "IN_REPAIR") return hasPost ? "POST" : "QUEUE";
  if (normalized === "WAITING_QC") return "QUALITY_CONTROL";
  if (normalized === "WAITING_PAYMENT" || normalized === "READY_FOR_PICKUP") return "READY_ZONE";
  if (normalized === "COMPLETED") return "DELIVERED";
  if (normalized === "CANCELLED" || normalized === "NO_SHOW") return "OUTSIDE";
  if (normalized === "PAUSED") return "PARKING";
  return null;
}

export async function syncVehicleLocationFromAppointment(input: {
  vehicleId?: string | null;
  locationId?: string | null;
  postId?: string | null;
  status: string;
  sourceId: string;
  sourceType?: Exclude<VehicleLocationSourceType, "MANUAL">;
  reason?: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
  idempotencyKey?: string | null;
}) {
  const vehicleId = clean(input.vehicleId, 64);
  if (!vehicleId) return null;
  const initialCode = locationForAppointmentStatus(input.status, Boolean(input.postId));
  if (!initialCode) return null;
  const code = initialCode === "POST" && !input.postId ? "QUEUE" : initialCode;
  return moveVehicleLocation({
    vehicleId,
    code,
    serviceLocationId: input.locationId,
    servicePostId: code === "POST" ? input.postId : null,
    sourceType: input.sourceType || "APPOINTMENT",
    sourceId: input.sourceId,
    reason: input.reason || "Автоматична синхронізація з операційним статусом.",
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    idempotencyKey: input.idempotencyKey,
  });
}
