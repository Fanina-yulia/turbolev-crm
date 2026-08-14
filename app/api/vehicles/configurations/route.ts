import { NextResponse } from "next/server";
import { listVehicleConfigurations } from "@/src/services/vehicle-configurations.service";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const make = (searchParams.get("make") ?? "").trim();
  const model = (searchParams.get("model") ?? "").trim();
  const year = Number(searchParams.get("year") ?? "");

  if (!make || !model || !Number.isInteger(year)) {
    return NextResponse.json(
      { items: [], source: "INVALID_FILTER", total: 0, message: "Потрібні make, model та year." },
      { status: 400 },
    );
  }

  const result = await listVehicleConfigurations({ make, model, year });
  return NextResponse.json(
    { make, model, year, ...result },
    { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" } },
  );
}
