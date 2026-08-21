import { NextRequest } from "next/server";
import { CallStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getBinotelService } from "@/src/services/binotel.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function copyHeader(source: Headers, target: Headers, name: string) {
  const value = source.get(name);
  if (value) target.set(name, value);
}

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
    if (!normalizedCallId) return new Response("CALL_ID_REQUIRED", { status: 400 });

    const prisma = getPrisma();
    const call = await prisma.callHistory.findUnique({
      where: { binotelCallId: normalizedCallId },
      select: {
        id: true,
        binotelCallId: true,
        status: true,
        endedAt: true,
        recordingUrl: true,
      },
    });

    if (!call) return new Response("CALL_NOT_FOUND", { status: 404 });
    if (call.status !== CallStatus.ANSWERED || !call.endedAt) {
      return new Response("RECORDING_NOT_AVAILABLE", { status: 404 });
    }

    const media = await getBinotelService().getMediaFileLink(call.binotelCallId);
    if (!media.url) return new Response("RECORDING_NOT_AVAILABLE", { status: 404 });

    if (media.url !== call.recordingUrl) {
      await prisma.callHistory.update({
        where: { id: call.id },
        data: { recordingUrl: media.url },
      }).catch(() => undefined);
    }

    const providerHeaders: HeadersInit = {};
    const range = request.headers.get("range");
    if (range) providerHeaders.Range = range;

    const providerResponse = await fetch(media.url, {
      method: "GET",
      headers: providerHeaders,
      cache: "no-store",
      signal: request.signal,
    });

    if (!providerResponse.ok && providerResponse.status !== 206) {
      console.warn("Binotel recording stream provider failed", {
        callId: call.binotelCallId,
        status: providerResponse.status,
      });
      return new Response("RECORDING_PROVIDER_FAILED", { status: 502 });
    }

    const headers = new Headers({
      "Cache-Control": "private, no-store, max-age=0",
      "Accept-Ranges": providerResponse.headers.get("accept-ranges") || "bytes",
      "Content-Type": providerResponse.headers.get("content-type") || "audio/mpeg",
      "X-Content-Type-Options": "nosniff",
    });
    copyHeader(providerResponse.headers, headers, "content-length");
    copyHeader(providerResponse.headers, headers, "content-range");
    copyHeader(providerResponse.headers, headers, "etag");
    copyHeader(providerResponse.headers, headers, "last-modified");

    return new Response(providerResponse.body, {
      status: providerResponse.status === 206 ? 206 : 200,
      headers,
    });
  } catch (error) {
    console.error("GET Binotel recording stream failed", error);
    return new Response("RECORDING_STREAM_FAILED", { status: 500 });
  }
}
