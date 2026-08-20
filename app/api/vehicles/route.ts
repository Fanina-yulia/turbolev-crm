import { NextRequest, NextResponse } from "next/server";
import { isVehicleLifecycleCode } from "@/src/domain/vehicle-lifecycle";
import { toVehicleDirectoryItem } from "@/src/lib/contracts/crm-core.server";
import { getPrisma } from "@/src/lib/prisma";
import { getVehicleLifecycleMap } from "@/src/services/vehicle-lifecycle.service";

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

type SortMode = "UPDATED_DESC" | "ARRIVAL_DESC" | "ARRIVAL_ASC" | "STATUS" | "OVERDUE_FIRST";

function sortMode(value: string | null): SortMode {
  return ["UPDATED_DESC", "ARRIVAL_DESC", "ARRIVAL_ASC", "STATUS", "OVERDUE_FIRST"].includes(value || "")
    ? value as SortMode
    : "UPDATED_DESC";
}

export async function GET(request: NextRequest) {
  const prisma = getPrisma();
  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  const limit = clampInt(request.nextUrl.searchParams.get("limit"), 24, 1, 100);
  const page = clampInt(request.nextUrl.searchParams.get("page"), 1, 1, 100_000);
  const requestedStatus = request.nextUrl.searchParams.get("status");
  const status = requestedStatus === "NO_ACTIVE" || isVehicleLifecycleCode(requestedStatus) ? requestedStatus : null;
  const sort = sortMode(request.nextUrl.searchParams.get("sort"));

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

    // Lifecycle depends on several aggregates (planner, diagnostics, work orders),
    // therefore filtering happens after the canonical batch resolver. At the
    // current CRM scale this keeps the result correct across all modules.
    const allVehicles = await prisma.vehicle.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 5000,
      select: vehicleSelect,
    });
    const lifecycleMap = await getVehicleLifecycleMap(allVehicles.map((vehicle) => vehicle.id));

    let enriched = allVehicles.map((vehicle) => ({
      ...toVehicleDirectoryItem(vehicle),
      lifecycle: lifecycleMap.get(vehicle.id) || null,
    }));

    if (status === "NO_ACTIVE") enriched = enriched.filter((vehicle) => !vehicle.lifecycle?.active);
    else if (status) enriched = enriched.filter((vehicle) => vehicle.lifecycle?.code === status);

    enriched.sort((a, b) => {
      if (sort === "ARRIVAL_DESC" || sort === "ARRIVAL_ASC") {
        const aTime = a.lifecycle?.arrivalAt ? new Date(a.lifecycle.arrivalAt).getTime() : 0;
        const bTime = b.lifecycle?.arrivalAt ? new Date(b.lifecycle.arrivalAt).getTime() : 0;
        return sort === "ARRIVAL_DESC" ? bTime - aTime : aTime - bTime;
      }
      if (sort === "STATUS") {
        const statusDiff = (a.lifecycle?.order ?? 999) - (b.lifecycle?.order ?? 999);
        if (statusDiff) return statusDiff;
      }
      if (sort === "OVERDUE_FIRST") {
        const aOverdue = a.lifecycle?.flags.includes("OVERDUE") ? 0 : 1;
        const bOverdue = b.lifecycle?.flags.includes("OVERDUE") ? 0 : 1;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    const total = enriched.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, pages);
    const vehicles = enriched.slice((safePage - 1) * limit, safePage * limit);

    const statusCounts: Record<string, number> = {};
    for (const vehicle of allVehicles) {
      const lifecycle = lifecycleMap.get(vehicle.id);
      const key = lifecycle?.code || "NO_ACTIVE";
      statusCounts[key] = (statusCounts[key] || 0) + 1;
    }

    return NextResponse.json(
      { ok: true, total, page: safePage, limit, pages, vehicles, statusCounts, status: status || "ALL", sort },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("vehicles GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити автомобілі." }, { status: 500 });
  }
}
