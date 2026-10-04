import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getDatabaseObservability } from "@/src/services/database-observability.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, {
    strict: true,
    minimumScope: "ALL",
    request,
  });
  if (!access.allowed) return access.response!;

  const days = Number(request.nextUrl.searchParams.get("days") || "14");
  const limit = Number(request.nextUrl.searchParams.get("limit") || "25");

  try {
    const observability = await getDatabaseObservability({ days, limit });
    return NextResponse.json(observability, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("GET /api/settings/database-observability failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити статистику PostgreSQL." }, { status: 500 });
  }
}
