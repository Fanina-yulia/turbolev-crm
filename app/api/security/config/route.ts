import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { SecurityAdminError, setSecurityEnforcementMode } from "@/src/security/security-admin.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const access = await authorize(PERMISSIONS.SECURITY_ACCESS_MANAGE, { strict: true, request });
  if (!access.allowed) return access.response!;

  try {
    const body = await request.json();
    const mode = String(body.enforcementMode || "").toUpperCase();
    if (mode !== "SHADOW" && mode !== "ENFORCED") {
      return NextResponse.json({ ok: false, error: "INVALID_ENFORCEMENT_MODE" }, { status: 400 });
    }
    const config = await setSecurityEnforcementMode(mode);
    return NextResponse.json({ ok: true, config });
  } catch (error) {
    if (error instanceof SecurityAdminError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("PATCH /api/security/config", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ ok: false, error: "SECURITY_CONFIG_UPDATE_FAILED" }, { status: 500 });
  }
}
