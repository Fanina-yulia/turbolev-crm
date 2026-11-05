import { NextResponse } from "next/server";
import { listVehicleConfigurations } from "@/src/services/vehicle-configurations.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.OVERVIEW_READ, { request, strict: true, minimumScope: "SELF" });
  if (!access.allowed) return access.response!;
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
