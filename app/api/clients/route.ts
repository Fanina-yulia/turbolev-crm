import { NextRequest, NextResponse } from "next/server";
import { PlannerAppointmentStatus } from "@/src/generated/prisma/client";
import { toClientDirectoryItem } from "@/src/lib/contracts/crm-core.server";
import { getPrisma } from "@/src/lib/prisma";
import { getVehicleLifecycleMap } from "@/src/services/vehicle-lifecycle.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

const clientSelect = {
  id: true,
  name: true,
  phone: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { vehicles: true, workOrders: true, diagnosticRequests: true } },
  workOrders: {
    orderBy: { updatedAt: "desc" as const },
    take: 10,
    select: { id: true, status: true, createdAt: true, updatedAt: true, closedAt: true },
  },
  vehicles: {
    orderBy: { updatedAt: "desc" as const },
    select: {
      id: true,
      plateNumber: true,
      vin: true,
      brand: true,
      model: true,
      year: true,
    },
  },
} as const;

const NON_CLIENT_APPOINTMENT_STATUSES: PlannerAppointmentStatus[] = [
  PlannerAppointmentStatus.RESERVE,
  PlannerAppointmentStatus.CANCELLED,
  PlannerAppointmentStatus.NO_SHOW,
];

const qualifyingAppointmentWhere = {
  clientId: { not: null },
  vehicleId: { not: null },
  status: { notIn: NON_CLIENT_APPOINTMENT_STATUSES },
} as const;

function withVehicleLifecycle<T extends ReturnType<typeof toClientDirectoryItem>>(
  client: T,
  lifecycleMap: Awaited<ReturnType<typeof getVehicleLifecycleMap>>,
) {
  return {
    ...client,
    vehicles: client.vehicles.map((vehicle) => ({
      ...vehicle,
      lifecycle: lifecycleMap.get(vehicle.id) || null,
    })),
  };
}

export async function GET(request: NextRequest) {
  const prisma = getPrisma();
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  const id = (request.nextUrl.searchParams.get("id") || "").trim();
  const limit = clampInt(request.nextUrl.searchParams.get("limit"), 24, 1, 100);
  const page = clampInt(request.nextUrl.searchParams.get("page"), 1, 1, 100_000);

  try {
    if (id) {
      const qualifyingAppointment = await prisma.serviceAppointment.findFirst({
        where: { ...qualifyingAppointmentWhere, clientId: id },
        select: { id: true },
      });
      if (!qualifyingAppointment) {
        return NextResponse.json({ ok: false, error: "Клієнта не знайдено." }, { status: 404 });
      }
      const client = await prisma.client.findUnique({ where: { id }, select: clientSelect });
      if (!client) return NextResponse.json({ ok: false, error: "Клієнта не знайдено." }, { status: 404 });
      const mapped = toClientDirectoryItem(client);
      const lifecycleMap = await getVehicleLifecycleMap(mapped.vehicles.map((vehicle) => vehicle.id));
      return NextResponse.json(
        { ok: true, client: withVehicleLifecycle(mapped, lifecycleMap) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // The client directory is intentionally narrower than the raw Client table.
    // A contact becomes a CRM client here only after an actual vehicle is linked
    // and that vehicle/client pair has entered the service planner.
    const plannedClients = await prisma.serviceAppointment.findMany({
      where: qualifyingAppointmentWhere,
      distinct: ["clientId"],
      select: { clientId: true },
    });
    const plannedClientIds = plannedClients.flatMap((row) => row.clientId ? [row.clientId] : []);

    if (!plannedClientIds.length) {
      return NextResponse.json(
        { ok: true, total: 0, page: 1, limit, pages: 1, clients: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const where = {
      id: { in: plannedClientIds },
      vehicles: { some: {} },
      ...(q ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q } },
          { vehicles: { some: { plateNumber: { contains: q, mode: "insensitive" as const } } } },
          { vehicles: { some: { vin: { contains: q, mode: "insensitive" as const } } } },
          { vehicles: { some: { brand: { contains: q, mode: "insensitive" as const } } } },
          { vehicles: { some: { model: { contains: q, mode: "insensitive" as const } } } },
        ],
      } : {}),
    };

    const total = await prisma.client.count({ where });
    const pages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, pages);
    const clients = await prisma.client.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: (safePage - 1) * limit,
      take: limit,
      select: clientSelect,
    });
    const mappedClients = clients.map(toClientDirectoryItem);
    const lifecycleMap = await getVehicleLifecycleMap(mappedClients.flatMap((client) => client.vehicles.map((vehicle) => vehicle.id)));

    return NextResponse.json(
      { ok: true, total, page: safePage, limit, pages, clients: mappedClients.map((client) => withVehicleLifecycle(client, lifecycleMap)) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("clients GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити клієнтів." }, { status: 500 });
  }
}
