import { NextRequest, NextResponse } from "next/server";
import { getAccessContext } from "@/src/security/access-context";
import { getWeeklyManagementResult, ManagementResultError } from "@/src/services/management-result.service";
import { getManagementIntelligence } from "@/src/services/management-intelligence.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function role(context: Awaited<ReturnType<typeof getAccessContext>>) {
  const codes = new Set(context.roles.map((item) => item.code));
  if (codes.has("OWNER")) return "OWNER";
  if (codes.has("EXECUTIVE_DIRECTOR")) return "EXECUTIVE_DIRECTOR";
  if (codes.has("STATION_MANAGER")) return "STATION_MANAGER";
  return null;
}

export async function GET(request: NextRequest) {
  const context = await getAccessContext(request);
  if (context.provisioningState !== "ACTIVE" || !context.user) {
    return NextResponse.json({ ok: false, error: context.authenticated ? "Доступ до CRM не активований." : "Потрібна авторизація." }, { status: context.authenticated ? 403 : 401 });
  }
  const currentRole = role(context);
  if (!currentRole) return NextResponse.json({ ok: false, error: "Кабінет управління результатом недоступний для цієї ролі." }, { status: 403 });

  const week = request.nextUrl.searchParams.get("week");
  const requestedLocationId = request.nextUrl.searchParams.get("locationId")?.trim() || null;
  if (currentRole === "STATION_MANAGER" && requestedLocationId && !context.locationIds.includes(requestedLocationId)) {
    return NextResponse.json({ ok: false, error: "Немає доступу до цієї станції." }, { status: 403 });
  }

  try {
    const base = await getWeeklyManagementResult({
      anchor: week,
      locationIds: currentRole === "STATION_MANAGER" ? context.locationIds : null,
      selectedLocationId: requestedLocationId,
    });
    const advanced = await getManagementIntelligence({
      anchor: week,
      locationIds: currentRole === "STATION_MANAGER" ? context.locationIds : null,
      selectedLocationId: requestedLocationId,
      base,
    });
    return NextResponse.json({
      ...base,
      ...advanced,
      access: {
        role: currentRole,
        scope: currentRole === "STATION_MANAGER" ? "LOCATION" : requestedLocationId ? "LOCATION" : "ALL",
        locationIds: currentRole === "STATION_MANAGER" ? context.locationIds : undefined,
        canEditTarget: currentRole === "OWNER",
        canEditBonusFormula: currentRole === "OWNER",
        canDistribute: currentRole === "OWNER" || currentRole === "EXECUTIVE_DIRECTOR",
        canActivate: currentRole === "OWNER" || currentRole === "EXECUTIVE_DIRECTOR",
        canClose: currentRole === "OWNER" || currentRole === "EXECUTIVE_DIRECTOR",
        canRedistributeStation: currentRole === "STATION_MANAGER" || currentRole === "EXECUTIVE_DIRECTOR" || currentRole === "OWNER",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ManagementResultError) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    console.error("management result API failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося розрахувати план/факт/прогноз." }, { status: 500 });
  }
}
