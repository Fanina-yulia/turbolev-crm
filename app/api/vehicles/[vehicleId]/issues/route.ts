import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { listVehicleIssues } from "@/src/services/vehicle-issues.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ vehicleId: string }> }) {
  const { vehicleId } = await context.params;
  const access = await authorize(PERMISSIONS.DIAGNOSTICS_READ, { request, minimumScope: "SELF" });
  if (!access.allowed) return access.response!;
  const url = new URL(request.url);
  const rawScope = url.searchParams.get("scope");
  const scope = rawScope === "all" || rawScope === "resolved" ? rawScope : "active";
  try {
    const issues = await listVehicleIssues(vehicleId, scope);
    return NextResponse.json({ ok: true, vehicleId, scope, issues }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET vehicle issues failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити стан автомобіля." }, { status: 500 });
  }
}
