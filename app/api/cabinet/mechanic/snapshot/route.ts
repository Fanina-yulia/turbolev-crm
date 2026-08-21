import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";
import { effectiveAssignmentStatus, listActiveMechanicAssignments } from "@/src/services/mechanic-assignments.service";
import { listMechanicDiagnosticsForSnapshot } from "@/src/services/mechanic-diagnostics-snapshot.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function workflow(value: unknown) {
  const data = record(record(value).mechanicWorkflow);
  const pausedAt = typeof data.pausedAt === "string" && data.pausedAt ? data.pausedAt : null;
  const total = Number(data.totalPausedSeconds ?? 0);
  return { pausedAt, totalPausedSeconds: Number.isFinite(total) && total > 0 ? Math.floor(total) : 0 };
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

async function kyivDayRange() {
  const rows = await getPrisma().$queryRawUnsafe<Array<{ startAt: Date; endAt: Date }>>(`
    SELECT
      (date_trunc('day', now() AT TIME ZONE 'Europe/Kyiv') AT TIME ZONE 'Europe/Kyiv') AS "startAt",
      ((date_trunc('day', now() AT TIME ZONE 'Europe/Kyiv') + interval '1 day') AT TIME ZONE 'Europe/Kyiv') AS "endAt"
  `);
  return rows[0] ?? { startAt: new Date(Date.now() - 12 * 60 * 60 * 1000), endAt: new Date(Date.now() + 36 * 60 * 60 * 1000) };
}

function durationMs(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

function timingHeader(parts: Record<string, number>) {
  return Object.entries(parts).map(([name, duration]) => `${name};dur=${Math.round(duration)}`).join(", ");
}

export async function GET(request: Request) {
  const totalStartedAt = Date.now();
  const timings: Record<string, number> = {};
  try {
    const authStartedAt = Date.now();
    const access = await getAccessContext(request);
    timings.auth = durationMs(authStartedAt);
    if (!access.authenticated) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    if (access.provisioningState !== "ACTIVE" || !access.user) {
      return NextResponse.json({ ok: false, error: "ACCESS_PROFILE_INACTIVE" }, { status: 403 });
    }
    if (!access.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED" }, { status: 403 });
    }
    if (!hasPermission(access, PERMISSIONS.OVERVIEW_READ)
      || !hasPermission(access, PERMISSIONS.PRODUCTION_READ)
      || !hasPermission(access, PERMISSIONS.DIAGNOSTICS_READ)) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const prisma = getPrisma();
    const mechanicStartedAt = Date.now();
    const mechanic = await prisma.serviceMechanic.findFirst({
      where: { userId: access.user.id, isActive: true },
      include: { location: { select: { id: true, name: true } } },
    });
    timings.mechanic = durationMs(mechanicStartedAt);
    if (!mechanic) {
      const empty = { ok: true, linked: false, items: [] as unknown[] };
      timings.total = durationMs(totalStartedAt);
      return NextResponse.json({
        ok: true,
        linked: false,
        home: { ok: true, cabinet: "MECHANIC", linked: false, reason: "MECHANIC_RESOURCE_NOT_LINKED" },
        tasks: { ...empty, kpis: { assigned: 0, inProgress: 0, paused: 0, completedToday: 0 } },
        diagnostics: { ...empty },
        notifications: { ...empty, unreadCount: 0 },
        findings: { ...empty },
        assignedVehicles: { ...empty },
      }, { headers: { "Cache-Control": "private, no-store", "Server-Timing": timingHeader(timings) } });
    }

    const coreStartedAt = Date.now();
    const { startAt, endAt } = await kyivDayRange();
    const mechanicIds = [mechanic.id, access.user.id];

    const [lines, activeAssignments, diagnosticsData, notifications, unreadCount, clarificationRows] = await Promise.all([
      prisma.workOrderLine.findMany({
        where: {
          mechanicId: { in: mechanicIds },
          type: { not: "PART" },
          OR: [
            { status: { in: ["DRAFT", "APPROVED", "IN_PROGRESS"] } },
            { status: "COMPLETED", completedAt: { gte: startAt, lt: endAt } },
          ],
        },
        include: { workOrder: { include: { vehicle: true } } },
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        take: 60,
      }),
      listActiveMechanicAssignments(mechanic.id),
      listMechanicDiagnosticsForSnapshot(mechanic.id),
      prisma.mechanicNotification.findMany({
        where: { mechanicId: mechanic.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
      }),
      prisma.mechanicNotification.count({ where: { mechanicId: mechanic.id, readAt: null } }),
      prisma.mechanicWorkFinding.findMany({
        where: {
          OR: [
            { mechanicUserId: access.user.id },
            { mechanicResourceId: mechanic.id },
          ],
          status: "REVIEWED",
          resolutionCode: "CLARIFICATION_REQUIRED",
        },
        orderBy: [{ reviewedAt: "desc" }, { updatedAt: "desc" }],
        take: 20,
      }),
    ]);
    timings.core = durationMs(coreStartedAt);

    const enrichStartedAt = Date.now();
    const findingRows = lines.length ? await prisma.mechanicWorkFinding.findMany({
      where: { workOrderLineId: { in: lines.map((line) => line.id) } },
      select: { workOrderLineId: true, status: true },
    }) : [];
    const findingCounts = new Map<string, number>();
    const openFindingCounts = new Map<string, number>();
    for (const finding of findingRows) {
      findingCounts.set(finding.workOrderLineId, (findingCounts.get(finding.workOrderLineId) ?? 0) + 1);
      if (["SUBMITTED", "REVIEWED"].includes(finding.status)) {
        openFindingCounts.set(finding.workOrderLineId, (openFindingCounts.get(finding.workOrderLineId) ?? 0) + 1);
      }
    }

    const taskItems = lines.map((line) => {
      const state = workflow(line.metadata);
      const effectiveStatus = line.status === "IN_PROGRESS" && state.pausedAt ? "PAUSED" : line.status;
      return {
        id: line.id,
        workOrderId: line.workOrderId,
        description: line.description,
        status: effectiveStatus,
        lineStatus: line.status,
        type: line.type,
        laborHours: line.laborHours?.toString() ?? null,
        plate: line.workOrder.vehicle.plateNumber || "—",
        vehicle: vehicleLabel(line.workOrder.vehicle),
        workOrderStatus: line.workOrder.status,
        startedAt: line.startedAt,
        completedAt: line.completedAt,
        pausedAt: state.pausedAt,
        totalPausedSeconds: state.totalPausedSeconds,
        findingCount: findingCounts.get(line.id) ?? 0,
        openFindingCount: openFindingCounts.get(line.id) ?? 0,
        updatedAt: line.updatedAt,
      };
    });
    const activeTasks = taskItems.filter((item) => item.lineStatus !== "COMPLETED");

    const assignmentStatuses = activeAssignments.map(effectiveAssignmentStatus);
    const scheduledToday = activeAssignments.filter((item) => item.plannedStartAt >= startAt && item.plannedStartAt < endAt).length;
    const inProgressAssignments = assignmentStatuses.filter((status) => status === "IN_REPAIR" || status === "REWORK").length;
    const waitingPartsAssignments = assignmentStatuses.filter((status) => status === "WAITING_PARTS" || status === "WAITING_PARTS_SELECTION").length;
    const appointments = activeAssignments.map((item) => ({
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
    }));

    const clarificationOrderIds = Array.from(new Set(clarificationRows.map((item) => item.workOrderId)));
    const clarificationLineIds = Array.from(new Set(clarificationRows.map((item) => item.workOrderLineId)));
    const [orders, clarificationLines] = await Promise.all([
      clarificationOrderIds.length ? prisma.workOrder.findMany({
        where: { id: { in: clarificationOrderIds } },
        include: { vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } } },
      }) : [],
      clarificationLineIds.length ? prisma.workOrderLine.findMany({
        where: { id: { in: clarificationLineIds } },
        select: { id: true, description: true },
      }) : [],
    ]);
    const orderMap = new Map(orders.map((item) => [item.id, item]));
    const lineMap = new Map(clarificationLines.map((item) => [item.id, item.description]));

    const taskKpis = {
      assigned: activeTasks.length,
      inProgress: activeTasks.filter((item) => item.status === "IN_PROGRESS").length,
      paused: activeTasks.filter((item) => item.status === "PAUSED").length,
      completedToday: taskItems.filter((item) => item.lineStatus === "COMPLETED").length,
    };
    const homeKpis = {
      assigned: activeAssignments.length,
      scheduledToday,
      inProgress: Math.max(inProgressAssignments, taskKpis.inProgress),
      completedToday: taskKpis.completedToday,
      waitingParts: waitingPartsAssignments,
    };

    const assignedItems = activeAssignments.map((row) => ({
      id: row.id,
      caseKey: row.caseKey,
      vehicleId: row.vehicleId,
      workOrderId: row.workOrderId,
      appointmentStatus: row.appointmentStatus,
      workOrderStatus: row.workOrderStatus,
      vehicle: row.vehicleLabel || "Автомобіль",
      plate: row.plateNumber || "—",
      problem: row.problem,
      plannedStartAt: row.plannedStartAt,
      plannedEndAt: row.plannedEndAt,
      post: row.postName,
      updatedAt: row.updatedAt,
    }));

    const notificationItems = notifications.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      body: item.body,
      vehicle: item.vehicleLabel || "Автомобіль",
      plate: item.plateNumber || "—",
      appointmentId: item.appointmentId,
      workOrderId: item.workOrderId,
      findingId: item.findingId,
      payload: item.payload,
      readAt: item.readAt,
      createdAt: item.createdAt,
    }));

    const clarificationItems = clarificationRows.map((finding) => {
      const order = orderMap.get(finding.workOrderId);
      return {
        id: finding.id,
        workOrderId: finding.workOrderId,
        workOrderLineId: finding.workOrderLineId,
        findingText: finding.findingText,
        recommendation: finding.recommendation,
        urgency: finding.urgency,
        managerComment: finding.managerComment,
        reviewedAt: finding.reviewedAt,
        workDescription: lineMap.get(finding.workOrderLineId) || "Робота за нарядом",
        plate: order?.vehicle.plateNumber || "—",
        vehicle: order ? vehicleLabel(order.vehicle) : "Автомобіль",
      };
    });
    timings.enrich = durationMs(enrichStartedAt);
    timings.total = durationMs(totalStartedAt);

    return NextResponse.json({
      ok: true,
      linked: true,
      generatedAt: new Date().toISOString(),
      home: {
        ok: true,
        cabinet: "MECHANIC",
        linked: true,
        mechanic: { id: mechanic.id, name: mechanic.name, station: mechanic.location },
        kpis: homeKpis,
        tasks: taskItems,
        appointments,
      },
      tasks: { ok: true, linked: true, items: taskItems, kpis: taskKpis },
      diagnostics: { ok: true, ...diagnosticsData },
      notifications: { ok: true, linked: true, unreadCount, items: notificationItems },
      findings: { ok: true, linked: true, items: clarificationItems },
      assignedVehicles: { ok: true, linked: true, mechanic: { id: mechanic.id, name: mechanic.name }, items: assignedItems },
    }, { headers: { "Cache-Control": "private, no-store", "Server-Timing": timingHeader(timings) } });
  } catch (error) {
    console.error("GET mechanic snapshot failed", error);
    return NextResponse.json({ ok: false, error: "MECHANIC_SNAPSHOT_LOAD_FAILED", message: "Не вдалося завантажити кабінет механіка." }, { status: 500 });
  }
}
