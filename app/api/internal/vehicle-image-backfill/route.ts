import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getOpenAIVehicleImageConfig } from "@/src/services/vehicle-images/openai-library.service";
import { generateVehicleImageInBackground } from "@/src/services/vehicle-images/vehicle-image-background.service";
import {
  getGenerationCampaignStatus,
  runGenerationCampaignBatch,
} from "@/src/services/vehicle-images/vehicle-generation-image-campaign.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BACKFILL_TOKEN = process.env.VEHICLE_IMAGE_BACKFILL_TOKEN?.trim() || "";

function allowed(request: NextRequest) {
  if (!BACKFILL_TOKEN) return false;
  return request.headers.get("x-backfill-token") === BACKFILL_TOKEN
    || request.nextUrl.searchParams.get("token") === BACKFILL_TOKEN;
}

function hidden() {
  return NextResponse.json({ ok: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

async function handleCampaign(request: NextRequest) {
  const campaignId = request.nextUrl.searchParams.get("campaign")?.trim() || "";
  const token = request.nextUrl.searchParams.get("token")?.trim() || "";
  if (!campaignId || !token) return null;

  if (request.nextUrl.searchParams.get("action") === "status") {
    const state = await getGenerationCampaignStatus(campaignId, token);
    return state
      ? NextResponse.json({ ok: true, state }, { headers: { "Cache-Control": "no-store" } })
      : hidden();
  }

  const batch = Number(request.nextUrl.searchParams.get("batch") || 3);
  const result = await runGenerationCampaignBatch(campaignId, token, batch);
  return result
    ? NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
    : hidden();
}

export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.has("campaign")) {
      return await handleCampaign(request) || hidden();
    }

    if (!allowed(request)) return hidden();
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
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("vehicle image backfill GET failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "generation failed",
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest) {
  if (!allowed(request)) return hidden();
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
