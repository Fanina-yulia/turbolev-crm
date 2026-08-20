import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  getVehicleGenerationCatalogStats,
  listGenerationReferencesForModel,
  listVehicleGenerationCatalog,
  refreshTopVehicleModelPopularity,
} from "@/src/services/vehicle-images/vehicle-generation-catalog.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 100;

function clamp(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(10, Math.min(250, Math.trunc(parsed))) : 100;
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return access.response!;

  try {
    const make = request.nextUrl.searchParams.get("make")?.trim() || "";
    const model = request.nextUrl.searchParams.get("model")?.trim() || "";
    if (make && model) {
      const generations = await listGenerationReferencesForModel(make, model);
      return NextResponse.json({ ok: true, make, model, generations }, { headers: { "Cache-Control": "no-store" } });
    }

    const limit = clamp(request.nextUrl.searchParams.get("limit"));
    const [catalog, stats] = await Promise.all([
      listVehicleGenerationCatalog(limit),
      getVehicleGenerationCatalogStats(),
    ]);
    return NextResponse.json({ ok: true, catalog, stats }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("vehicle generation catalog GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити довідник поколінь авто." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return access.response!;
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json().catch(() => null) as { action?: string; limit?: number } | null;
    if (body?.action !== "refresh") {
      return NextResponse.json({ ok: false, error: "Невідома дія." }, { status: 400 });
    }
    const limit = Math.max(10, Math.min(250, Math.trunc(Number(body.limit) || 100)));
    const refresh = await refreshTopVehicleModelPopularity(limit);
    const [catalog, stats] = await Promise.all([
      listVehicleGenerationCatalog(limit),
      getVehicleGenerationCatalogStats(),
    ]);
    return NextResponse.json({ ok: true, refresh, catalog, stats }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("vehicle generation catalog refresh failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не вдалося оновити ТОП моделей." }, { status: 500 });
  }
}
