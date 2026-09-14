import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext } from "@/src/security/access-context";
import { activeManagementContext, managementActor, managementRole } from "@/src/security/management-access";
import { finalizeStationManagerBonus, saveStationBonusScheme } from "@/src/services/management-bonus.service";
import { ManagementResultError } from "@/src/services/management-result.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof ManagementResultError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
  console.error("management bonus API failed", error);
  return NextResponse.json({ ok: false, error: "Не вдалося оновити бонус керівника станції." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const access = await getAccessContext(request);
  const role = managementRole(access);
  if (!activeManagementContext(access) || !role) return NextResponse.json({ ok: false, error: access.authenticated ? "Немає доступу." : "Потрібна авторизація." }, { status: access.authenticated ? 403 : 401 });
  const requestedLocation = request.nextUrl.searchParams.get("locationId")?.trim() || null;
  if (role === "STATION_MANAGER" && requestedLocation && !access.locationIds.includes(requestedLocation)) return NextResponse.json({ ok: false, error: "Немає доступу до цієї станції." }, { status: 403 });
  const allowed = role === "STATION_MANAGER" ? access.locationIds : requestedLocation ? [requestedLocation] : null;
  const schemes = await getPrisma().stationBonusScheme.findMany({ where: { isActive: true, ...(allowed ? { OR: [{ locationId: null }, { locationId: { in: allowed } }] } : {}) }, orderBy: [{ locationId: "asc" }, { effectiveFrom: "desc" }] });
  return NextResponse.json({ ok: true, schemes }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await getAccessContext(request);
  const actor = managementActor(access);
  if (!activeManagementContext(access) || !actor) return NextResponse.json({ ok: false, error: access.authenticated ? "Немає доступу." : "Потрібна авторизація." }, { status: access.authenticated ? 403 : 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Некоректний JSON." }, { status: 400 });
  const action = typeof body.action === "string" ? body.action : "SAVE_SCHEME";
  try {
    if (action === "SAVE_SCHEME") {
      const result = await saveStationBonusScheme({
        actor,
        locationId: typeof body.locationId === "string" ? body.locationId : null,
        basis: body.basis,
        activationThresholdPct: body.activationThresholdPct,
        basePercent: body.basePercent,
        fixedAmount: body.fixedAmount,
        tier2ThresholdPct: body.tier2ThresholdPct,
        tier2Percent: body.tier2Percent,
        tier3ThresholdPct: body.tier3ThresholdPct,
        tier3Percent: body.tier3Percent,
        minMarginPct: body.minMarginPct,
        maxWarrantyRatePct: body.maxWarrantyRatePct,
        maxOverdueReceivablePct: body.maxOverdueReceivablePct,
        minDataQualityPct: body.minDataQualityPct,
        capAmount: body.capAmount,
        effectiveFrom: typeof body.effectiveFrom === "string" ? body.effectiveFrom : null,
      });
      return NextResponse.json(result);
    }
    if (action === "FINALIZE") {
      const planId = typeof body.planId === "string" ? body.planId : "";
      const locationId = typeof body.locationId === "string" ? body.locationId : "";
      if (!planId || !locationId) return NextResponse.json({ ok: false, error: "planId і locationId обов'язкові." }, { status: 400 });
      const result = await finalizeStationManagerBonus({ actor, planId, locationId });
      return NextResponse.json(result);
    }
    return NextResponse.json({ ok: false, error: "Невідома дія." }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
