import { NextRequest, NextResponse } from "next/server";
import { getActualAccessContext } from "@/src/security/access-context";
import {
  OWNER_VIEW_AS_COOKIE,
  OwnerViewAsError,
  stopOwnerViewAsSession,
} from "@/src/security/owner-view-as";
import { writeAuditEvent } from "@/src/services/audit.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await getActualAccessContext(request);
    const ended = await stopOwnerViewAsSession(request, context);
    if (ended) {
      await writeAuditEvent({
        entityType: "OwnerEmployeeViewAsSession",
        entityId: ended.id,
        action: "OWNER_PREVIEW_ENDED",
        actorId: context.user?.id,
        actorName: context.user?.employeeName || context.user?.name,
        metadata: {
          targetUserId: ended.targetUserId,
          targetEmployeeId: ended.targetEmployeeId,
          targetRoleCode: ended.targetRoleCode,
          locationId: ended.locationId,
          readOnly: true,
        },
      });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(OWNER_VIEW_AS_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    if (error instanceof OwnerViewAsError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("POST /api/owner/view-as/stop failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "OWNER_PREVIEW_STOP_FAILED" }, { status: 500 });
  }
}
