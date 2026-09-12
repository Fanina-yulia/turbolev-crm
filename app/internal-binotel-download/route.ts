import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { strToU8, zipSync } from "fflate";
import { getSqlPool } from "@/src/lib/sql";
import { getBinotelService } from "@/src/services/binotel.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOKEN_SHA256 = "e5894f995b543180e7e8695a5ec0125c9ea60b01f39cc56ab5be77423bec73ec";
const EXPIRES_AT = Date.parse("2026-09-12T16:00:00Z");
const PBX = ["0983415646", "380983415646"];
const REPOSITORY = "Fanina-yulia/turbolev-crm";

function authorizedOneTimeToken(token: string | null) {
  if (!token || Date.now() > EXPIRES_AT) return false;
  const digest = createHash("sha256").update(token, "utf8").digest();
  const expected = Buffer.from(TOKEN_SHA256, "hex");
  return digest.length === expected.length && timingSafeEqual(digest, expected);
}

async function authorizedGitHubActionsToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return false;

  try {
    const response = await fetch("https://api.github.com/installation/repositories?per_page=100", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "TurboLEV-Binotel-Export",
      },
      cache: "no-store",
    });
    if (!response.ok) return false;
    const data = await response.json() as { repositories?: Array<{ full_name?: string }> };
    return Array.isArray(data.repositories) && data.repositories.some((repo) => repo.full_name === REPOSITORY);
  } catch {
    return false;
  }
}

async function authorized(request: NextRequest) {
  if (authorizedOneTimeToken(request.nextUrl.searchParams.get("token"))) return true;
  return authorizedGitHubActionsToken(request);
}

function fileName(row: any) {
  const stamp = row.startedAt ? new Date(row.startedAt).toISOString().replace(/[:.]/g, "-") : "unknown-time";
  const ext = String(row.externalNumber || "unknown").replace(/\D/g, "") || "unknown";
  return `${stamp}_${row.type || "CALL"}_${ext}_${row.binotelCallId}.mp3`;
}

export async function GET(request: NextRequest) {
  if (!(await authorized(request))) {
    return new Response("NOT_FOUND", { status: 404 });
  }

  const offset = Math.max(0, Number.parseInt(request.nextUrl.searchParams.get("offset") || "0", 10) || 0);
  const limit = Math.min(5, Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("limit") || "5", 10) || 5));
  const pool = getSqlPool();
  const rows = await pool.query(
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
  const entries: Record<string, Uint8Array> = {};
  const manifest: Array<Record<string, unknown>> = [];

  for (const row of rows.rows as any[]) {
    const item = {
      callId: String(row.binotelCallId),
      externalNumber: row.externalNumber,
      internalNumber: row.internalNumber,
      type: row.type,
      duration: row.duration,
      startedAt: row.startedAt,
      fileName: fileName(row),
    };

    try {
      const media = await service.getMediaFileLink(item.callId);
      if (!media.url) {
        manifest.push({ ...item, downloaded: false, error: "NO_RECORDING_URL" });
        continue;
      }
      const response = await fetch(media.url, { cache: "no-store" });
      if (!response.ok) {
        manifest.push({ ...item, downloaded: false, error: `HTTP_${response.status}` });
        continue;
      }
      entries[item.fileName] = new Uint8Array(await response.arrayBuffer());
      manifest.push({ ...item, downloaded: true, error: null });
    } catch (error) {
      manifest.push({
        ...item,
        downloaded: false,
        error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      });
    }
  }

  entries["manifest.json"] = strToU8(JSON.stringify({ offset, limit, items: manifest }, null, 2));
  const archive = zipSync(entries, { level: 0 });
  const body = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);

  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="binotel_${offset}_${offset + Math.max(0, rows.rows.length - 1)}.zip"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
