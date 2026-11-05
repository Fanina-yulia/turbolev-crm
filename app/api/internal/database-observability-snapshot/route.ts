import { NextRequest, NextResponse } from "next/server";
import { captureDatabaseQueryStatSnapshot } from "@/src/services/database-observability.service";
import { reconcileCompensation } from "@/src/services/compensation-engine.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET?.trim() || "";

function authorized(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  const isVercelCron = request.method === "GET"
    && (request.headers.get("user-agent") || "").toLowerCase().startsWith("vercel-cron/");
  return Boolean((CRON_SECRET && bearer === CRON_SECRET) || (!CRON_SECRET && isVercelCron));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const compensation = await reconcileCompensation(new Date());
    const result = await captureDatabaseQueryStatSnapshot();
    return NextResponse.json({ ok: true, result, compensation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("daily maintenance snapshot failed", error);
    return NextResponse.json({ ok: false, error: "daily_maintenance_failed" }, { status: 500 });
  }
}
