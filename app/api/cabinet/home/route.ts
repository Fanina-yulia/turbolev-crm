import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";
import { effectiveAssignmentStatus, listActiveMechanicAssignments } from "@/src/services/mechanic-assignments.service";

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

      const statusCount = (status: string) => appointments.filter((item) => item.status === status).length;
      const inRepair = statusCount("IN_REPAIR");
      const occupiedPostIds = new Set(
        appointments
          .filter((item) => item.status === "IN_REPAIR" && item.postId)
          .map((item) => item.postId as string),
      );
      const carsOnStation = appointments.filter((item) => ACTIVE_STATION_STATUSES.includes(item.status as (typeof ACTIVE_STATION_STATUSES)[number])).length;
      const attentionStatuses = new Set(["WAITING_APPROVAL", "WAITING_PARTS", "PAUSED", "NO_SHOW", "WAITING_QC", "READY_FOR_PICKUP"]);
      const attention = appointments
        .filter((item) => attentionStatuses.has(item.status))
        .slice(0, 12)
        .map((item) => ({
          id: item.id,
          status: item.status,
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
          noShow: statusCount("NO_SHOW"),
        },
        flow: {
          booked: statusCount("BOOKED"),
          diagnostics: statusCount("DIAGNOSTICS") + statusCount("ARRIVED"),
          approval: statusCount("WAITING_APPROVAL") + statusCount("WAITING_CALCULATION"),
          waitingParts: statusCount("WAITING_PARTS") + statusCount("WAITING_PARTS_SELECTION"),
          readyForRepair: statusCount("READY_FOR_REPAIR"),
          inRepair,
          qc: statusCount("WAITING_QC"),
          ready: statusCount("READY_FOR_PICKUP"),
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
