import { NextRequest, NextResponse } from "@/next/server";
import {
  enqueueMissingVehicleImages,
  processQueuedVehicleImages,
} from "@/src/services/vehicle-images/vehicle-image-queue.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BACKFILL_TOKEN = process.env.VEHICLE_IMAGE_BACKFILL_TOKEN?.trim() || "";
const CRON_SECRET = process.env.CRON_SECRET?.trim() || "";

function authorized(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const supplied = request.headers.get("x-backfill-token") || request.nextUrl.searchParams.get("token") || "";
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  const isVercelCron = request.method === "GET"
    && (request.headers.get("user-agent") || "").toLowerCase().startsWith("vercel-cron/");
  return Boolean(
    (BACKFILL_TOKEN && (supplied === BACKFILL_TOKEN || bearer === BACKFILL_TOKEN))
    || (CRON_SECRET && bearer === CRON_SECRET)
    || (!BACKFILL_TOKEN && !CRON_SECRET && isVercelCron),
  );
}

function hidden() {
  return NextResponse.json({ ok: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

async function run(request: NextRequest) {
  if (!authorized(request)) return hidden();
  const requested = Number(request.nextUrl.searchParams.get("limit") || "8");
  const enqueued = await enqueueMissingVehicleImages(requested);
  const processed = await processQueuedVehicleImages(Math.min(requested, 4));
  return NextResponse.json({ ok: true, enqueued, processed }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  try {
    return await run(request);
  } catch (error) {
    console.error("vehicle image queue worker failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не вдалося обробити чергу зображень." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    return await run(request);
  } catch (error) {
    console.error("vehicle image queue worker failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Не вдалося обробити чергу зображень." }, { status: 500 });
  }
}
