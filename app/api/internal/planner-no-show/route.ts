import { NextRequest, NextResponse } from "next/server";
import { markExpiredBookedAppointmentsAsNoShow } from "@/src/services/planner-no-show.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CRON_SECRET = process.env.CRON_SECRET?.trim() || "";

function authorized(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  const isVercelCron = request.method === "GET"
    && (request.headers.get("user-agent") || "").toLowerCase().startsWith("vercel-cron/");

  return Boolean(
    (CRON_SECRET && bearer === CRON_SECRET)
    || (!CRON_SECRET && isVercelCron),
  );
}

function hidden() {
  return NextResponse.json(
    { ok: false },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return hidden();

  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") || "250");
    const result = await markExpiredBookedAppointments(new Date(), limit);

    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("planner no-show worker failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Не вдалося оновити неприбулі записи.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
