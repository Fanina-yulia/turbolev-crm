import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSqlPool } from "@/src/lib/sql";
import { getBinotelService } from "@/src/services/binotel.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOKEN_SHA256 = "e5894f995b543180e7e8695a5ec0125c9ea60b01f39cc56ab5be77423bec73ec";
const PBX = new Set(["0983415646", "380983415646"]);

function authorized(token: string | null) {
  if (!token) return false;
  const digest = createHash("sha256").update(token, "utf8").digest("hex");
  const a = Buffer.from(digest, "hex");
  const b = Buffer.from(TOKEN_SHA256, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function fileName(row: any) {
  const stamp = row.startedAt ? new Date(row.startedAt).toISOString().replace(/[:.]/g, "-") : "unknown-time";
  const ext = String(row.externalNumber || "unknown").replace(/\D/g, "") || "unknown";
  return `${stamp}_${row.type || "CALL"}_${ext}_${row.binotelCallId}.mp3`;
}

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ ok: false, error: "PREVIEW_ONLY" }, { status: 404 });
  }

  if (!authorized(request.nextUrl.searchParams.get("token"))) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const offset = Math.max(0, Number.parseInt(request.nextUrl.searchParams.get("offset") || "0", 10) || 0);
  const limit = Math.min(20, Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("limit") || "20", 10) || 20));
  const pool = getSqlPool();

  const totalResult = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM public."CallHistory"
      WHERE "status"='ANSWERED'
        AND "startedAt" >= CURRENT_TIMESTAMP - INTERVAL '14 days'
        AND (
          COALESCE("rawPayload"->>'pbxNumber','') = ANY($1::text[])
          OR COALESCE("rawPayload"::text,'') LIKE '%0983415646%'
          OR COALESCE("rawPayload"::text,'') LIKE '%380983415646%'
        )`,
    [Array.from(PBX)],
  );

  const result = await pool.query(
    `SELECT "binotelCallId","externalNumber","internalNumber","type","duration","startedAt"
       FROM public."CallHistory"
      WHERE "status"='ANSWERED'
        AND "startedAt" >= CURRENT_TIMESTAMP - INTERVAL '14 days'
        AND (
          COALESCE("rawPayload"->>'pbxNumber','') = ANY($1::text[])
          OR COALESCE("rawPayload"::text,'') LIKE '%0983415646%'
          OR COALESCE("rawPayload"::text,'') LIKE '%380983415646%'
        )
      ORDER BY "startedAt" DESC
      OFFSET $2 LIMIT $3`,
    [Array.from(PBX), offset, limit],
  );

  const service = getBinotelService();
  const items = await Promise.all(result.rows.map(async (row: any) => {
    try {
      const media = await service.getMediaFileLink(String(row.binotelCallId));
      return {
        callId: String(row.binotelCallId),
        externalNumber: row.externalNumber,
        internalNumber: row.internalNumber,
        type: row.type,
        duration: row.duration,
        startedAt: row.startedAt,
        fileName: fileName(row),
        url: media.url,
        error: media.url ? null : "NO_RECORDING_URL",
      };
    } catch (error) {
      return {
        callId: String(row.binotelCallId),
        externalNumber: row.externalNumber,
        internalNumber: row.internalNumber,
        type: row.type,
        duration: row.duration,
        startedAt: row.startedAt,
        fileName: fileName(row),
        url: null,
        error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      };
    }
  }));

  return NextResponse.json({
    ok: true,
    total: Number(totalResult.rows[0]?.count || 0),
    offset,
    limit,
    returned: items.length,
    items,
  }, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
