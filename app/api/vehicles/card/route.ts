import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { resolveVehicleColorByPlate } from "@/src/services/vehicle-registry-color.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.CLIENTS_READ, { request, strict: true, minimumScope: "SELF" });
  if (!access.allowed) return access.response!;
  const id = (request.nextUrl.searchParams.get("id") || "").trim();
  const compact = request.nextUrl.searchParams.get("view") === "diagnostic";
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
        ...(compact ? {} : {
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
        }),
        _count: { select: { workOrders: true, diagnosticRequests: true } },
      },
    });

    if (!vehicle) return NextResponse.json({ ok: false, error: "Автомобіль не знайдено." }, { status: 404 });
    const color = compact || vehicle.exteriorColorConfirmed
      ? null
      : await resolveVehicleColorByPlate(vehicle.plateNumber, vehicle.id, vehicle.vin).catch(() => null);
    const responseVehicle = {
      ...vehicle,
      diagnosticRequests: "diagnosticRequests" in vehicle ? vehicle.diagnosticRequests : [],
      workOrders: "workOrders" in vehicle ? vehicle.workOrders : [],
    };
    return NextResponse.json({ ok: true, vehicle: color ? { ...responseVehicle, ...color } : responseVehicle }, { headers: { "Cache-Control": compact ? "private, max-age=10" : "no-store" } });
  } catch (error) {
    console.error("vehicle card GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося відкрити картку автомобіля." }, { status: 500 });
  }
}
