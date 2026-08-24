import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { updateVehicleIssue, VehicleIssueError } from "@/src/services/vehicle-issues.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await authorize(PERMISSIONS.DIAGNOSTICS_WRITE, { request, minimumScope: "LOCATION", strict: true });
  if (!access.allowed) return access.response!;
  if (!access.context.user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  try {
    if (!access.shadowBypass && access.grantedScope !== "ALL") {
      const issue = await getPrisma().vehicleIssue.findUnique({ where: { id }, select: { sourceDiagnosticId: true } });
      if (!issue) return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Проблему автомобіля не знайдено." }, { status: 404 });
      if (!issue.sourceDiagnosticId) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
      const assignment = await getPrisma().diagnosticAssignment.findUnique({
        where: { diagnosticRequestId: issue.sourceDiagnosticId },
        select: { locationId: true },
      });
      if (!assignment?.locationId || !access.context.locationIds.includes(assignment.locationId)) {
        return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
      }
    }

    const body = await request.json().catch(() => null) as { action?: string; comment?: string; deferredUntil?: string | null } | null;
    const action = body?.action;
    if (action !== "DEFER" && action !== "DISMISS" && action !== "REOPEN") {
      return NextResponse.json({ ok: false, error: "Некоректна дія з проблемою автомобіля." }, { status: 400 });
    }
    const issue = await updateVehicleIssue({
      issueId: id,
      action,
      comment: body?.comment || null,
      deferredUntil: body?.deferredUntil || null,
      userId: access.context.user.id,
    });
    return NextResponse.json({ ok: true, issue });
  } catch (error) {
    if (error instanceof VehicleIssueError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("PATCH vehicle issue failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося оновити проблему автомобіля." }, { status: 500 });
  }
}
