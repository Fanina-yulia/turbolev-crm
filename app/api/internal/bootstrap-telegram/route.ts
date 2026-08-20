import { NextResponse } from "next/server";
import { getSqlPool } from "@/src/lib/sql";
import {
  isIntegrationConfigured,
  saveIntegrationCredential,
} from "@/src/services/integration-credentials.service";
import { configureTelegramWebhook, testTelegramConnection } from "@/src/services/telegram.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOOTSTRAP_KEY = "TELEGRAM_BOOTSTRAP_TOKEN";
const PRODUCTION_ORIGIN = "https://turbolev-crm.vercel.app";

export async function GET() {
  const pool = getSqlPool();
  try {
    const configured = await isIntegrationConfigured("TELEGRAM");
    if (!configured) {
      const result = await pool.query(
        `SELECT "value" FROM public."CrmSetting" WHERE "key"=$1 LIMIT 1`,
        [BOOTSTRAP_KEY],
      );
      const value = result.rows[0]?.value as { botToken?: unknown; botUsername?: unknown } | undefined;
      const botToken = typeof value?.botToken === "string" ? value.botToken.trim() : "";
      const botUsername = typeof value?.botUsername === "string" ? value.botUsername.trim().replace(/^@/, "") : "";
      if (!botToken || !botUsername) {
        return NextResponse.json({ ok: false, error: "BOOTSTRAP_VALUE_MISSING" }, { status: 404 });
      }
      await saveIntegrationCredential("TELEGRAM", { botToken, botUsername });
    }

    const webhook = await configureTelegramWebhook(PRODUCTION_ORIGIN);
    const test = await testTelegramConnection();
    await pool.query(`DELETE FROM public."CrmSetting" WHERE "key"=$1`, [BOOTSTRAP_KEY]);

    return NextResponse.json({
      ok: true,
      provider: "TELEGRAM",
      configured: true,
      webhook,
      test,
      bootstrapCleared: true,
    });
  } catch (error) {
    console.error("GET /api/internal/bootstrap-telegram failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ ok: false, error: "BOOTSTRAP_FAILED" }, { status: 500 });
  }
}
