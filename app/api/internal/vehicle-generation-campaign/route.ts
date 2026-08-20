import { NextRequest, NextResponse } from "next/server";
import {
  getGenerationCampaignStatus,
  runGenerationCampaignBatch,
} from "@/src/services/vehicle-images/vehicle-generation-image-campaign.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function credentials(request: NextRequest) {
  return {
    campaignId: request.nextUrl.searchParams.get("campaign")?.trim() || "",
    token: request.nextUrl.searchParams.get("token")?.trim() || "",
  };
}

function invalid() {
  return NextResponse.json({ ok: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const { campaignId, token } = credentials(request);
  if (!campaignId || !token) return invalid();

  const statusOnly = request.nextUrl.searchParams.get("action") === "status";
  try {
    if (statusOnly) {
      const state = await getGenerationCampaignStatus(campaignId, token);
      if (!state) return invalid();
      return NextResponse.json({ ok: true, state }, { headers: { "Cache-Control": "no-store" } });
    }

    const batch = Number(request.nextUrl.searchParams.get("batch") || 3);
    const result = await runGenerationCampaignBatch(campaignId, token, batch);
    if (!result) return invalid();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("vehicle generation campaign failed", error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "campaign failed",
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
