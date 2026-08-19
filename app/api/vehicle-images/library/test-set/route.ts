import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getVehicleImageLibraryState } from "@/src/services/vehicle-images/openai-library.service";
import { generateVehicleImageInBackground } from "@/src/services/vehicle-images/vehicle-image-background.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 100;

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

async function testVehicles() {
  const rows = await getPrisma().vehicle.findMany({
    where: {
      brand: { not: null },
      model: { not: null },
      NOT: { id: { startsWith: "demo_" } },
    },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: {
      id: true,
      brand: true,
      model: true,
      year: true,
      bodyType: true,
      plateNumber: true,
    },
  });

  const seen = new Set<string>();
  const vehicles: Array<{
    id: string;
    make: string;
    model: string;
    year: number | null;
    bodyType: string | null;
    plateNumber: string | null;
  }> = [];

  for (const row of rows) {
    const make = row.brand?.trim() || "";
    const model = row.model?.trim() || "";
    if (!make || !model) continue;
    const key = `${make.toLocaleUpperCase("uk-UA")}|${model.toLocaleUpperCase("uk-UA")}|${row.year ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    vehicles.push({
      id: row.id,
      make,
      model,
      year: row.year,
      bodyType: row.bodyType?.trim() || null,
      plateNumber: row.plateNumber,
    });
    if (vehicles.length >= 6) break;
  }

  return vehicles;
}

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return access.response!;

  try {
    const vehicles = await testVehicles();
    return NextResponse.json({ ok: true, vehicles }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("vehicle image test-set GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося підготувати контрольний набір авто." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request });
  if (!access.allowed) return access.response!;
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json().catch(() => null) as { vehicleId?: string } | null;
    const vehicleId = body?.vehicleId?.trim();
    if (!vehicleId) return NextResponse.json({ ok: false, error: "Не передано автомобіль для тесту." }, { status: 400 });

    const candidates = await testVehicles();
    const candidate = candidates.find((item) => item.id === vehicleId);
    if (!candidate) return NextResponse.json({ ok: false, error: "Автомобіль не входить до поточного контрольного набору." }, { status: 409 });

    // The control test is an explicit paid regeneration. Force a fresh request so an
    // old transparent-background compatibility error cannot block the retry window.
    // The background service contains the model-compatibility fallback and final
    // alpha/WebP optimization used by production vehicle cards.
    const generation = await generateVehicleImageInBackground(vehicleId, { force: true });
    const library = await getVehicleImageLibraryState(vehicleId);
    return NextResponse.json(
      { ok: true, vehicle: candidate, generation, library },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("vehicle image test-set POST failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не вдалося згенерувати тестове зображення." },
      { status: 422 },
    );
  }
}
