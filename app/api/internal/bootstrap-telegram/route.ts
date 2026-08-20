import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  isIntegrationConfigured,
  saveIntegrationCredential,
} from "@/src/services/integration-credentials.service";
import { configureTelegramWebhook } from "@/src/services/telegram.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPECTED_TOKEN_HASH = "3874d49347defcb9534543ccb94ce62045803f580bd5ca14ca152975335a8cd3";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: NextRequest) {
  try {
    if (await isIntegrationConfigured("TELEGRAM")) {
      return NextResponse.json({ ok: false, error: "ALREADY_CONFIGURED" }, { status: 409 });
    }

    const body = await request.json().catch(() => null) as { botToken?: unknown; botUsername?: unknown } | null;
    const botToken = typeof body?.botToken === "string" ? body.botToken.trim() : "";
    const botUsername = typeof body?.botUsername === "string" ? body.botUsername.trim().replace(/^@/, "") : "";
    if (!botToken || !safeEqualHex(sha256(botToken), EXPECTED_TOKEN_HASH)) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }
    if (!botUsername) {
      return NextResponse.json({ ok: false, error: "USERNAME_REQUIRED" }, { status: 400 });
    }

    const saved = await saveIntegrationCredential("TELEGRAM", { botToken, botUsername });
    const webhook = await configureTelegramWebhook(request.nextUrl.origin);
    return NextResponse.json({
      ok: true,
      provider: saved.provider,
      configured: saved.configured,
      webhook,
      webhookSecret: saved.generated.webhookSecret || null,
    });
  } catch (error) {
    console.error("POST /api/internal/bootstrap-telegram failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ ok: false, error: "BOOTSTRAP_FAILED" }, { status: 500 });
  }
}
