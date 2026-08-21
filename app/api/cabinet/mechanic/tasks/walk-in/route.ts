import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { MechanicWalkInError, startMechanicWalkInDiagnostic } from "@/src/services/mechanic-walk-in.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const access = await authorize(PERMISSIONS.PRODUCTION_WRITE, { request, minimumScope: "ASSIGNED", strict: true });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED", message: "Позаплановий заїзд може оформити лише механік." }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = await startMechanicWalkInDiagnostic(access.context.user.id, body);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MechanicWalkInError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("POST mechanic walk-in failed", error);
    return NextResponse.json({ ok: false, error: "WALK_IN_FAILED", message: "Не вдалося оформити позаплановий заїзд." }, { status: 500 });
  }
}
