import { NextRequest, NextResponse } from "next/server";
import { ServiceCatalogReviewStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { resolveLaborPricing } from "@/src/services/labor-pricing.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function text(value: string | null) { return (value || "").trim(); }
function vehicleInput(params: URLSearchParams) {
  return {
    make: text(params.get("make")),
    model: text(params.get("model")),
    year: text(params.get("year")),
    engine: text(params.get("engine")),
    engineVolume: text(params.get("engineVolume")),
    fuelType: text(params.get("fuelType")),
    bodyType: text(params.get("bodyType")),
    grossWeight: text(params.get("grossWeight")),
    driveType: text(params.get("driveType")),
    vehicleType: text(params.get("vehicleType")),
  };
}
function safeBase(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; }
function safeQuantity(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 1; }
function safeAdjustment(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }

export async function GET(request: NextRequest) {
  const prisma = getPrisma();
  const params = request.nextUrl.searchParams;
  const q = text(params.get("q"));
  try {
    const [rows, pricing] = await Promise.all([
      prisma.serviceCatalogItem.findMany({
        where: {
          isActive: true,
          showToOperator: true,
          reviewStatus: ServiceCatalogReviewStatus.READY,
          basePrice: { not: null },
          ...(q ? {
            OR: [
              { code: { contains: q, mode: "insensitive" } },
              { externalServiceId: { contains: q, mode: "insensitive" } },
              { internalName: { contains: q, mode: "insensitive" } },
              { displayName: { contains: q, mode: "insensitive" } },
              { searchAliases: { has: q } },
              { namePart: { contains: q, mode: "insensitive" } },
              { namePosition: { contains: q, mode: "insensitive" } },
              { nameSide: { contains: q, mode: "insensitive" } },
              { nameOperation: { contains: q, mode: "insensitive" } },
              { sourceCategory: { contains: q, mode: "insensitive" } },
              { bodyPart: { contains: q, mode: "insensitive" } },
              { category: { is: { name: { contains: q, mode: "insensitive" } } } },
            ],
          } : {}),
        },
        include: { category: { select: { name: true, sortOrder: true } } },
        orderBy: [{ category: { sortOrder: "asc" } }, { displayName: "asc" }],
        take: q ? 150 : 1500,
      }),
      resolveLaborPricing(vehicleInput(params)),
    ]);

    const items = rows.map((row) => {
      const basePrice = safeBase(row.basePrice);
      const coefficient = row.vehicleCoefficientEnabled ? pricing.coefficient : 1;
      return {
        id: row.id,
        code: row.code,
        externalServiceId: row.externalServiceId,
        source: row.source,
        category: row.category?.name || row.sourceCategory || "Інше",
        name: row.displayName,
        internalName: row.internalName,
        namePart: row.namePart,
        namePosition: row.namePosition,
        nameSide: row.nameSide,
        nameOperation: row.nameOperation,
        searchAliases: row.searchAliases,
        itemType: row.itemType,
        unit: row.unit,
        normHours: row.normMinutes == null ? null : Math.round((row.normMinutes / 60) * 100) / 100,
        normMinutes: row.normMinutes,
        complexSurcharge: row.complexSurcharge == null ? null : Number(row.complexSurcharge),
        note: row.reviewReason || "",
        warrantyKm: row.warrantyKm,
        warrantyDays: row.warrantyDays,
        bodyPart: row.bodyPart,
        bodySide: row.bodySide,
        calculatorOperation: row.calculatorOperation,
        vehicleCoefficientEnabled: row.vehicleCoefficientEnabled,
        basePrice,
        coefficient,
        adjustedPrice: Math.round(basePrice * coefficient),
      };
    });
    return NextResponse.json({ ok: true, pricing, count: items.length, items, catalogVersion: 2 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("work-prices GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося розрахувати прайс робіт." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const input = body.vehicle && typeof body.vehicle === "object" ? body.vehicle as Record<string, string> : {};
    const lines = Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : [];
    const adjustment = safeAdjustment(body.adjustmentPercent);
    const pricing = await resolveLaborPricing(input);
    const calculated = lines.map((line) => {
      const basePrice = safeBase(line.basePrice);
      const quantity = safeQuantity(line.quantity);
      const coefficient = line.vehicleCoefficientEnabled === false ? 1 : pricing.coefficient;
      const rawSubtotal = basePrice * quantity * coefficient;
      const subtotal = Math.round(rawSubtotal);
      const total = Math.round(rawSubtotal * (1 + adjustment / 100));
      return {
        ...line,
        basePrice,
        quantity,
        ...pricing,
        coefficient,
        subtotal,
        manualAdjustmentPercent: adjustment,
        total,
      };
    });
    const total = calculated.reduce((sum, line) => sum + Number(line.total || 0), 0);
    return NextResponse.json({ ok: true, pricing, total, lines: calculated });
  } catch (error) {
    console.error("work-prices POST failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося виконати автоматичний розрахунок робіт." }, { status: 400 });
  }
}
