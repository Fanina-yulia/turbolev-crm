import { NextResponse } from "next/server";
import { listVehicleMakes, listVehicleModels } from "@/src/services/vehicle-catalog.service";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const make = (searchParams.get("make") ?? "").trim();
  const q = (searchParams.get("q") ?? "").trim();

  if (make) {
    const result = await listVehicleModels(make);
    return NextResponse.json({ kind: "models", make, ...result }, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
  }

  const result = await listVehicleMakes(q);
  return NextResponse.json({ kind: "makes", query: q, ...result }, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
}
