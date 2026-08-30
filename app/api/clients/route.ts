import { NextRequest, NextResponse } from "next/server";
import { toClientDirectoryItem } from "@/src/lib/contracts/crm-core.server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { identitySearchValues } from "@/src/lib/search-identity";

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

const vehicleOwnerWhere = {
  vehicles: { some: {} },
} as const;

async function scopedClientIds(
  scope: string | null,
  context: Awaited<ReturnType<typeof authorize>>["context"],
) {
  if (scope === "ALL") return null;
  const prisma = getPrisma();
  const ids = new Set<string>();

  if (scope === "LOCATION") {
    if (!context.locationIds.length) return [];
    const [appointments, assignments] = await Promise.all([
      prisma.serviceAppointment.findMany({
        where: { locationId: { in: context.locationIds }, clientId: { not: null } },
        select: { clientId: true },
        distinct: ["clientId"],
        take: 5000,
      }),
      prisma.diagnosticAssignment.findMany({
        where: { locationId: { in: context.locationIds } },
        select: { diagnosticRequestId: true },
        take: 5000,
      }),
    ]);
    for (const row of appointments) if (row.clientId) ids.add(row.clientId);
    if (assignments.length) {
      const diagnostics = await prisma.diagnosticRequest.findMany({
        where: { id: { in: assignments.map((row) => row.diagnosticRequestId) } },
        select: { clientId: true },
        distinct: ["clientId"],
        take: 5000,
      });
      for (const row of diagnostics) ids.add(row.clientId);
    }
    return [...ids];
  }

  if (scope === "TEAM") {
    const userId = context.user?.id;
    if (!userId) return [];
    const [leadPhones, appointments, calls, diagnostics] = await Promise.all([
      prisma.lead.findMany({
        where: { assignedUserId: userId },
        select: { phoneNormalized: true },
        distinct: ["phoneNormalized"],
        take: 5000,
      }),
      prisma.serviceAppointment.findMany({
        where: { createdById: userId, clientId: { not: null } },
        select: { clientId: true },
        distinct: ["clientId"],
        take: 5000,
      }),
      prisma.callHistory.findMany({
        where: { managerId: userId, clientId: { not: null } },
        select: { clientId: true },
        distinct: ["clientId"],
        take: 5000,
      }),
      prisma.diagnosticRequest.findMany({
        where: { lead: { assignedUserId: userId } },
        select: { clientId: true },
        distinct: ["clientId"],
        take: 5000,
      }),
    ]);
    for (const row of appointments) if (row.clientId) ids.add(row.clientId);
    for (const row of calls) if (row.clientId) ids.add(row.clientId);
    for (const row of diagnostics) ids.add(row.clientId);
    const phones = leadPhones.map((row) => row.phoneNormalized).filter(Boolean);
    if (phones.length) {
      const clients = await prisma.client.findMany({
        where: { phoneNormalized: { in: phones } },
        select: { id: true },
        take: 5000,
      });
      for (const row of clients) ids.add(row.id);
    }
    return [...ids];
  }

  return [];
}

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.CLIENTS_READ, { strict: true, request, minimumScope: "TEAM" });
  if (!access.allowed) return access.response!;

  const prisma = getPrisma();
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  const identity = identitySearchValues(q);
  const id = (request.nextUrl.searchParams.get("id") || "").trim();
  const limit = clampInt(request.nextUrl.searchParams.get("limit"), 24, 1, 100);
  const page = clampInt(request.nextUrl.searchParams.get("page"), 1, 1, 100_000);

  try {
    const allowedClientIds = await scopedClientIds(access.grantedScope, access.context);
    const scopeWhere = allowedClientIds === null ? {} : { id: { in: allowedClientIds } };

    if (id) {
      const client = await prisma.client.findFirst({
        where: { AND: [{ id }, vehicleOwnerWhere, scopeWhere] },
        select: clientSelect,
      });
      if (!client) return NextResponse.json({ ok: false, error: "Клієнта не знайдено." }, { status: 404 });
      return NextResponse.json(
        { ok: true, client: toClientDirectoryItem(client) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // A contact belongs in the client directory as soon as an actual vehicle is
    // linked to that Client. Call-only / price-only contacts without a vehicle
    // stay in Communications/Leads and do not pollute the customer directory.
    const queryWhere = q ? {
      OR: [
        { name: { contains: q, mode: "insensitive" as const } },
        ...(identity.phoneValues.length ? [
          ...identity.phoneValues.map((value) => ({ phone: { contains: value } })),
          ...identity.phoneValues.map((value) => ({ phoneNormalized: { contains: value } })),
          ...identity.phoneValues.map((value) => ({ phones: { some: { phoneNormalized: { contains: value } } } })),
        ] : []),
        ...(identity.plateValues.length ? identity.plateValues.map((value) => ({ vehicles: { some: { plateNumber: { contains: value, mode: "insensitive" as const } } } })) : []),
        ...(identity.plateNormalized ? [{ vehicles: { some: { plateNormalized: { contains: identity.plateNormalized, mode: "insensitive" as const } } } }] : []),
        ...(identity.vin ? [{ vehicles: { some: { vin: { contains: identity.vin, mode: "insensitive" as const } } } }] : []),
        { vehicles: { some: { brand: { contains: q, mode: "insensitive" as const } } } },
        { vehicles: { some: { model: { contains: q, mode: "insensitive" as const } } } },
      ],
    } : {};
    const where = { AND: [vehicleOwnerWhere, scopeWhere, queryWhere] };

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

    return NextResponse.json(
      { ok: true, total, page: safePage, limit, pages, clients: clients.map(toClientDirectoryItem) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("clients GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити клієнтів." }, { status: 500 });
  }
}
