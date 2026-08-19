import { NextResponse } from "next/server";
import { listIntegrationPublicStatuses } from "@/src/services/integration-credentials.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return access.response!;

  try {
    const integrations = await listIntegrationPublicStatuses();
    return NextResponse.json({ ok: true, integrations }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/settings/integrations failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити інтеграції" }, { status: 500 });
  }
}
