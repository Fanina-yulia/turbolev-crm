import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { resolveLaborPricing } from "@/src/services/labor-pricing.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type DirectoryRow = { id:string; name:string; code:string|null; data:Record<string,unknown>|null; isActive:boolean; sortOrder:number };

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
  const q = text(params.get("q")).toLocaleLowerCase("uk-UA");
  try {
    const rows = await prisma.$queryRawUnsafe<DirectoryRow[]>(
      `SELECT "id","name","code","data","isActive","sortOrder" FROM "CrmDirectoryItem" WHERE "category"='WORK_PRICE' AND "isActive"=TRUE ORDER BY "sortOrder","name"`,
    );
    const input = vehicleInput(params);
    const pricing = await resolveLaborPricing(input);
    const filtered = rows.filter((row) => !q || `${row.code ?? ""} ${row.name} ${String(row.data?.category ?? "")}`.toLocaleLowerCase("uk-UA").includes(q));
    const items = filtered.map((row) => {
      const basePrice = safeBase(row.data?.price ?? 0);
      return {
        id: row.id,
        code: row.code,
        category: row.data?.category ?? "",
        name: row.name,
        unit: row.data?.unit ?? "",
        normHours: Number(row.data?.normHours ?? 0) || null,
        complexSurcharge: row.data?.complexSurcharge == null ? null : Number(row.data.complexSurcharge),
        note: row.data?.note ?? "",
        basePrice,
        coefficient: pricing.coefficient,
        adjustedPrice: Math.round(basePrice * pricing.coefficient),
      };
    });
    return NextResponse.json({ ok:true, pricing, count:items.length, items }, { headers:{"Cache-Control":"no-store"} });
  } catch (error) {
    console.error("work-prices GET failed", error);
    return NextResponse.json({ ok:false, error:"Не вдалося розрахувати прайс робіт." }, { status:500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string,unknown>;
    const input = body.vehicle && typeof body.vehicle === "object" ? body.vehicle as Record<string,string> : {};
    const lines = Array.isArray(body.lines) ? body.lines as Array<Record<string,unknown>> : [];
    const adjustment = safeAdjustment(body.adjustmentPercent);
    const pricing = await resolveLaborPricing(input);
    const calculated = lines.map((line) => {
      const basePrice = safeBase(line.basePrice);
      const quantity = safeQuantity(line.quantity);
      const rawSubtotal = basePrice * quantity * pricing.coefficient;
      const subtotal = Math.round(rawSubtotal);
      const total = Math.round(rawSubtotal * (1 + adjustment / 100));
      return {
        ...line,
        basePrice,
        quantity,
        ...pricing,
        subtotal,
        manualAdjustmentPercent: adjustment,
        total,
      };
    });
    const total = calculated.reduce((sum, line) => sum + Number(line.total || 0), 0);
    return NextResponse.json({ ok:true, pricing, total, lines:calculated });
  } catch (error) {
    console.error("work-prices POST failed", error);
    return NextResponse.json({ ok:false, error:"Не вдалося виконати автоматичний розрахунок робіт." }, { status:400 });
  }
}
