import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";
import { effectiveAssignmentStatus, listAllActiveMechanicAppointments } from "@/src/services/mechanic-assignments.service";
import { buildStationManagerControlCenter } from "@/src/services/station-manager-control-center.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ACTIVE_STATION_STATUSES = [
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
  "PAUSED",
  "WARRANTY",
] as const;

const NEEDS_MECHANIC_STATUSES = new Set(["ARRIVED", "DIAGNOSTICS", "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC"]);

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

      const appointmentInclude = {
        post: { select: { id: true, name: true } },
        mechanic: { select: { id: true, name: true } },
      } as const;

      const [location, todayAppointments, activeAppointments, posts, mechanics, controlCenter] = await Promise.all([
        prisma.serviceLocation.findUnique({ where: { id: locationId }, select: { id: true, name: true } }),
        prisma.serviceAppointment.findMany({
          where: {
            locationId,
            plannedStartAt: { gte: startAt, lt: endAt },
            status: { notIn: ["CANCELLED", "RESERVE"] },
          },
          include: appointmentInclude,
          orderBy: [{ priority: "desc" }, { plannedStartAt: "asc" }],
        }),
        prisma.serviceAppointment.findMany({
          where: { locationId, status: { in: [...ACTIVE_STATION_STATUSES] } },
          include: appointmentInclude,
          orderBy: [{ priority: "desc" }, { updatedAt: "asc" }],
          take: 250,
        }),
        prisma.servicePost.findMany({ where: { locationId, isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
        prisma.serviceMechanic.findMany({ where: { locationId, isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
        buildStationManagerControlCenter({
          locationId,
          canCommunications: hasPermission(context, PERMISSIONS.COMMUNICATIONS_READ),
          canWorkOrders: hasPermission(context, PERMISSIONS.WORK_ORDERS_READ),
        }),
      ]);

      const activeStatusCount = (status: string) => activeAppointments.filter((item) => item.status === status).length;
      const todayStatusCount = (status: string) => todayAppointments.filter((item) => item.status === status).length;
      const inRepair = activeStatusCount("IN_REPAIR");
      const occupiedPostIds = new Set(
        activeAppointments.filter((item) => item.status === "IN_REPAIR" && item.postId).map((item) => item.postId as string),
      );
      const isUnassigned = (item: (typeof activeAppointments)[number]) => NEEDS_MECHANIC_STATUSES.has(item.status) && !item.mechanicId;
      const unassignedCount = activeAppointments.filter(isUnassigned).length;

      const postLoads = posts.map((post) => {
        const active = activeAppointments.find((item) => item.postId === post.id && item.status === "IN_REPAIR") ?? null;
        return {
          id: post.id,
          name: post.name,
          occupied: Boolean(active),
          plate: active?.plateNumber ?? null,
          vehicle: active?.vehicleLabel ?? null,
          mechanic: active?.mechanic?.name ?? null,
          plannedEndAt: active?.plannedEndAt ?? null,
        };
      });

      const mechanicLoads = mechanics.map((mechanic) => {
        const assigned = activeAppointments.filter((item) => item.mechanicId === mechanic.id);
        const mechanicInRepair = assigned.filter((item) => item.status === "IN_REPAIR").length;
        return {
          id: mechanic.id,
          name: mechanic.name,
          activeCars: assigned.length,
          inRepair: mechanicInRepair,
          waiting: Math.max(0, assigned.length - mechanicInRepair),
          available: mechanicInRepair === 0,
        };
      }).sort((a, b) => b.inRepair - a.inRepair || b.activeCars - a.activeCars || a.name.localeCompare(b.name, "uk"));

      return NextResponse.json({
        ok: true,
        cabinet: "STATION_MANAGER",
        linked: true,
        station: location ?? { id: locationId, name: "Станція" },
        kpis: {
          carsToday: todayAppointments.length,
          carsOnStation: activeAppointments.length,
          inRepair,
          postsOccupied: occupiedPostIds.size,
          postsTotal: posts.length,
          mechanicsTotal: mechanics.length,
          noShow: todayStatusCount("NO_SHOW"),
          needsAction: controlCenter.attention.length,
          overdue: controlCenter.attention.filter((item) => item.overdue).length,
          unassigned: unassignedCount,
          ...controlCenter.kpis,
        },
        flow: {
          booked: todayStatusCount("BOOKED"),
          diagnostics: activeStatusCount("DIAGNOSTICS") + activeStatusCount("ARRIVED"),
          approval: activeStatusCount("WAITING_APPROVAL") + activeStatusCount("WAITING_CALCULATION"),
          waitingParts: activeStatusCount("WAITING_PARTS") + activeStatusCount("WAITING_PARTS_SELECTION"),
          readyForRepair: activeStatusCount("READY_FOR_REPAIR"),
          inRepair,
          qc: activeStatusCount("WAITING_QC"),
          ready: activeStatusCount("READY_FOR_PICKUP"),
        },
        attention: controlCenter.attention,
        posts: postLoads,
        mechanics: mechanicLoads,
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
        listAllActiveMechanicAppointments(mechanic.id),
      ]);

      const activeLines = lines.filter((line) => line.status !== "COMPLETED");
      const assignmentStatuses = activeAssignments.map(effectiveAssignmentStatus);
      const scheduledToday = activeAssignments.filter((item) => item.plannedStartAt >= startAt && item.plannedStartAt < endAt).length;
      const inProgressAssignments = assignmentStatuses.filter((status) => status === "IN_REPAIR" || status === "REWORK").length;
      const waitingPartsAssignments = assignmentStatuses.filter((status) => status === "WAITING_PARTS" || status === "WAITING_PARTS_SELECTION").length;

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
