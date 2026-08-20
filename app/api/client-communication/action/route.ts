import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { writeAuditEvent } from "@/src/services/audit.service";

export const runtime = "nodejs";

const ALLOWED = new Set(["VIBER_OPEN", "TELEGRAM_OPEN", "CABINET_LINK_COPIED", "BINOTEL_CALL_REQUESTED"]);

export async function POST(request: NextRequest) {
  const access = await authorize(PERMISSIONS.COMMUNICATIONS_WRITE, { request, strict: true, minimumScope: "TEAM" });
  if (!access.allowed) return access.response!;
  try {
    const body = await request.json().catch(() => ({}));
    const clientId = String(body?.clientId || "").trim();
    const vehicleId = String(body?.vehicleId || "").trim() || null;
    const action = String(body?.action || "").trim().toUpperCase();
    if (!clientId || !ALLOWED.has(action)) return NextResponse.json({ ok: false, error: "INVALID_ACTION" }, { status: 400 });
    await writeAuditEvent({
      entityType: "Client",
      entityId: clientId,
      action: `CLIENT_QUICK_${action}`,
      metadata: { vehicleId, source: "CLIENT_COMMUNICATION_ACTIONS" },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("POST /api/client-communication/action failed", error);
    return NextResponse.json({ ok: false, error: "AUDIT_FAILED" }, { status: 500 });
  }
}
