import { NextResponse } from "next/server";
import { getActualAccessContext } from "@/src/security/access-context";
import { getPrisma } from "@/src/lib/prisma";
import { OwnerViewAsError, getOwnerViewAsSession } from "@/src/security/owner-view-as";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getActualAccessContext(request);
    const session = await getOwnerViewAsSession(request, context);
    if (!session) return NextResponse.json({ ok: true, current: null }, { headers: { "Cache-Control": "no-store" } });
    const prisma = getPrisma();
    const [target, role, location] = await Promise.all([
      prisma.user.findUnique({ where: { id: session.targetUserId }, include: { employeeProfile: true } }),
      session.targetRoleCode ? prisma.accessRole.findUnique({ where: { code: session.targetRoleCode }, select: { name: true } }) : null,
      session.locationId ? prisma.serviceLocation.findUnique({ where: { id: session.locationId }, select: { name: true } }) : null,
    ]);
    const targetName = target?.employeeProfile
      ? `${target.employeeProfile.firstName} ${target.employeeProfile.lastName}`.trim()
      : target?.name || "Працівник";
    return NextResponse.json({
      ok: true,
      current: {
        sessionId: session.id,
        targetUserId: session.targetUserId,
        targetEmployeeId: session.targetEmployeeId,
        name: targetName,
        roleCode: session.targetRoleCode,
        roleName: role?.name ?? session.targetRoleCode,
        locationId: session.locationId,
        locationName: location?.name ?? null,
        expiresAt: session.expiresAt.toISOString(),
        readOnly: true,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OwnerViewAsError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("GET /api/owner/view-as/current failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "OWNER_PREVIEW_CURRENT_FAILED" }, { status: 500 });
  }
}
