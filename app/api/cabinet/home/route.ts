import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";
import { listActiveMechanicAssignments } from "@/src/services/mechanic-assignments.service";
import { getVehicleLifecycleMap } from "@/src/services/vehicle-lifecycle.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function kyivDayRange() {
  const prisma = getPrisma();
  const rows = await prisma.$queryRawUnsafe<Array<{ startAt: Date; endAt: Date }>>(`
    SELECT
      (date_trunc('day', now() AT TIME ZONE 'Europe/Kyiv') AT TIME ZONE 'Europe/Kyiv') AS "startAt",
      ((date_trunc('day', now() AT TIME ZONE 'Europe/Kyiv') + interval '1 day') AT TIME ZONE 'Europe/Kyiv') AS "endAt"
  `);
  return rows[0] ?? { startAt: new Date(Date.now() - 12 * 60 * 60 * 1000), endAt: new Date(Date.now() + 36 * 60 * 60 * 1000) };
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function lifecyclePayload(lifecycle: Awaited<ReturnType<typeof getVehicleLifecycleMap>> extends Map<string, infer T> ? T : never) {
  return lifecycle ? {
    code: lifecycle.code,
    label: lifecycle.label,
    tone: lifecycle.tone,
    order: lifecycle.order,
    active: lifecycle.active,
    flags: lifecycle.flags,
  } : null;
}

export async function GET(request: Request) {
  try {
    const context = await getAccessContext(request);
    if (!context.authenticated) {
      return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    }
    if (context.provisioningState !== "ACTIVE" || !context.user) {
      return NextResponse.json({ ok: false, error: "ACCESS_PROFILE_INACTIVE" }, { status: 403 });
    }
    if (!hasPermission(context, PERMISSIONS.OVERVIEW_READ)) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const roleCodes = new Set(context.roles.map((role) => role.code));
    const prisma = getPrisma();
    const { startAt, endAt } = await kyivDayRange();
    const now = new Date();

    if (roleCodes.has("STATION_MANAGER")) {
      const stationRole = context.roles.find((role) => role.code === "STATION_MANAGER");
      const locationId = stationRole?.locationId ?? context.locationIds[0] ?? null;
      if (!locationId) {
        return NextResponse.json({
          ok: true,
          cabinet: "STATION_MANAGER",
          linked: false,
          reason: "LOCATION_NOT_ASSIGNED",
        });
      }

      const [location, appointments, posts, mechanics] = await Promise.all([
        prisma.serviceLocation.findUnique({ where: { id: locationId }, select: { id: true, name: true } }),
        prisma.serviceAppointment.findMany({
          where: {
            locationId,
            plannedStartAt: { gte: startAt, lt: endAt },
            status: { notIn: ["CANCELLED", "RESERVE"] },
          },
          include: {
            post: { select: { id: true, name: true } },
            mechanic: { select: { id: true, name: true } },
          },
          orderBy: [{ priority: "desc" }, { plannedStartAt: "asc" }],
        }),
        prisma.servicePost.findMany({ where: { locationId, isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
        prisma.serviceMechanic.findMany({ where: { locationId, isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
      ]);

      const vehicleIds = appointments.map((item) => item.vehicleId).filter((value): value is string => Boolean(value));
      const lifecycleMap = await getVehicleLifecycleMap(vehicleIds, now);
      const lifecycleFor = (vehicleId: string | null) => vehicleId ? lifecycleMap.get(vehicleId) || null : null;
      const lifecycleCount = (...codes: string[]) => appointments.filter((item) => {
        const lifecycle = lifecycleFor(item.vehicleId);
        return lifecycle && codes.includes(lifecycle.code);
      }).length;
      const noShow = appointments.filter((item) => item.status === "NO_SHOW").length;
      const inRepair = lifecycleCount("IN_REPAIR");
      const carsOnStation = appointments.filter((item) => {
        const lifecycle = lifecycleFor(item.vehicleId);
        return lifecycle?.active && !["PLANNED", "DELIVERED", "CANCELLED"].includes(lifecycle.code);
      }).length;
      const occupiedPostIds = new Set(
        appointments
          .filter((item) => item.postId && lifecycleFor(item.vehicleId)?.code === "IN_REPAIR")
          .map((item) => item.postId as string),
      );
      const attention = appointments
        .filter((item) => {
          const lifecycle = lifecycleFor(item.vehicleId);
          if (!lifecycle) return item.status === "NO_SHOW";
          return lifecycle.flags.includes("NEEDS_ATTENTION") || [
            "DIAGNOSTIC_COMPLETED",
            "MANAGER_REVIEW",
            "CLIENT_DECISION",
            "WAITING_APPROVAL",
            "WAITING_PARTS",
            "QUALITY_CONTROL",
            "WAITING_PAYMENT",
            "READY_FOR_PICKUP",
          ].includes(lifecycle.code);
        })
        .slice(0, 12)
        .map((item) => ({
          id: item.id,
          status: item.status,
          lifecycle: lifecyclePayload(lifecycleFor(item.vehicleId)),
          plate: item.plateNumber || "—",
          vehicle: item.vehicleLabel || "Автомобіль",
          problem: item.problem,
          plannedStartAt: item.plannedStartAt,
          post: item.post?.name ?? null,
          mechanic: item.mechanic?.name ?? null,
        }));

      return NextResponse.json({
        ok: true,
        cabinet: "STATION_MANAGER",
        linked: true,
        station: location ?? { id: locationId, name: "Станція" },
        kpis: {
          carsToday: appointments.length,
          carsOnStation,
          inRepair,
          postsOccupied: occupiedPostIds.size,
          postsTotal: posts.length,
          mechanicsTotal: mechanics.length,
          noShow,
        },
        flow: {
          booked: lifecycleCount("PLANNED"),
          diagnostics: lifecycleCount("IN_WORK", "DIAGNOSTIC_COMPLETED", "MANAGER_REVIEW"),
          approval: lifecycleCount("CLIENT_DECISION", "WAITING_APPROVAL"),
          waitingParts: lifecycleCount("PARTS_SELECTION", "WAITING_PARTS"),
          readyForRepair: lifecycleCount("READY_FOR_REPAIR"),
          inRepair,
          qc: lifecycleCount("QUALITY_CONTROL"),
          ready: lifecycleCount("WAITING_PAYMENT", "READY_FOR_PICKUP"),
        },
        attention,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (roleCodes.has("MECHANIC")) {
      const mechanic = await prisma.serviceMechanic.findFirst({
        where: { userId: context.user.id, isActive: true },
        include: { location: { select: { id: true, name: true } } },
      });

      if (!mechanic) {
        return NextResponse.json({
          ok: true,
          cabinet: "MECHANIC",
          linked: false,
          reason: "MECHANIC_RESOURCE_NOT_LINKED",
        });
      }

      const mechanicIds = [mechanic.id, context.user.id];
      const [lines, activeAssignments] = await Promise.all([
        prisma.workOrderLine.findMany({
          where: {
            mechanicId: { in: mechanicIds },
            OR: [
              { status: { in: ["DRAFT", "APPROVED", "IN_PROGRESS"] } },
              { status: "COMPLETED", completedAt: { gte: startAt, lt: endAt } },
            ],
          },
          include: {
            workOrder: {
              include: {
                vehicle: true,
              },
            },
          },
          orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
          take: 40,
        }),
        listActiveMechanicAssignments(mechanic.id),
      ]);

      const assignmentVehicleIds = activeAssignments.map((item) => item.vehicleId).filter((value): value is string => Boolean(value));
      const lifecycleMap = await getVehicleLifecycleMap(assignmentVehicleIds, now);
      const lifecycleFor = (vehicleId: string | null) => vehicleId ? lifecycleMap.get(vehicleId) || null : null;
      const activeLines = lines.filter((line) => line.status !== "COMPLETED");
      const scheduledToday = activeAssignments.filter((item) => item.plannedStartAt >= startAt && item.plannedStartAt < endAt && lifecycleFor(item.vehicleId)?.code === "PLANNED").length;
      const inProgressAssignments = activeAssignments.filter((item) => ["IN_WORK", "IN_REPAIR"].includes(lifecycleFor(item.vehicleId)?.code || "")).length;
      const waitingPartsAssignments = activeAssignments.filter((item) => ["PARTS_SELECTION", "WAITING_PARTS"].includes(lifecycleFor(item.vehicleId)?.code || "")).length;

      return NextResponse.json({
        ok: true,
        cabinet: "MECHANIC",
        linked: true,
        mechanic: { id: mechanic.id, name: mechanic.name, station: mechanic.location },
        kpis: {
          assigned: activeAssignments.length,
          scheduledToday,
          inProgress: Math.max(inProgressAssignments, activeLines.filter((line) => line.status === "IN_PROGRESS").length),
          completedToday: lines.filter((line) => line.status === "COMPLETED").length,
          waitingParts: waitingPartsAssignments,
        },
        tasks: lines.map((line) => ({
          id: line.id,
          workOrderId: line.workOrderId,
          description: line.description,
          status: line.status,
          type: line.type,
          laborHours: line.laborHours?.toString() ?? null,
          plate: line.workOrder.vehicle.plateNumber || "—",
          vehicle: vehicleLabel(line.workOrder.vehicle),
          workOrderStatus: line.workOrder.status,
          updatedAt: line.updatedAt,
        })),
        appointments: activeAssignments.map((item) => ({
          id: item.id,
          workOrderId: item.workOrderId,
          status: item.appointmentStatus,
          workOrderStatus: item.workOrderStatus,
          lifecycle: lifecyclePayload(lifecycleFor(item.vehicleId)),
          plannedStartAt: item.plannedStartAt,
          plannedEndAt: item.plannedEndAt,
          plate: item.plateNumber || "—",
          vehicle: item.vehicleLabel || "Автомобіль",
          problem: item.problem,
          post: item.postName,
        })),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ ok: false, error: "ROLE_CABINET_NOT_SUPPORTED" }, { status: 403 });
  } catch (error) {
    console.error("GET /api/cabinet/home failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "CABINET_LOAD_FAILED" }, { status: 500 });
  }
}
