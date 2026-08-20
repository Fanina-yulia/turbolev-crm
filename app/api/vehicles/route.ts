import { NextRequest, NextResponse } from "next/server";
import { toVehicleDirectoryItem } from "@/src/lib/contracts/crm-core.server";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

const vehicleSelect = {
  id: true,
  clientId: true,
  plateNumber: true,
  vin: true,
  brand: true,
  model: true,
  year: true,
  mileageKm: true,
  engineName: true,
  engineVolumeCm3: true,
  fuelType: true,
  bodyType: true,
  driveType: true,
  vehicleType: true,
  turboLevClass: true,
  priceCoefficient: true,
  vehicleDataSource: true,
  vehicleDataConfidence: true,
  exteriorColorName: true,
  exteriorColorHex: true,
  exteriorPaintCode: true,
  exteriorColorSource: true,
  exteriorColorConfirmed: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, name: true, phone: true } },
  _count: { select: { workOrders: true, diagnosticRequests: true } },
} as const;

export async function GET(request: NextRequest) {
  const prisma = getPrisma();
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  const limit = clampInt(request.nextUrl.searchParams.get("limit"), 24, 1, 100);
  const page = clampInt(request.nextUrl.searchParams.get("page"), 1, 1, 100_000);

  try {
    const where = q ? {
      OR: [
        { plateNumber: { contains: q, mode: "insensitive" as const } },
        { vin: { contains: q, mode: "insensitive" as const } },
        { brand: { contains: q, mode: "insensitive" as const } },
        { model: { contains: q, mode: "insensitive" as const } },
        { client: { is: { name: { contains: q, mode: "insensitive" as const } } } },
        { client: { is: { phone: { contains: q } } } },
      ],
    } : {};

    const total = await prisma.vehicle.count({ where });
    const pages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, pages);
    const vehicles = await prisma.vehicle.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      skip: (safePage - 1) * limit,
      take: limit,
      select: vehicleSelect,
    });

    return NextResponse.json(
      { ok: true, total, page: safePage, limit, pages, vehicles: vehicles.map(toVehicleDirectoryItem) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("vehicles GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити автомобілі." }, { status: 500 });
  }
}