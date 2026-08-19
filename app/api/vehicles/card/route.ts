import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const id = (request.nextUrl.searchParams.get("id") || "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "Не вказано автомобіль." }, { status: 400 });

  try {
    const vehicle = await getPrisma().vehicle.findUnique({
      where: { id },
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
        classificationSource: true,
        classificationConfidence: true,
        vehicleDataSource: true,
        vehicleDataConfidence: true,
        lastVehicleLookupAt: true,
        exteriorColorName: true,
        exteriorColorHex: true,
        exteriorPaintCode: true,
        exteriorColorSource: true,
        exteriorColorConfirmed: true,
        createdAt: true,
        updatedAt: true,
        client: { select: { id: true, name: true, phone: true } },
        diagnosticRequests: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, status: true, technicalConclusion: true, confirmedAt: true, createdAt: true, updatedAt: true },
        },
        workOrders: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, status: true, createdAt: true, updatedAt: true, closedAt: true },
        },
        _count: { select: { workOrders: true, diagnosticRequests: true } },
      },
    });

    if (!vehicle) return NextResponse.json({ ok: false, error: "Автомобіль не знайдено." }, { status: 404 });
    return NextResponse.json({ ok: true, vehicle }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("vehicle card GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося відкрити картку автомобіля." }, { status: 500 });
  }
}
