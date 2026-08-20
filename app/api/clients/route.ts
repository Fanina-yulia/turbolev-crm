import { NextRequest, NextResponse } from "next/server";
import { toClientDirectoryItem } from "@/src/lib/contracts/crm-core.server";
import { getPrisma } from "@/src/lib/prisma";

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

export async function GET(request: NextRequest) {
  const prisma = getPrisma();
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  const id = (request.nextUrl.searchParams.get("id") || "").trim();
  const limit = clampInt(request.nextUrl.searchParams.get("limit"), 24, 1, 100);
  const page = clampInt(request.nextUrl.searchParams.get("page"), 1, 1, 100_000);

  try {
    if (id) {
      const client = await prisma.client.findUnique({ where: { id }, select: clientSelect });
      if (!client) return NextResponse.json({ ok: false, error: "Клієнта не знайдено." }, { status: 404 });
      return NextResponse.json(
        { ok: true, client: toClientDirectoryItem(client) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const where = q ? {
      OR: [
        { name: { contains: q, mode: "insensitive" as const } },
        { phone: { contains: q } },
        { vehicles: { some: { plateNumber: { contains: q, mode: "insensitive" as const } } } },
        { vehicles: { some: { vin: { contains: q, mode: "insensitive" as const } } } },
        { vehicles: { some: { brand: { contains: q, mode: "insensitive" as const } } } },
        { vehicles: { some: { model: { contains: q, mode: "insensitive" as const } } } },
      ],
    } : {};

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