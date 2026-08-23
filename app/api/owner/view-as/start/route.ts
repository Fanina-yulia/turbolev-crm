import { NextRequest, NextResponse } from "next/server";
import { getActualAccessContext } from "@/src/security/access-context";
import {
  OWNER_VIEW_AS_COOKIE,
  OwnerViewAsError,
  createOwnerViewAsSession,
} from "@/src/security/owner-view-as";
import { writeAuditEvent } from "@/src/services/audit.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await getActualAccessContext(request);
    const body = await request.json().catch(() => null) as { targetUserId?: string } | null;
    const targetUserId = String(body?.targetUserId || "").trim();
    if (!targetUserId) return NextResponse.json({ ok: false, error: "TARGET_USER_REQUIRED" }, { status: 400 });

    const created = await createOwnerViewAsSession(context, targetUserId);
    await writeAuditEvent({
      entityType: "OwnerEmployeeViewAsSession",
      entityId: created.session.id,
      action: created.switched ? "OWNER_PREVIEW_SWITCHED" : "OWNER_PREVIEW_STARTED",
      actorId: context.user?.id,
      actorName: context.user?.employeeName || context.user?.name,
      metadata: {
        targetUserId: created.target.userId,
        targetEmployeeId: created.target.employeeId,
        targetRoleCode: created.target.roleCode,
        locationId: created.target.locationId,
        expiresAt: created.session.expiresAt.toISOString(),
        readOnly: true,
      },
    });

    const response = NextResponse.json({
      ok: true,
      target: created.target,
      expiresAt: created.session.expiresAt.toISOString(),
      readOnly: true,
    });
    response.cookies.set(OWNER_VIEW_AS_COOKIE, created.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: created.maxAge,
    });
    return response;
  } catch (error) {
    if (error instanceof OwnerViewAsError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("POST /api/owner/view-as/start failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "OWNER_PREVIEW_START_FAILED" }, { status: 500 });
  }
}
