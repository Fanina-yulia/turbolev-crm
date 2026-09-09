import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import { listRelatedPartOperations } from "@/src/services/part-operation-catalog.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

function clean(value: string | null, max = 240) {
  return (value || "").trim().slice(0, max);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const locationId = clean(params.get("locationId"), 160) || null;
  const access = await authorizeScopedLocation(PERMISSIONS.PARTS_READ, request, locationId);
  if (!access.ok) return access.response;

  const genericArticleId = clean(params.get("genericArticleId"), 160) || null;
  const canonicalCode = clean(params.get("canonicalCode"), 80) || null;
  const partName = clean(params.get("partName"), 240) || null;
  const axis = clean(params.get("axis"), 32) || null;
  const side = clean(params.get("side"), 32) || null;
  const position = clean(params.get("position"), 120) || null;
  const subPosition = clean(params.get("subPosition"), 32) || null;
  const vehicleId = clean(params.get("vehicleId"), 160) || null;
  const workOrderId = clean(params.get("workOrderId"), 160) || null;
  const findingId = clean(params.get("findingId"), 160) || null;

  if (!genericArticleId && !canonicalCode && !partName) {
    return NextResponse.json({ ok: false, error: "PART_REQUIRED", message: "Не передано канонічну деталь." }, { status: 400 });
  }

  try {
    const prisma = getPrisma();
    let vehicle: Record<string, unknown> | null = null;
    if (vehicleId) {
      vehicle = await prisma.vehicle.findUnique({
        where: { id: vehicleId },
        select: { id: true, brand: true, model: true, year: true, engineName: true, engineVolumeCm3: true, fuelType: true, bodyType: true, grossWeightKg: true, driveType: true, vehicleType: true },
      });
    }
    if (!vehicle && workOrderId) {
      vehicle = await prisma.workOrder.findUnique({
        where: { id: workOrderId },
        select: { vehicle: { select: { id: true, brand: true, model: true, year: true, engineName: true, engineVolumeCm3: true, fuelType: true, bodyType: true, grossWeightKg: true, driveType: true, vehicleType: true } } },
      }).then((row) => row?.vehicle || null);
    }

    const result = await listRelatedPartOperations({
      genericArticleId,
      canonicalCode,
      partName,
      axis,
      side,
      position,
      subPosition,
      vehicle,
      workOrderId,
      findingId,
    });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/parts/related-operations failed", error);
    return NextResponse.json({ ok: false, error: "RELATED_OPERATIONS_READ_FAILED", message: "Не вдалося завантажити пов’язані роботи." }, { status: 500 });
  }
}
