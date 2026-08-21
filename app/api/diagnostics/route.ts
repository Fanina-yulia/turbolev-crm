import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { listDiagnostics, parseDiagnosticStatus } from "@/src/services/diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_READ, { strict: true, request, minimumScope: "SELF" });
    if (!access.allowed) return access.response!;
    const rawStatus = request.nextUrl.searchParams.get("status");
    const status = rawStatus ? parseDiagnosticStatus(rawStatus) : null;
    if (rawStatus && !status) return NextResponse.json({ ok: false, error: "Невідомий статус діагностики." }, { status: 400 });
    const limitRaw = Number(request.nextUrl.searchParams.get("limit") || 200);
    let diagnostics = await listDiagnostics({ status, limit: Number.isFinite(limitRaw) ? limitRaw : 200 });

    if (access.grantedScope !== "ALL") {
      const prisma = getPrisma();
      if (access.context.roles.some((role) => role.code === "MECHANIC") && access.context.user) {
        const mechanic = await prisma.serviceMechanic.findFirst({ where: { userId: access.context.user.id, isActive: true }, select: { id: true } });
        const assignments = mechanic ? await prisma.diagnosticAssignment.findMany({ where: { mechanicId: mechanic.id }, select: { diagnosticRequestId: true } }) : [];
        const allowed = new Set(assignments.map((item) => item.diagnosticRequestId));
        diagnostics = diagnostics.filter((item) => allowed.has(item.id));
      } else {
        const assignments = access.context.locationIds.length ? await prisma.diagnosticAssignment.findMany({ where: { locationId: { in: access.context.locationIds } }, select: { diagnosticRequestId: true } }) : [];
        const allowed = new Set(assignments.map((item) => item.diagnosticRequestId));
        diagnostics = diagnostics.filter((item) => allowed.has(item.id));
      }
    }
    return NextResponse.json({ ok: true, diagnostics }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/diagnostics failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити діагностики." }, { status: 500 });
  }
}
