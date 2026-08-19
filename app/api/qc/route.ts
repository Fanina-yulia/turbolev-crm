import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission, type AccessContext } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";
import { updateQualityControl, WorkOrderQualityError } from "@/src/services/work-order-qc.service";
import { transitionWorkOrder, WorkOrderNotFoundError, WorkOrderTransitionError } from "@/src/services/work-orders.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ACTIVE_WORK_ORDER_STATUSES = ["WAITING_QC", "REWORK", "READY_FOR_PICKUP", "WAITING_PAYMENT", "CLOSED"] as const;

function scopeRank(scope: AccessScopeCode | undefined) {
  return scope === "ALL" ? 5 : scope === "LOCATION" ? 4 : scope === "TEAM" ? 3 : scope === "ASSIGNED" ? 2 : scope === "SELF" ? 1 : 0;
}

function dateKey(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

async function verifyQcAccess(request: Request, write = false) {
  const context = await getAccessContext(request);
  const permission = write ? PERMISSIONS.QC_WRITE : PERMISSIONS.QC_READ;
  if (context.enforcementMode === "ENFORCED") {
    if (!context.authenticated) return { context, error: NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 }) };
    if (context.provisioningState !== "ACTIVE" || !context.user) return { context, error: NextResponse.json({ ok: false, error: "ACCESS_PROFILE_INACTIVE" }, { status: 403 }) };
    if (!hasPermission(context, permission)) return { context, error: NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }) };
  }
  return { context, error: null };
}

async function resolveQcScope(request: Request, context: AccessContext) {
  const prisma = getPrisma();
  const url = new URL(request.url);
  const requestedLocationId = url.searchParams.get("locationId")?.trim() || null;
  const qcScope = context.permissions[PERMISSIONS.QC_READ] as AccessScopeCode | undefined;
  const activeUser = context.provisioningState === "ACTIVE" && context.user ? context.user : null;
  const canSeeAll = !activeUser || scopeRank(qcScope) >= scopeRank("ALL");
  const allowedIds = new Set(context.locationIds);
  const allLocations = await prisma.serviceLocation.findMany({
    where: { isActive: true },
    select: { id: true, name: true, timezone: true },
    orderBy: { sortOrder: "asc" },
  });
  const visibleLocations = canSeeAll ? allLocations : allLocations.filter((location) => allowedIds.has(location.id));
  const locationId = requestedLocationId && visibleLocations.some((location) => location.id === requestedLocationId)
    ? requestedLocationId
    : visibleLocations[0]?.id ?? null;
  return { locationId, locations: visibleLocations };
}

async function workOrderBelongsToLocation(workOrderId: string, locationId: string) {
  const row = await getPrisma().serviceAppointment.findFirst({ where: { workOrderId, locationId }, select: { id: true } });
  return Boolean(row);
}

function transitionWarning(error: unknown) {
  if (error instanceof WorkOrderTransitionError) {
    return {
      code: error.decision.code,
      message: error.decision.missingGates.length
        ? "Результат QC збережено, але перехід ЗН заблокований обов’язковою умовою."
        : "Результат QC збережено, але поточний статус ЗН не дозволяє автоматичний перехід.",
      missingGates: error.decision.missingGates,
    };
  }
  if (error instanceof WorkOrderNotFoundError) return { code: "WORK_ORDER_NOT_FOUND", message: "Результат QC збережено, але ЗН не знайдено для переходу." };
  return { code: "TRANSITION_FAILED", message: "Результат QC збережено, але статус ЗН не вдалося змінити автоматично." };
}

export async function GET(request: Request) {
  try {
    const access = await verifyQcAccess(request, false);
    if (access.error) return access.error;
    const prisma = getPrisma();
    const scope = await resolveQcScope(request, access.context);
    if (!scope.locationId) {
      return NextResponse.json({ ok: true, location: null, locations: [], cards: [], canWrite: false }, { headers: { "Cache-Control": "no-store" } });
    }
    const location = scope.locations.find((item) => item.id === scope.locationId)!;
    const appointments = await prisma.serviceAppointment.findMany({
      where: { locationId: scope.locationId, workOrderId: { not: null } },
      select: {
        workOrderId: true,
        plannedStartAt: true,
        post: { select: { id: true, name: true } },
        mechanic: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 600,
    });
    const appointmentMap = new Map<string, (typeof appointments)[number]>();
    for (const appointment of appointments) {
      if (appointment.workOrderId && !appointmentMap.has(appointment.workOrderId)) appointmentMap.set(appointment.workOrderId, appointment);
    }
    const workOrderIds = [...appointmentMap.keys()];
    if (!workOrderIds.length) {
      return NextResponse.json({ ok: true, location, locations: scope.locations, cards: [], canWrite: access.context.enforcementMode !== "ENFORCED" || hasPermission(access.context, PERMISSIONS.QC_WRITE) }, { headers: { "Cache-Control": "no-store" } });
    }

    const [workOrders, attempts, numberRows] = await Promise.all([
      prisma.workOrder.findMany({
        where: { id: { in: workOrderIds }, status: { in: [...ACTIVE_WORK_ORDER_STATUSES] } },
        select: {
          id: true,
          status: true,
          updatedAt: true,
          vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true } },
          diagnosticRequest: { select: { technicalConclusion: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 500,
      }),
      prisma.workOrderQualityControl.findMany({
        where: { workOrderId: { in: workOrderIds } },
        orderBy: [{ attempt: "desc" }, { createdAt: "desc" }],
        take: 1200,
      }),
      prisma.workOrderNumber.findMany({ where: { workOrderId: { in: workOrderIds } }, select: { workOrderId: true, number: true } }),
    ]);

    const latestByWorkOrder = new Map<string, (typeof attempts)[number]>();
    for (const attempt of attempts) if (!latestByWorkOrder.has(attempt.workOrderId)) latestByWorkOrder.set(attempt.workOrderId, attempt);
    const numberMap = new Map(numberRows.map((item) => [item.workOrderId, item.number]));
    const today = dateKey(new Date(), location.timezone || "Europe/Kyiv");

    const cards = workOrders.flatMap((workOrder) => {
      const latest = latestByWorkOrder.get(workOrder.id) ?? null;
      const passedToday = Boolean(latest?.status === "PASSED" && latest.completedAt && dateKey(latest.completedAt, location.timezone || "Europe/Kyiv") === today);
      const relevant = workOrder.status === "WAITING_QC" || workOrder.status === "REWORK" || passedToday;
      if (!relevant) return [];
      const appointment = appointmentMap.get(workOrder.id) ?? null;
      const category = latest?.status === "IN_PROGRESS"
        ? "IN_PROGRESS"
        : latest?.status === "FAILED" || workOrder.status === "REWORK"
          ? "FAILED"
          : latest?.status === "PASSED"
            ? "PASSED"
            : "WAITING";
      return [{
        id: workOrder.id,
        number: numberMap.get(workOrder.id) ?? null,
        workOrderStatus: workOrder.status,
        category,
        plate: workOrder.vehicle.plateNumber || "—",
        vehicle: vehicleLabel(workOrder.vehicle),
        vehicleId: workOrder.vehicle.id,
        problem: workOrder.diagnosticRequest.technicalConclusion,
        post: appointment?.post ?? null,
        mechanic: appointment?.mechanic ?? null,
        plannedStartAt: appointment?.plannedStartAt ?? null,
        attempt: latest?.attempt ?? 1,
        qcStatus: latest?.status ?? "PENDING",
        performedByName: latest?.performedByName ?? null,
        resultNote: latest?.resultNote ?? null,
        startedAt: latest?.startedAt ?? null,
        completedAt: latest?.completedAt ?? null,
        updatedAt: latest?.updatedAt ?? workOrder.updatedAt,
      }];
    });

    return NextResponse.json({
      ok: true,
      location,
      locations: scope.locations,
      cards,
      canWrite: access.context.enforcementMode !== "ENFORCED" || hasPermission(access.context, PERMISSIONS.QC_WRITE),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/qc failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити чергу контролю якості." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const access = await verifyQcAccess(request, true);
    if (access.error) return access.error;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const workOrderId = typeof body.workOrderId === "string" ? body.workOrderId.trim() : "";
    const action = typeof body.action === "string" ? body.action.trim().toUpperCase() : "";
    if (!workOrderId || !["START", "PASS", "FAIL", "RECHECK", "MOVE_PICKUP", "MOVE_REWORK"].includes(action)) {
      return NextResponse.json({ ok: false, error: "Некоректна дія контролю якості." }, { status: 400 });
    }
    const scope = await resolveQcScope(request, access.context);
    if (!scope.locationId || !(await workOrderBelongsToLocation(workOrderId, scope.locationId))) {
      return NextResponse.json({ ok: false, error: "Цей ЗН не входить до Вашого контуру контролю якості." }, { status: 403 });
    }
    const actorName = access.context.user?.employeeName || access.context.user?.name || "CRM / Контроль якості";
    const performedByName = typeof body.performedByName === "string" ? body.performedByName.trim().slice(0, 160) : actorName;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 4000) : "";

    if (action === "MOVE_PICKUP" || action === "MOVE_REWORK") {
      const target = action === "MOVE_PICKUP" ? "READY_FOR_PICKUP" : "REWORK";
      const workOrder = await transitionWorkOrder(workOrderId, target, actorName);
      return NextResponse.json({ ok: true, workOrder });
    }

    const qualityControl = await updateQualityControl(workOrderId, { action, performedByName, note }, actorName);
    let workOrder = null;
    let warning = null;
    if (action === "PASS" || action === "FAIL") {
      try {
        workOrder = await transitionWorkOrder(workOrderId, action === "PASS" ? "READY_FOR_PICKUP" : "REWORK", actorName);
      } catch (error) {
        warning = transitionWarning(error);
      }
    }
    return NextResponse.json({ ok: true, qualityControl, workOrder, warning });
  } catch (error) {
    if (error instanceof WorkOrderQualityError) return NextResponse.json({ ok: false, code: error.code, error: "Ця дія QC недоступна з поточного стану перевірки." }, { status: error.code === "WORK_ORDER_NOT_FOUND" ? 404 : 409 });
    if (error instanceof WorkOrderNotFoundError) return NextResponse.json({ ok: false, error: "Замовлення-наряд не знайдено." }, { status: 404 });
    if (error instanceof WorkOrderTransitionError) return NextResponse.json({ ok: false, code: error.decision.code, error: "Перехід ЗН заблокований поточним workflow або обов’язковими умовами.", missingGates: error.decision.missingGates }, { status: 409 });
    console.error("POST /api/qc failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "Не вдалося виконати дію контролю якості." }, { status: 500 });
  }
}
