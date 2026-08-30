import { NextRequest, NextResponse } from "next/server";
import { formatWorkOrderNumber, parseWorkOrderNumber } from "@/src/domain/work-order-number";
import { getWorkflowStatusLabel } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import { hasPermission, type AccessContext } from "@/src/security/access-context";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS, type AccessScopeCode, type PermissionCode } from "@/src/security/permissions";
import { identitySearchValues } from "@/src/lib/search-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RESULT_LIMIT = 6;
const CANDIDATE_LIMIT = 24;
const ENTITY_ID = /^[A-Za-z0-9_-]{12,}$/;

function diagnosticStatusLabel(status: string) {
  if (status === "PENDING") return "Очікує";
  if (status === "IN_PROGRESS") return "В роботі";
  if (status === "CONFIRMED") return "Підтверджена";
  if (status === "CANCELLED") return "Скасована";
  return status;
}

function appointmentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    BOOKED: "Записаний",
    ARRIVED: "Приїхав",
    DIAGNOSTICS: "Діагностика",
    WAITING_PARTS_SELECTION: "Підбір деталей",
    WAITING_CALCULATION: "Калькуляція",
    WAITING_APPROVAL: "Погодження",
    WAITING_PARTS: "Очікує деталі",
    READY_FOR_REPAIR: "Готовий до ремонту",
    IN_REPAIR: "У ремонті",
    WAITING_QC: "Контроль якості",
    WAITING_PAYMENT: "Очікує оплату",
    READY_FOR_PICKUP: "Готовий до видачі",
    COMPLETED: "Виданий",
    WARRANTY: "Гарантія",
    PAUSED: "Пауза",
    NO_SHOW: "Не приїхав",
    CANCELLED: "Скасовано",
    RESERVE: "Резерв",
  };
  return labels[status] || status;
}

function permissionScope(context: AccessContext, permission: PermissionCode) {
  return context.permissions[permission] as AccessScopeCode | undefined;
}

function workOrderScope(context: AccessContext) {
  return permissionScope(context, PERMISSIONS.WORK_ORDERS_READ);
}

async function currentMechanicIds(context: AccessContext) {
  const identities = [
    context.user?.id ? { userId: context.user.id } : null,
    context.user?.employeeId ? { employeeId: context.user.employeeId } : null,
  ].filter((value): value is { userId: string } | { employeeId: string } => Boolean(value));
  if (!identities.length) return [] as string[];

  const rows = await getPrisma().serviceMechanic.findMany({
    where: {
      OR: identities,
      ...(context.locationIds.length ? { locationId: { in: context.locationIds } } : {}),
    },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

async function plannerScopeWhere(context: AccessContext) {
  const scope = permissionScope(context, PERMISSIONS.PLANNER_READ);
  if (!scope) return { id: { in: [] as string[] } };
  if (scope === "ALL") return {};
  if (scope === "LOCATION" || scope === "TEAM") {
    return context.locationIds.length
      ? { locationId: { in: context.locationIds } }
      : { id: { in: [] as string[] } };
  }
  const mechanicIds = await currentMechanicIds(context);
  return { mechanicId: { in: mechanicIds } };
}

async function diagnosticScopeWhere(context: AccessContext) {
  const scope = permissionScope(context, PERMISSIONS.DIAGNOSTICS_READ);
  if (!scope) return { id: { in: [] as string[] } };
  if (scope === "ALL") return {};

  const prisma = getPrisma();
  if (scope === "LOCATION" || scope === "TEAM") {
    if (!context.locationIds.length) return { id: { in: [] as string[] } };
    const assignments = await prisma.diagnosticAssignment.findMany({
      where: { locationId: { in: context.locationIds } },
      select: { diagnosticRequestId: true },
    });
    return { id: { in: assignments.map((row) => row.diagnosticRequestId) } };
  }

  const mechanicIds = await currentMechanicIds(context);
  if (!mechanicIds.length) return { id: { in: [] as string[] } };
  const assignments = await prisma.diagnosticAssignment.findMany({
    where: { mechanicId: { in: mechanicIds } },
    select: { diagnosticRequestId: true },
  });
  return { id: { in: assignments.map((row) => row.diagnosticRequestId) } };
}

async function filterWorkOrdersByScope<T extends { id: string }>(rows: T[], context: AccessContext) {
  const scope = workOrderScope(context);
  if (!scope || !rows.length) return [];
  if (scope === "ALL") return rows;

  const ids = rows.map((row) => row.id);
  const baseWhere = { workOrderId: { in: ids } } as const;
  const prisma = getPrisma();

  if (scope === "LOCATION" || scope === "TEAM") {
    if (!context.locationIds.length) return [];
    const visible = await prisma.serviceAppointment.findMany({
      where: { ...baseWhere, locationId: { in: context.locationIds } },
      select: { workOrderId: true },
      distinct: ["workOrderId"],
    });
    const allowed = new Set(visible.map((row) => row.workOrderId).filter((id): id is string => Boolean(id)));
    return rows.filter((row) => allowed.has(row.id));
  }
  const identityFilters = [
    context.user?.id ? { mechanic: { is: { userId: context.user.id } } } : null,
    context.user?.employeeId ? { mechanic: { is: { employeeId: context.user.employeeId } } } : null,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  if (!identityFilters.length) return [];

  const visible = await prisma.serviceAppointment.findMany({
    where: {
      ...baseWhere,
      ...(context.locationIds.length ? { locationId: { in: context.locationIds } } : {}),
      OR: identityFilters,
    },
    select: { workOrderId: true },
    distinct: ["workOrderId"],
  });
  const allowed = new Set(visible.map((row) => row.workOrderId).filter((id): id is string => Boolean(id)));
  return rows.filter((row) => allowed.has(row.id));
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") || "").trim().slice(0, 120);
  const parsedNumber = parseWorkOrderNumber(q);
  if (!q || (q.length < 2 && parsedNumber == null)) {
    return NextResponse.json({ ok: true, query: q, clients: [], vehicles: [], workOrders: [], diagnostics: [], appointments: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const access = await authorize(PERMISSIONS.OVERVIEW_READ, { request, strict: true, minimumScope: "SELF" });
  if (!access.allowed) return access.response!;
  const context = access.context;
  const canClients = hasPermission(context, PERMISSIONS.CLIENTS_READ);
  const canWorkOrders = hasPermission(context, PERMISSIONS.WORK_ORDERS_READ);
  const canDiagnostics = hasPermission(context, PERMISSIONS.DIAGNOSTICS_READ);
  const canPlanner = hasPermission(context, PERMISSIONS.PLANNER_READ);

  if (!canClients && !canWorkOrders && !canDiagnostics && !canPlanner) {
    return NextResponse.json({ ok: false, error: "Для глобального пошуку немає доступних типів даних." }, { status: 403 });
  }

  const prisma = getPrisma();
  const identity = identitySearchValues(q);
  const phoneNeedles = identity.phoneValues;
  const plateNeedles = identity.plateValues;
  const exactEntityId = ENTITY_ID.test(q) ? q : null;

  try {
    const [plannerWhere, diagnosticWhere] = await Promise.all([
      canPlanner ? plannerScopeWhere(context) : Promise.resolve({ id: { in: [] as string[] } }),
      canDiagnostics ? diagnosticScopeWhere(context) : Promise.resolve({ id: { in: [] as string[] } }),
    ]);

    const clientsPromise = canClients
      ? prisma.client.findMany({
          where: {
            OR: [
              ...(exactEntityId ? [{ id: exactEntityId }] : []),
              { name: { contains: q, mode: "insensitive" } },
              ...(phoneNeedles.length ? phoneNeedles.flatMap((value) => [
                { phone: { contains: value } },
                { phoneNormalized: { contains: value } },
                { phones: { some: { phoneNormalized: { contains: value } } } },
              ]) : []),
              ...(plateNeedles.length ? plateNeedles.map((value) => ({ vehicles: { some: { plateNumber: { contains: value, mode: "insensitive" as const } } } })) : []),
              ...(identity.plateNormalized ? [{ vehicles: { some: { plateNormalized: { contains: identity.plateNormalized, mode: "insensitive" as const } } } }] : []),
              ...(identity.vin ? [{ vehicles: { some: { vin: { contains: identity.vin, mode: "insensitive" as const } } } }] : []),
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: RESULT_LIMIT,
          select: {
            id: true,
            name: true,
            phone: true,
            vehicles: {
              orderBy: { updatedAt: "desc" },
              take: 2,
              select: { id: true, plateNumber: true, brand: true, model: true },
            },
          },
        })
      : Promise.resolve([]);

    const vehiclesPromise = canClients
      ? prisma.vehicle.findMany({
          where: {
            OR: [
              ...(exactEntityId ? [{ id: exactEntityId }] : []),
              ...(plateNeedles.length ? plateNeedles.map((value) => ({ plateNumber: { contains: value, mode: "insensitive" as const } })) : []),
              ...(identity.plateNormalized ? [{ plateNormalized: { contains: identity.plateNormalized, mode: "insensitive" as const } }] : []),
              ...(identity.vin ? [{ vin: { contains: identity.vin, mode: "insensitive" as const } }] : []),
              { client: { is: { name: { contains: q, mode: "insensitive" } } } },
              ...(phoneNeedles.length ? phoneNeedles.flatMap((value) => [
                { client: { is: { phone: { contains: value } } } },
                { client: { is: { phoneNormalized: { contains: value } } } },
                { client: { is: { phones: { some: { phoneNormalized: { contains: value } } } } } },
              ]) : []),
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: RESULT_LIMIT,
          select: {
            id: true,
            plateNumber: true,
            vin: true,
            brand: true,
            model: true,
            year: true,
            client: { select: { id: true, name: true, phone: true } },
          },
        })
      : Promise.resolve([]);

    const diagnosticsPromise = canDiagnostics
      ? prisma.diagnosticRequest.findMany({
          where: {
            ...diagnosticWhere,
            OR: [
              ...(exactEntityId ? [{ id: exactEntityId }] : []),
              { technicalConclusion: { contains: q, mode: "insensitive" } },
              { client: { is: { name: { contains: q, mode: "insensitive" } } } },
              ...(phoneNeedles.length ? phoneNeedles.flatMap((value) => [
                { client: { is: { phone: { contains: value } } } },
                { client: { is: { phoneNormalized: { contains: value } } } },
                { client: { is: { phones: { some: { phoneNormalized: { contains: value } } } } } },
              ]) : []),
              ...(plateNeedles.length ? plateNeedles.map((value) => ({ vehicle: { is: { plateNumber: { contains: value, mode: "insensitive" as const } } } })) : []),
              ...(identity.plateNormalized ? [{ vehicle: { is: { plateNormalized: { contains: identity.plateNormalized, mode: "insensitive" as const } } } }] : []),
              ...(identity.vin ? [{ vehicle: { is: { vin: { contains: identity.vin, mode: "insensitive" as const } } } }] : []),
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: RESULT_LIMIT,
          select: {
            id: true,
            status: true,
            updatedAt: true,
            technicalConclusion: true,
            client: { select: { id: true, name: true, phone: true } },
            vehicle: { select: { id: true, plateNumber: true, vin: true, brand: true, model: true, year: true } },
          },
        })
      : Promise.resolve([]);

    const appointmentsPromise = canPlanner
      ? prisma.serviceAppointment.findMany({
          where: {
            ...plannerWhere,
            OR: [
              ...(exactEntityId ? [{ id: exactEntityId }] : []),
              { customerName: { contains: q, mode: "insensitive" } },
              ...(phoneNeedles.length ? phoneNeedles.map((value) => ({ phone: { contains: value } })) : []),
              { vehicleLabel: { contains: q, mode: "insensitive" } },
              ...(plateNeedles.length ? plateNeedles.map((value) => ({ plateNumber: { contains: value, mode: "insensitive" as const } })) : []),
              { problem: { contains: q, mode: "insensitive" } },
            ],
          },
          orderBy: { plannedStartAt: "desc" },
          take: RESULT_LIMIT,
          select: {
            id: true,
            status: true,
            customerName: true,
            phone: true,
            vehicleLabel: true,
            plateNumber: true,
            problem: true,
            plannedStartAt: true,
            clientId: true,
            vehicleId: true,
            location: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]);

    const exactNumberPromise = canWorkOrders && parsedNumber != null
      ? prisma.workOrderNumber.findUnique({ where: { number: parsedNumber }, select: { workOrderId: true, number: true } })
      : Promise.resolve(null);

    const [clients, vehicles, diagnostics, appointments, exactNumber] = await Promise.all([
      clientsPromise,
      vehiclesPromise,
      diagnosticsPromise,
      appointmentsPromise,
      exactNumberPromise,
    ]);

    let workOrders: Array<{
      id: string;
      status: string;
      updatedAt: Date;
      client: { id: string; name: string | null; phone: string };
      vehicle: { id: string; plateNumber: string | null; vin: string | null; brand: string | null; model: string | null; year: number | null };
    }> = [];

    if (canWorkOrders) {
      workOrders = await prisma.workOrder.findMany({
        where: {
          OR: [
            ...(exactEntityId ? [{ id: exactEntityId }] : []),
            ...(exactNumber?.workOrderId ? [{ id: exactNumber.workOrderId }] : []),
            { client: { is: { name: { contains: q, mode: "insensitive" } } } },
            ...(phoneNeedles.length ? phoneNeedles.flatMap((value) => [
              { client: { is: { phone: { contains: value } } } },
              { client: { is: { phoneNormalized: { contains: value } } } },
              { client: { is: { phones: { some: { phoneNormalized: { contains: value } } } } } },
            ]) : []),
            ...(plateNeedles.length ? plateNeedles.map((value) => ({ vehicle: { is: { plateNumber: { contains: value, mode: "insensitive" as const } } } })) : []),
            ...(identity.plateNormalized ? [{ vehicle: { is: { plateNormalized: { contains: identity.plateNormalized, mode: "insensitive" as const } } } }] : []),
            ...(identity.vin ? [{ vehicle: { is: { vin: { contains: identity.vin, mode: "insensitive" as const } } } }] : []),
          ],
        },
        orderBy: { updatedAt: "desc" },
        take: CANDIDATE_LIMIT,
        select: {
          id: true,
          status: true,
          updatedAt: true,
          client: { select: { id: true, name: true, phone: true } },
          vehicle: { select: { id: true, plateNumber: true, vin: true, brand: true, model: true, year: true } },
        },
      });
      workOrders = (await filterWorkOrdersByScope(workOrders, context)).slice(0, RESULT_LIMIT);
    }

    const numberRows = workOrders.length
      ? await prisma.workOrderNumber.findMany({
          where: { workOrderId: { in: workOrders.map((row) => row.id) } },
          select: { workOrderId: true, number: true },
        })
      : [];
    const numbers = new Map(numberRows.map((row) => [row.workOrderId, row.number]));

    return NextResponse.json({
      ok: true,
      query: q,
      capabilities: { clients: canClients, workOrders: canWorkOrders, diagnostics: canDiagnostics, planner: canPlanner },
      clients: clients.map((client) => ({
        id: client.id,
        name: client.name,
        phone: client.phone,
        vehicles: client.vehicles,
      })),
      vehicles,
      workOrders: workOrders.map((row) => ({
        id: row.id,
        number: numbers.get(row.id) ?? null,
        numberLabel: formatWorkOrderNumber(numbers.get(row.id)),
        status: row.status,
        statusLabel: getWorkflowStatusLabel("WORK_ORDER", row.status),
        updatedAt: row.updatedAt,
        client: row.client,
        vehicle: row.vehicle,
      })),
      diagnostics: diagnostics.map((row) => ({
        ...row,
        statusLabel: diagnosticStatusLabel(row.status),
      })),
      appointments: appointments.map((row) => ({
        ...row,
        statusLabel: appointmentStatusLabel(row.status),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/search failed", { query: q, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося виконати глобальний пошук." }, { status: 500 });
  }
}
