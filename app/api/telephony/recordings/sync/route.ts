import { NextRequest, NextResponse } from "next/server";
import { CallStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { getSqlPool } from "@/src/lib/sql";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getBinotelService } from "@/src/services/binotel.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const access = await authorize(PERMISSIONS.COMMUNICATIONS_WRITE, {
    request,
    strict: true,
    minimumScope: "TEAM",
  });
  if (!access.allowed) return access.response!;

  try {
    const prisma = getPrisma();
    const body = await request.json().catch(() => ({}));
    const requestedLimit = Number(body?.limit || 10);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 10, 1), 25);
    const cutoff = new Date(Date.now() - 8_000);
    const from = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const calls = await prisma.callHistory.findMany({
      where: {
        status: CallStatus.ANSWERED,
        recordingUrl: null,
        endedAt: { not: null, lte: cutoff, gte: from },
      },
      select: { id: true, binotelCallId: true },
      orderBy: { endedAt: "desc" },
      take: limit,
    });

    let updated = 0;
    let unavailable = 0;
    const failed: Array<{ callId: string; message: string }> = [];
    const service = getBinotelService();
    const pool = getSqlPool();

    for (const call of calls) {
      try {
        const media = await service.getMediaFileLink(call.binotelCallId);
        if (!media.url) {
          unavailable += 1;
          continue;
        }
        await prisma.callHistory.update({
          where: { id: call.id },
          data: { recordingUrl: media.url },
        });
        await pool.query(
          `UPDATE "CommunicationInquiry"
             SET "metadata" = jsonb_set(COALESCE("metadata", '{}'::jsonb), '{recordingAvailable}', 'true'::jsonb, true),
                 "updatedAt" = CURRENT_TIMESTAMP
           WHERE "channel"='BINOTEL' AND "metadata"->>'callId'=$1`,
          [call.binotelCallId],
        );
        updated += 1;
      } catch (error) {
        failed.push({
          callId: call.binotelCallId,
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      checked: calls.length,
      updated,
      unavailable,
      failed,
      pending: calls.length - updated,
    });
  } catch (error) {
    console.error("POST /api/telephony/recordings/sync failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося синхронізувати записи розмов." }, { status: 500 });
  }
}
