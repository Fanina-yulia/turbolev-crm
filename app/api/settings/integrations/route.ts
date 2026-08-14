import { NextResponse } from "next/server";
import { listIntegrationPublicStatuses } from "@/src/services/integration-credentials.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const integrations = await listIntegrationPublicStatuses();
    return NextResponse.json({ ok: true, integrations }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/settings/integrations failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити інтеграції" }, { status: 500 });
  }
}
