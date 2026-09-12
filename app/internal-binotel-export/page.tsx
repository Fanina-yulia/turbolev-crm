import { createHash, timingSafeEqual } from "node:crypto";
import { notFound } from "next/navigation";
import { getSqlPool } from "@/src/lib/sql";
import { getBinotelService } from "@/src/services/binotel.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOKEN_SHA256 = "e5894f995b543180e7e8695a5ec0125c9ea60b01f39cc56ab5be77423bec73ec";
const PBX = ["0983415646", "380983415646"];

function authorized(token: string | undefined) {
  if (!token) return false;
  const digest = createHash("sha256").update(token, "utf8").digest();
  const expected = Buffer.from(TOKEN_SHA256, "hex");
  return digest.length === expected.length && timingSafeEqual(digest, expected);
}

function fileName(row: any) {
  const stamp = row.startedAt ? new Date(row.startedAt).toISOString().replace(/[:.]/g, "-") : "unknown-time";
  const ext = String(row.externalNumber || "unknown").replace(/\D/g, "") || "unknown";
  return `${stamp}_${row.type || "CALL"}_${ext}_${row.binotelCallId}.mp3`;
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function InternalBinotelExportPage({ searchParams }: Props) {
  if (process.env.VERCEL_ENV === "production") notFound();

  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  if (!authorized(token)) notFound();

  const offsetRaw = Array.isArray(params.offset) ? params.offset[0] : params.offset;
  const limitRaw = Array.isArray(params.limit) ? params.limit[0] : params.limit;
  const offset = Math.max(0, Number.parseInt(offsetRaw || "0", 10) || 0);
  const limit = Math.min(20, Math.max(1, Number.parseInt(limitRaw || "20", 10) || 20));
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
    [PBX],
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
    [PBX, offset, limit],
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

  const payload = {
    ok: true,
    total: Number(totalResult.rows[0]?.count || 0),
    offset,
    limit,
    returned: items.length,
    items,
  };

  return <pre>{JSON.stringify(payload)}</pre>;
}
