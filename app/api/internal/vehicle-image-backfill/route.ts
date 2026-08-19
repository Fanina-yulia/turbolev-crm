import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getOpenAIVehicleImageConfig } from "@/src/services/vehicle-images/openai-library.service";
import { generateVehicleImageInBackground } from "@/src/services/vehicle-images/vehicle-image-background.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BACKFILL_TOKEN = "hRjG3uI4O1g06STE4M4Hsx8wg3B2IoFmKDFcLMjZ6ww";

function allowed(request: NextRequest) {
  return request.headers.get("x-backfill-token") === BACKFILL_TOKEN;
}

export async function GET(request: NextRequest) {
  if (!allowed(request)) return NextResponse.json({ ok: false }, { status: 404 });
  const config = await getOpenAIVehicleImageConfig();
  const prisma = getPrisma();
  const vehicles = await prisma.vehicle.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, plateNumber: true, brand: true, model: true, year: true, bodyType: true },
  });
  return NextResponse.json({
    ok: true,
    configured: Boolean(config),
    model: config?.model ?? null,
    quality: config?.quality ?? null,
    imageSize: config?.imageSize ?? null,
    autoGenerate: config?.autoGenerate ?? false,
    vehicles,
  });
}

export async function POST(request: NextRequest) {
  if (!allowed(request)) return NextResponse.json({ ok: false }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { vehicleId?: string; force?: boolean };
  const vehicleId = body.vehicleId?.trim();
  if (!vehicleId) return NextResponse.json({ ok: false, error: "vehicleId required" }, { status: 400 });
  try {
    const result = await generateVehicleImageInBackground(vehicleId, { force: body.force === true });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "generation failed",
    }, { status: 422 });
  }
}
