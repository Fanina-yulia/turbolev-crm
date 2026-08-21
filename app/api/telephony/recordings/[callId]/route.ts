import { NextRequest, NextResponse } from "next/server";
import { CallStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getBinotelService } from "@/src/services/binotel.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ callId: string }> }) {
  const access = await authorize(PERMISSIONS.COMMUNICATIONS_READ, {
    request,
    strict: true,
    minimumScope: "TEAM",
  });
  if (!access.allowed) return access.response!;

  try {
    const { callId } = await context.params;
    const normalizedCallId = decodeURIComponent(callId || "").trim();
    if (!normalizedCallId) {
      return NextResponse.json({ ok: false, error: "CALL_ID_REQUIRED" }, { status: 400 });
    }

    const prisma = getPrisma();
    const call = await prisma.callHistory.findUnique({
      where: { binotelCallId: normalizedCallId },
      select: {
        id: true,
        binotelCallId: true,
        status: true,
        recordingUrl: true,
        clientId: true,
        leadId: true,
        managerId: true,
        endedAt: true,
      },
    });
    if (!call) return NextResponse.json({ ok: false, error: "CALL_NOT_FOUND" }, { status: 404 });

    // Binotel call-record URLs are short-lived. Resolve a fresh provider URL to
    // confirm availability, but never expose that temporary S3 URL to the
    // browser. Playback goes through the authenticated same-origin stream route.
    let available = false;
    if (call.status === CallStatus.ANSWERED && call.endedAt) {
      try {
        const media = await getBinotelService().getMediaFileLink(call.binotelCallId);
        if (media.url) {
          available = true;
          if (media.url !== call.recordingUrl) {
            await prisma.callHistory.update({
              where: { id: call.id },
              data: { recordingUrl: media.url },
            });
          }
        }
      } catch (error) {
        console.warn("Binotel recording resolve failed", {
          callId: call.binotelCallId,
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      callId: call.binotelCallId,
      available,
      url: available ? `/api/telephony/recordings/${encodeURIComponent(call.binotelCallId)}/stream` : null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("GET Binotel recording failed", error);
    return NextResponse.json({ ok: false, error: "RECORDING_LOOKUP_FAILED" }, { status: 500 });
  }
}
