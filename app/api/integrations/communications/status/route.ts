import { NextResponse } from "next/server";
import { getSqlPool } from "@/src/lib/sql";
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

export async function GET() {
  try {
    const [statuses, syncResult, webhookResult] = await Promise.all([
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
    ]);

    const byProvider = new Map(statuses.map((item) => [item.provider, item]));
    const sync = new Map(syncResult.rows.map((item) => [item.provider, item]));
    const hooks = new Map(webhookResult.rows.map((item) => [item.channel, item.receivedAt]));
    const meta = byProvider.get("META");
    const olx = byProvider.get("OLX");
    const olxSync = sync.get("OLX");

    return NextResponse.json({
      ok: true,
      meta: {
        configured: Boolean(meta?.configured),
        status: meta?.lastTestStatus || meta?.status || (meta?.configured ? "CONFIGURED" : "NOT_CONFIGURED"),
        lastTestAt: meta?.lastTestAt || null,
        lastTestMessage: meta?.lastTestMessage || null,
        lastFacebookEventAt: hooks.get("FACEBOOK")?.toISOString?.() || null,
        lastInstagramEventAt: hooks.get("INSTAGRAM")?.toISOString?.() || null,
        webhookPath: "/api/webhooks/meta",
      },
      olx: {
        configured: Boolean(olx?.configured),
        status: olxSync?.status || olx?.lastTestStatus || olx?.status || (olx?.configured ? "CONFIGURED" : "NOT_CONFIGURED"),
        lastTestAt: olx?.lastTestAt || null,
        lastTestMessage: olx?.lastTestMessage || null,
        lastSyncedAt: olxSync?.lastSyncedAt?.toISOString?.() || null,
        lastSuccessAt: olxSync?.lastSuccessAt?.toISOString?.() || null,
        error: olxSync?.error || null,
      },
    });
  } catch (error) {
    console.error("GET communication integration status failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося отримати стан інтеграцій" }, { status: 500 });
  }
}
