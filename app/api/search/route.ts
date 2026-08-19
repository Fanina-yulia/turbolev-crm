import { NextRequest, NextResponse } from "next/server";
import { formatWorkOrderNumber, parseWorkOrderNumber } from "@/src/domain/work-order-number";
import { getWorkflowStatusLabel } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission, type AccessContext } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RESULT_LIMIT = 6;
const CANDIDATE_LIMIT = 24;

function compact(value: string) {
  return value.toUpperCase().replace(/[\s._-]+/g, "");
}

function digits(value: string) {
  return value.replace(/\D+/g, "");
}

function workOrderScope(context: AccessContext) {
  return context.permissions[PERMISSIONS.WORK_ORDERS_READ] as AccessScopeCode | undefined;
}

async function filterWorkOrdersByScope<T extends { id: string }>(rows: T[], context: AccessContext) {
  if (context.enforcementMode !== "ENFORCED") return rows;
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
    return NextResponse.json({ ok: true, query: q, clients: [], vehicles: [], workOrders: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const context = await getAccessContext(request);
  const canClients = context.enforcementMode !== "ENFORCED" || hasPermission(context, PERMISSIONS.CLIENTS_READ);
  const canWorkOrders = context.enforcementMode !== "ENFORCED" || hasPermission(context, PERMISSIONS.WORK_ORDERS_READ);

  if (context.enforcementMode === "ENFORCED" && context.provisioningState !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: context.authenticated ? "Доступ до CRM не активований." : "Потрібна авторизація." }, { status: context.authenticated ? 403 : 401 });
  }
  if (!canClients && !canWorkOrders) {
    return NextResponse.json({ ok: false, error: "Для глобального пошуку немає доступних типів даних." }, { status: 403 });
  }

  const prisma = getPrisma();
  const normalized = compact(q);
  const phoneNeedle = digits(q);

  try {
    const clientsPromise = canClients
      ? prisma.client.findMany({
          where: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              ...(phoneNeedle.length >= 3 ? [{ phone: { contains: phoneNeedle } }] : []),
              { vehicles: { some: { plateNumber: { contains: normalized, mode: "insensitive" } } } },
              { vehicles: { some: { vin: { contains: normalized, mode: "insensitive" } } } },
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
              { plateNumber: { contains: normalized, mode: "insensitive" } },
              { vin: { contains: normalized, mode: "insensitive" } },
              { client: { is: { name: { contains: q, mode: "insensitive" } } } },
              ...(phoneNeedle.length >= 3 ? [{ client: { is: { phone: { contains: phoneNeedle } } } }] : []),
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

    const exactNumberPromise = canWorkOrders && parsedNumber != null
      ? prisma.workOrderNumber.findUnique({ where: { number: parsedNumber }, select: { workOrderId: true, number: true } })
      : Promise.resolve(null);

    const [clients, vehicles, exactNumber] = await Promise.all([clientsPromise, vehiclesPromise, exactNumberPromise]);

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
            ...(exactNumber?.workOrderId ? [{ id: exactNumber.workOrderId }] : []),
            { client: { is: { name: { contains: q, mode: "insensitive" } } } },
            ...(phoneNeedle.length >= 3 ? [{ client: { is: { phone: { contains: phoneNeedle } } } }] : []),
            { vehicle: { is: { plateNumber: { contains: normalized, mode: "insensitive" } } } },
            { vehicle: { is: { vin: { contains: normalized, mode: "insensitive" } } } },
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
      capabilities: { clients: canClients, workOrders: canWorkOrders },
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
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/search failed", { query: q, message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося виконати глобальний пошук." }, { status: 500 });
  }
}
