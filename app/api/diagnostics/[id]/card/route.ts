import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getDiagnosticCard, DiagnosticCardError } from "@/src/services/diagnostic-card.service";
import { StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function assertScope(access: Awaited<ReturnType<typeof authorize>>, diagnosticRequestId: string) {
  if (!access.context.user) return false;
  const prisma = getPrisma();
  const [diagnostic, assignment] = await Promise.all([
    prisma.diagnosticRequest.findUnique({ where: { id: diagnosticRequestId }, select: { id: true, vehicleId: true, leadId: true } }),
    prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId }, select: { mechanicId: true, locationId: true } }),
  ]);
  if (!diagnostic) return false;
  if (access.context.roles.some((role) => role.code === "MECHANIC")) {
    const mechanic = await prisma.serviceMechanic.findFirst({ where: { userId: access.context.user.id, isActive: true }, select: { id: true } });
    if (assignment) return Boolean(mechanic && assignment.mechanicId === mechanic.id);
    if (!mechanic) return false;
    const appointment = await prisma.serviceAppointment.findFirst({
      where: {
        mechanicId: mechanic.id,
        status: { notIn: ["CANCELLED", "NO_SHOW", "RESERVE", "COMPLETED"] },
        OR: [
          ...(diagnostic.vehicleId ? [{ vehicleId: diagnostic.vehicleId }] : []),
          ...(diagnostic.leadId ? [{ leadId: diagnostic.leadId }] : []),
        ],
      },
      select: { id: true },
    });
    return Boolean(appointment);
  }
  if (access.shadowBypass || access.grantedScope === "ALL") return true;
  return Boolean(assignment?.locationId && access.context.locationIds.includes(assignment.locationId));
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_READ, { request, minimumScope: "SELF" });
    if (!access.allowed) return access.response!;
    if (!(await assertScope(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    const state = await getDiagnosticCard(id);
    if (!state) return NextResponse.json({ ok: true, card: null }, { headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({
      ok: true,
      card: state.card,
      latest: state.latest,
      final: state.final,
      revisions: state.revisions.map((revision) => ({
        id: revision.id,
        revision: revision.revision,
        kind: revision.kind,
        sourceFingerprint: revision.sourceFingerprint,
        createdByUserId: revision.createdByUserId,
        createdAt: revision.createdAt,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DiagnosticCardError || error instanceof StructuredDiagnosticError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("GET diagnostic card failed", error);
    return NextResponse.json({ ok: false, error: "DIAGNOSTIC_CARD_LOAD_FAILED" }, { status: 500 });
  }
}
