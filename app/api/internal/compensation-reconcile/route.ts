import { NextRequest, NextResponse } from "next/server";
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

function hidden() {
  return NextResponse.json({ ok: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return hidden();
  try {
    const result = await reconcileCompensation(new Date());
    return NextResponse.json({ ok: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("compensation reconciliation failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "COMPENSATION_RECONCILIATION_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
