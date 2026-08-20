import { NextRequest, NextResponse } from "next/server";
import {
  processTelegramUpdate,
  verifyTelegramWebhookSecret,
  type TelegramUpdate,
} from "@/src/services/telegram.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get("x-telegram-bot-api-secret-token");
    if (!(await verifyTelegramWebhookSecret(secret))) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    const update = await request.json() as TelegramUpdate;
    if (!update || typeof update.update_id !== "number") {
      return NextResponse.json({ ok: false, error: "Invalid Telegram update" }, { status: 400 });
    }

    const result = await processTelegramUpdate(update);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Telegram webhook failed", error);
    // Telegram retries non-2xx updates. For transient provider/database errors we return 500.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
