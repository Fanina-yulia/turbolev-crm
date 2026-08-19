import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission, type AccessContext } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";
import { transitionWorkOrder, WorkOrderNotFoundError, WorkOrderTransitionError } from "@/src/services/work-orders.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PRODUCTION_STATUSES = ["WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "PAUSED", "REWORK", "WAITING_QC"] as const;
const TERMINAL_LINE_STATUSES = new Set(["COMPLETED", "CANCELLED"]);
const ACTION_TARGET: Record<string, string> = {
  START: "IN_REPAIR",
  PAUSE: "PAUSED",
  RESUME: "IN_REPAIR",
  FINISH: "WAITING_QC",
  REWORK_START: "IN_REPAIR",
};

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    WAITING_PARTS: "Очікує деталі",
    READY_FOR_REPAIR: "Готовий до ремонту",
    IN_REPAIR: "У ремонті",
    PAUSED: "Пауза / проблема",
    REWORK: "Доопрацювання",
    WAITING_QC: "Очікує QC",
  };
  return labels[status] || status;
}

function decimal(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function scopeRank(scope: AccessScopeCode | undefined) {
  return scope === "ALL" ? 5 : scope === "LOCATION" ? 4 : scope === "TEAM" ? 3 : scope === "ASSIGNED" ? 2 : scope === "SELF" ? 1 : 0;
}

async function resolveBoardScope(request: Request, context: AccessContext) {
  const prisma = getPrisma();
  const url = new URL(request.url);
  const requestedLocationId = url.searchParams.get("locationId")?.trim() || null;
  const roleCodes = new Set(context.roles.map((role) => role.code));
  const activeUser = context.provisioningState === "ACTIVE" && context.user ? context.user : null;
  const productionScope = context.permissions[PERMISSIONS.PRODUCTION_READ] as AccessScopeCode | undefined;

  let mechanic: { id: string; locationId: string; name: string } | null = null;
  if (activeUser && roleCodes.has("MECHANIC")) {
    mechanic = await prisma.serviceMechanic.findFirst({
      where: { userId: activeUser.id, isActive: true },
      select: { id: true, locationId: true, name: true },
    });
  }

  if (mechanic) {
    return { locationId: mechanic.locationId, mechanic, role: "MECHANIC" as const, canChooseLocation: false };
  }

  const allLocations = await prisma.serviceLocation.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { sortOrder: "asc" },
  });

  const allowedIds = new Set(context.locationIds);
  const canSeeAll = !activeUser || scopeRank(productionScope) >= scopeRank("ALL");
  const visibleLocations = canSeeAll ? allLocations : allLocations.filter((location) => allowedIds.has(location.id));
  const requestedAllowed = requestedLocationId && visibleLocations.some((location) => location.id === requestedLocationId);
  const locationId = requestedAllowed ? requestedLocationId! : visibleLocations[0]?.id ?? null;

  return {
    locationId,
    mechanic: null,
    role: roleCodes.has("STATION_MANAGER") ? "STATION_MANAGER" as const : "OPERATIONS" as const,
    canChooseLocation: visibleLocations.length > 1,
    locations: visibleLocations,
  };
}

async function verifyProductionAccess(request: Request, write = false) {
  const context = await getAccessContext(request);
  const permission = write ? PERMISSIONS.PRODUCTION_WRITE : PERMISSIONS.PRODUCTION_READ;
  if (context.enforcementMode === "ENFORCED") {
    if (!context.authenticated) return { context, error: NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 }) };
    if (context.provisioningState !== "ACTIVE" || !context.user) return { context, error: NextResponse.json({ ok: false, error: "ACCESS_PROFILE_INACTIVE" }, { status: 403 }) };
    if (!hasPermission(context, permission)) return { context, error: NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }) };
  }
  return { context, error: null };
}

async function workOrderAllowedForScope(workOrderId: string, request: Request, context: AccessContext) {
  const scope = await resolveBoardScope(request, context);
  if (!scope.locationId) return false;
  const prisma = getPrisma();

  if (scope.mechanic) {
    const mechanicIds = context.user ? [scope.mechanic.id, context.user.id] : [scope.mechanic.id];
    const [appointment, line] = await Promise.all([
      prisma.serviceAppointment.findFirst({ where: { workOrderId, mechanicId: scope.mechanic.id }, select: { id: true } }),
      prisma.workOrderLine.findFirst({ where: { workOrderId, mechanicId: { in: mechanicIds } }, select: { id: true } }),
    ]);
    return Boolean(appointment || line);
  }

  const appointment = await prisma.serviceAppointment.findFirst({
    where: { workOrderId, locationId: scope.locationId },
    select: { id: true },
  });
  return Boolean(appointment);
}

export async function GET(request: Request) {
  try {
    const access = await verifyProductionAccess(request, false);
    if (access.error) return access.error;
    const context = access.context;
    const prisma = getPrisma();
    const scope = await resolveBoardScope(request, context);
    if (!scope.locationId) {
      return NextResponse.json({ ok: true, location: null, locations: [], posts: [], mechanics: [], cards: [], canWrite: false, role: scope.role });
    }

    const [location, posts, mechanics] = await Promise.all([
      prisma.serviceLocation.findUnique({ where: { id: scope.locationId }, select: { id: true, name: true, timezone: true } }),
      prisma.servicePost.findMany({ where: { locationId: scope.locationId, isActive: true }, select: { id: true, name: true, sortOrder: true }, orderBy: { sortOrder: "asc" } }),
      prisma.serviceMechanic.findMany({ where: { locationId: scope.locationId, isActive: true }, select: { id: true, name: true, sortOrder: true }, orderBy: { sortOrder: "asc" } }),
    ]);

    const appointmentWhere = scope.mechanic
      ? { locationId: scope.locationId, mechanicId: scope.mechanic.id, workOrderId: { not: null as string | null } }
      : { locationId: scope.locationId, workOrderId: { not: null as string | null } };

    const appointments = await prisma.serviceAppointment.findMany({
      where: appointmentWhere,
      include: { post: { select: { id: true, name: true } }, mechanic: { select: { id: true, name: true } } },
      orderBy: [{ updatedAt: "desc" }, { plannedStartAt: "desc" }],
      take: 500,
    });

    const appointmentIds = appointments.map((item) => item.workOrderId).filter((value): value is string => Boolean(value));
    let assignedLineIds: string[] = [];
    if (scope.mechanic && context.user) {
      const lines = await prisma.workOrderLine.findMany({
        where: { mechanicId: { in: [scope.mechanic.id, context.user.id] }, workOrder: { status: { in: [...PRODUCTION_STATUSES] } } },
        select: { workOrderId: true },
        take: 500,
      });
      assignedLineIds = lines.map((line) => line.workOrderId);
    }
    const workOrderIds = Array.from(new Set([...appointmentIds, ...assignedLineIds]));

    if (!workOrderIds.length) {
      return NextResponse.json({
        ok: true,
        location,
        locations: "locations" in scope ? scope.locations : location ? [{ id: location.id, name: location.name }] : [],
        posts,
        mechanics: scope.mechanic ? mechanics.filter((item) => item.id === scope.mechanic!.id) : mechanics,
        cards: [],
        canWrite: context.enforcementMode !== "ENFORCED" || hasPermission(context, PERMISSIONS.PRODUCTION_WRITE),
        role: scope.role,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const workOrders = await prisma.workOrder.findMany({
      where: { id: { in: workOrderIds }, status: { in: [...PRODUCTION_STATUSES] } },
      include: {
        vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true } },
        diagnosticRequest: { select: { technicalConclusion: true } },
        lines: {
          where: { status: { not: "CANCELLED" } },
          select: { id: true, type: true, status: true, description: true, mechanicId: true, requiredForRepair: true, startedAt: true, completedAt: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        partsRequests: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          include: { items: { select: { quantity: true, receivedQuantity: true, requiredForRepair: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 300,
    });

    const numberRows = await prisma.workOrderNumber.findMany({
      where: { workOrderId: { in: workOrders.map((item) => item.id) } },
      select: { workOrderId: true, number: true },
    });
    const numberMap = new Map(numberRows.map((item) => [item.workOrderId, item.number]));
    const appointmentMap = new Map<string, (typeof appointments)[number]>();
    for (const appointment of appointments) {
      if (appointment.workOrderId && !appointmentMap.has(appointment.workOrderId)) appointmentMap.set(appointment.workOrderId, appointment);
    }

    const cards = workOrders
      .filter((workOrder) => {
        if (!scope.mechanic) return true;
        const appointment = appointmentMap.get(workOrder.id);
        const assignedLine = workOrder.lines.some((line) => line.mechanicId === scope.mechanic!.id || line.mechanicId === context.user?.id);
        return appointment?.mechanicId === scope.mechanic.id || assignedLine;
      })
      .map((workOrder) => {
        const appointment = appointmentMap.get(workOrder.id) ?? null;
        const latestParts = workOrder.partsRequests[0] ?? null;
        const requiredItems = latestParts?.items.filter((item) => item.requiredForRepair) ?? [];
        const partsReady = workOrder.status === "WAITING_PARTS"
          ? false
          : requiredItems.length
            ? requiredItems.every((item) => decimal(item.receivedQuantity) >= decimal(item.quantity))
            : !workOrder.lines.some((line) => line.type === "PART" && line.requiredForRepair && !TERMINAL_LINE_STATUSES.has(line.status));
        const workLines = workOrder.lines.filter((line) => line.type !== "PART");
        const activeWorks = workLines.filter((line) => !TERMINAL_LINE_STATUSES.has(line.status));
        return {
          id: workOrder.id,
          number: numberMap.get(workOrder.id) ?? null,
          status: workOrder.status,
          statusLabel: statusLabel(workOrder.status),
          plate: workOrder.vehicle.plateNumber || "—",
          vehicle: vehicleLabel(workOrder.vehicle),
          vehicleId: workOrder.vehicle.id,
          problem: workOrder.diagnosticRequest.technicalConclusion,
          post: appointment?.post ?? null,
          mechanic: appointment?.mechanic ?? null,
          plannedStartAt: appointment?.plannedStartAt ?? null,
          plannedEndAt: appointment?.plannedEndAt ?? null,
          actualStartAt: appointment?.actualStartAt ?? null,
          partsReady,
          partsRequestStatus: latestParts?.status ?? null,
          works: activeWorks.slice(0, 4).map((line) => ({ id: line.id, description: line.description, status: line.status })),
          workCount: workLines.length,
          completedWorkCount: workLines.filter((line) => line.status === "COMPLETED").length,
          updatedAt: workOrder.updatedAt,
        };
      });

    return NextResponse.json({
      ok: true,
      location,
      locations: "locations" in scope ? scope.locations : location ? [{ id: location.id, name: location.name }] : [],
      posts,
      mechanics: scope.mechanic ? mechanics.filter((item) => item.id === scope.mechanic!.id) : mechanics,
      cards,
      canWrite: context.enforcementMode !== "ENFORCED" || hasPermission(context, PERMISSIONS.PRODUCTION_WRITE),
      role: scope.role,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/production failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити виробничу дошку." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await verifyProductionAccess(request, true);
    if (access.error) return access.error;
    const body = await request.json() as Record<string, unknown>;
    const workOrderId = typeof body.workOrderId === "string" ? body.workOrderId.trim() : "";
    const action = typeof body.action === "string" ? body.action.trim().toUpperCase() : "";
    const target = ACTION_TARGET[action];
    if (!workOrderId || !target) return NextResponse.json({ ok: false, error: "Некоректна виробнича дія." }, { status: 400 });
    if (!(await workOrderAllowedForScope(workOrderId, request, access.context))) {
      return NextResponse.json({ ok: false, error: "Цей наряд не входить до Вашого виробничого контуру." }, { status: 403 });
    }

    const actorName = access.context.user?.employeeName || access.context.user?.name || "CRM / Виробництво";
    const workOrder = await transitionWorkOrder(workOrderId, target, actorName);
    return NextResponse.json({ ok: true, workOrder });
  } catch (error) {
    if (error instanceof WorkOrderNotFoundError) return NextResponse.json({ ok: false, error: "Замовлення-наряд не знайдено." }, { status: 404 });
    if (error instanceof WorkOrderTransitionError) {
      const missing = error.decision.missingGates || [];
      return NextResponse.json({
        ok: false,
        error: missing.length ? "Дію поки заблоковано: не виконані обов’язкові умови ремонту." : "Ця дія недоступна з поточного статусу.",
        code: error.decision.code,
        missingGates: missing,
      }, { status: 409 });
    }
    console.error("PATCH /api/production failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "Не вдалося змінити стан ремонту." }, { status: 500 });
  }
}
