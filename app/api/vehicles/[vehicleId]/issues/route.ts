import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { listVehicleIssues } from "@/src/services/vehicle-issues.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ vehicleId: string }> }) {
  const { vehicleId } = await context.params;
  const access = await authorize(PERMISSIONS.DIAGNOSTICS_READ, { request, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  const url = new URL(request.url);
  const rawScope = url.searchParams.get("scope");
  const scope = rawScope === "all" || rawScope === "resolved" ? rawScope : "active";
  try {
    const issues = await listVehicleIssues(vehicleId, scope);
    if (access.shadowBypass || access.grantedScope === "ALL") {
      return NextResponse.json({ ok: true, vehicleId, scope, issues }, { headers: { "Cache-Control": "no-store" } });
    }

    const diagnosticIds = Array.from(new Set(issues.flatMap((issue) => issue.sourceDiagnosticId ? [issue.sourceDiagnosticId] : [])));
    const assignments = diagnosticIds.length
      ? await getPrisma().diagnosticAssignment.findMany({
          where: { diagnosticRequestId: { in: diagnosticIds } },
          select: { diagnosticRequestId: true, locationId: true },
        })
      : [];
    const allowedDiagnostics = new Set(assignments
      .filter((assignment) => Boolean(assignment.locationId && access.context.locationIds.includes(assignment.locationId)))
      .map((assignment) => assignment.diagnosticRequestId));
    const scopedIssues = issues.filter((issue) => Boolean(issue.sourceDiagnosticId && allowedDiagnostics.has(issue.sourceDiagnosticId)));

    return NextResponse.json({ ok: true, vehicleId, scope, issues: scopedIssues }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET vehicle issues failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити стан автомобіля." }, { status: 500 });
  }
}
