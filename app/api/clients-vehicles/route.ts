import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.CLIENTS_READ, { request, strict: true, minimumScope: "SELF" });
  if (!access.allowed) return access.response!;
  const prisma = getPrisma();
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  const take = clampInt(request.nextUrl.searchParams.get("limit"), 60, 1, 100);
  const skip = clampInt(request.nextUrl.searchParams.get("offset"), 0, 0, 100_000);

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

  try {
    const [total, clients] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        skip,
        take,
        select: {
          id: true,
          name: true,
          phone: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { vehicles: true, workOrders: true, diagnosticRequests: true } },
          workOrders: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: { id: true, status: true, createdAt: true, updatedAt: true, closedAt: true },
          },
          vehicles: {
            orderBy: { updatedAt: "desc" },
            select: {
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
              _count: { select: { workOrders: true, diagnosticRequests: true } },
            },
          },
        },
      }),
    ]);

    return NextResponse.json({ ok: true, total, offset: skip, limit: take, clients }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("clients-vehicles GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити клієнтів та автомобілі." }, { status: 500 });
  }
}
