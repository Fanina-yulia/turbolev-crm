import { NextRequest, NextResponse } from "next/server";
import { CommunicationChannel } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getIntegrationCredential, listIntegrationPublicStatuses } from "@/src/services/integration-credentials.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, {
    request,
    strict: true,
    minimumScope: "ALL",
  });
  if (!access.allowed) return access.response!;

  try {
    const prisma = getPrisma();
    const [statuses, credentials, lastWebhook, recentWebhookErrors, lastCall, callCounts, userCounts] = await Promise.all([
      listIntegrationPublicStatuses(),
      getIntegrationCredential("BINOTEL").catch(() => null),
      prisma.webhookEvent.findFirst({
        where: { channel: CommunicationChannel.BINOTEL },
        select: { eventType: true, status: true, processedAt: true, createdAt: true, error: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.webhookEvent.count({
        where: {
          channel: CommunicationChannel.BINOTEL,
          status: "ERROR",
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.callHistory.findFirst({
        select: { binotelCallId: true, type: true, status: true, startedAt: true, endedAt: true, recordingUrl: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.callHistory.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.user.aggregate({
        _count: { _all: true, internalNumber: true },
        where: { isActive: true },
      }),
    ]);

    const publicStatus = statuses.find((item) => item.provider === "BINOTEL") || null;
    const counts = Object.fromEntries(callCounts.map((item) => [item.status || "ACTIVE", item._count._all]));

    return NextResponse.json({
      ok: Boolean(publicStatus?.configured),
      configured: Boolean(publicStatus?.configured),
      configuredVia: publicStatus?.configuredVia || null,
      connectionStatus: publicStatus?.lastTestStatus || publicStatus?.status || null,
      lastConnectionTestAt: publicStatus?.lastTestAt || null,
      lastConnectionMessage: publicStatus?.lastTestMessage || null,
      companyIdConfigured: Boolean(credentials?.companyId),
      webhookTokenConfigured: Boolean(credentials?.webhookToken),
      websocketConfigured: Boolean(credentials?.wsKey && credentials?.wsSecret),
      webhook: lastWebhook ? {
        eventType: lastWebhook.eventType,
        status: lastWebhook.status,
        at: lastWebhook.processedAt || lastWebhook.createdAt,
        error: lastWebhook.error,
        errors24h: recentWebhookErrors,
      } : null,
      calls: {
        total: Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0),
        byStatus: counts,
        last: lastCall ? {
          callId: lastCall.binotelCallId,
          type: lastCall.type,
          status: lastCall.status,
          startedAt: lastCall.startedAt,
          endedAt: lastCall.endedAt,
          recordingAvailable: Boolean(lastCall.recordingUrl),
        } : null,
      },
      users: {
        active: userCounts._count._all,
        mappedExtensions: userCounts._count.internalNumber,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("GET Binotel telephony status failed", error);
    return NextResponse.json({ ok: false, error: "BINOTEL_STATUS_FAILED" }, { status: 500 });
  }
}
