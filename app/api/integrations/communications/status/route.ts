import { NextResponse } from "next/server";
import { getSqlPool } from "@/src/lib/sql";
import { buildCommunicationActivationDiagnostics } from "@/src/services/communication-activation-diagnostics";
import { listIntegrationPublicStatuses } from "@/src/services/integration-credentials.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SyncRow = {
  provider: string;
  lastSyncedAt: Date | null;
  lastSuccessAt: Date | null;
  status: string;
  error: string | null;
  metadata: unknown;
};

type WebhookRow = {
  channel: string;
  receivedAt: Date | null;
};

type MessageActivityRow = {
  channel: string;
  inboundAt: Date | null;
  outboundAcceptedAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
};

function iso(value?: Date | null) {
  return value?.toISOString?.() || null;
}

function upper(value?: string | null) {
  return String(value || "").toUpperCase();
}

export async function GET() {
  try {
    const [statuses, syncResult, webhookResult, messageActivityResult] = await Promise.all([
      listIntegrationPublicStatuses(),
      getSqlPool().query<SyncRow>(
        `SELECT "provider","lastSyncedAt","lastSuccessAt","status","error","metadata"
         FROM "CommunicationSyncState" WHERE "provider" IN ('OLX','META')`,
      ).catch(() => ({ rows: [] as SyncRow[] })),
      getSqlPool().query<WebhookRow>(
        `SELECT "channel", MAX("createdAt") AS "receivedAt"
         FROM "WebhookEvent" WHERE "channel" IN ('FACEBOOK','INSTAGRAM','OLX')
         GROUP BY "channel"`,
      ).catch(() => ({ rows: [] as WebhookRow[] })),
      getSqlPool().query<MessageActivityRow>(
        `SELECT i."channel" AS "channel",
                MAX(m."sentAt") FILTER (WHERE m."direction"='IN') AS "inboundAt",
                MAX(m."sentAt") FILTER (WHERE m."direction"='OUT' AND m."deliveryStatus" IN ('SENT','DELIVERED','READ')) AS "outboundAcceptedAt",
                MAX(m."sentAt") FILTER (WHERE m."direction"='OUT' AND m."deliveryStatus"='DELIVERED') AS "deliveredAt",
                MAX(m."sentAt") FILTER (WHERE m."direction"='OUT' AND m."deliveryStatus"='READ') AS "readAt",
                MAX(m."sentAt") FILTER (WHERE m."direction"='OUT' AND m."deliveryStatus"='FAILED') AS "failedAt"
         FROM "CommunicationMessage" m
         JOIN "CommunicationInquiry" i ON i."id"=m."inquiryId"
         WHERE i."channel" IN ('FACEBOOK','INSTAGRAM','OLX')
         GROUP BY i."channel"`,
      ).catch(() => ({ rows: [] as MessageActivityRow[] })),
    ]);

    const byProvider = new Map(statuses.map((item) => [item.provider, item]));
    const sync = new Map(syncResult.rows.map((item) => [item.provider, item]));
    const hooks = new Map(webhookResult.rows.map((item) => [item.channel, item.receivedAt]));
    const activity = new Map(messageActivityResult.rows.map((item) => [item.channel, item]));
    const meta = byProvider.get("META");
    const olx = byProvider.get("OLX");
    const olxSync = sync.get("OLX");
    const metaStatus = upper(meta?.lastTestStatus || meta?.status);
    const olxStatus = upper(olxSync?.status || olx?.lastTestStatus || olx?.status);
    const metaApiConnected = metaStatus === "CONNECTED" || Boolean(hooks.get("FACEBOOK") || hooks.get("INSTAGRAM"));
    const olxApiConnected = olxStatus === "CONNECTED" || olxStatus === "READY" || Boolean(olxSync?.lastSuccessAt);

    const diagnostics = buildCommunicationActivationDiagnostics([
      {
        key: "FACEBOOK",
        label: "Facebook Messenger",
        provider: "META",
        configured: Boolean(meta?.configured),
        apiConnected: metaApiConnected,
        apiAt: meta?.lastTestAt || null,
        apiError: metaStatus === "ERROR" ? meta?.lastTestMessage || "Meta API повернув помилку." : null,
        transportLabel: "Webhook",
        transportReady: Boolean(hooks.get("FACEBOOK")),
        transportAt: iso(hooks.get("FACEBOOK")),
        inboundAt: iso(activity.get("FACEBOOK")?.inboundAt),
        outboundAcceptedAt: iso(activity.get("FACEBOOK")?.outboundAcceptedAt),
        deliveredAt: iso(activity.get("FACEBOOK")?.deliveredAt),
        readAt: iso(activity.get("FACEBOOK")?.readAt),
        failedAt: iso(activity.get("FACEBOOK")?.failedAt),
      },
      {
        key: "INSTAGRAM",
        label: "Instagram Direct",
        provider: "META",
        configured: Boolean(meta?.configured),
        apiConnected: metaApiConnected,
        apiAt: meta?.lastTestAt || null,
        apiError: metaStatus === "ERROR" ? meta?.lastTestMessage || "Meta API повернув помилку." : null,
        transportLabel: "Webhook",
        transportReady: Boolean(hooks.get("INSTAGRAM")),
        transportAt: iso(hooks.get("INSTAGRAM")),
        inboundAt: iso(activity.get("INSTAGRAM")?.inboundAt),
        outboundAcceptedAt: iso(activity.get("INSTAGRAM")?.outboundAcceptedAt),
        deliveredAt: iso(activity.get("INSTAGRAM")?.deliveredAt),
        readAt: iso(activity.get("INSTAGRAM")?.readAt),
        failedAt: iso(activity.get("INSTAGRAM")?.failedAt),
      },
      {
        key: "OLX",
        label: "OLX",
        provider: "OLX",
        configured: Boolean(olx?.configured),
        apiConnected: olxApiConnected,
        apiAt: olx?.lastTestAt || iso(olxSync?.lastSuccessAt),
        apiError: olxStatus === "ERROR" ? olxSync?.error || olx?.lastTestMessage || "OLX API повернув помилку." : null,
        transportLabel: "OAuth",
        transportReady: olxStatus === "READY" || Boolean(olxSync?.lastSuccessAt),
        transportAt: iso(olxSync?.lastSuccessAt),
        transportError: olxSync?.error || null,
        inboundAt: iso(activity.get("OLX")?.inboundAt),
        outboundAcceptedAt: iso(activity.get("OLX")?.outboundAcceptedAt),
        deliveredAt: iso(activity.get("OLX")?.deliveredAt),
        readAt: iso(activity.get("OLX")?.readAt),
        failedAt: iso(activity.get("OLX")?.failedAt),
      },
    ]);

    return NextResponse.json({
      ok: true,
      meta: {
        configured: Boolean(meta?.configured),
        status: meta?.lastTestStatus || meta?.status || (meta?.configured ? "CONFIGURED" : "NOT_CONFIGURED"),
        lastTestAt: meta?.lastTestAt || null,
        lastTestMessage: meta?.lastTestMessage || null,
        lastFacebookEventAt: iso(hooks.get("FACEBOOK")),
        lastInstagramEventAt: iso(hooks.get("INSTAGRAM")),
        webhookPath: "/api/webhooks/meta",
      },
      olx: {
        configured: Boolean(olx?.configured),
        status: olxSync?.status || olx?.lastTestStatus || olx?.status || (olx?.configured ? "CONFIGURED" : "NOT_CONFIGURED"),
        lastTestAt: olx?.lastTestAt || null,
        lastTestMessage: olx?.lastTestMessage || null,
        lastSyncedAt: iso(olxSync?.lastSyncedAt),
        lastSuccessAt: iso(olxSync?.lastSuccessAt),
        error: olxSync?.error || null,
      },
      diagnostics,
    });
  } catch (error) {
    console.error("GET communication integration status failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося отримати стан інтеграцій" }, { status: 500 });
  }
}
