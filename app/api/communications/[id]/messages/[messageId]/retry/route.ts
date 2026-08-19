import { NextRequest, NextResponse } from "next/server";
import { retryCommunicationMessage } from "@/src/services/communication-delivery.service";

export const runtime = "nodejs";

function statusForError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  if (code === "INQUIRY_NOT_FOUND" || code === "MESSAGE_NOT_FOUND") return 404;
  if (code === "META_REPLY_WINDOW_EXPIRED" || code === "MESSAGE_NOT_FAILED" || code === "MESSAGE_NOT_RETRYABLE" || code === "MESSAGE_RETRY_IN_PROGRESS") return 409;
  if (code === "RETRY_NOT_SUPPORTED") return 422;
  if (code.includes("NOT_CONFIGURED") || code.includes("NOT_AUTHORIZED") || code.includes("REAUTH_REQUIRED") || code.includes("TARGET_MISSING") || code.includes("THREAD_MISSING")) return 422;
  if (code === "OLX_RATE_LIMITED") return 429;
  return 502;
}

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string; messageId: string }> }) {
  try {
    const { id, messageId } = await context.params;
    const result = await retryCommunicationMessage(id, messageId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("POST communication retry failed", error);
    const message = error instanceof Error ? error.message : "Не вдалося повторити відправлення";
    const code = typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code || "DELIVERY_FAILED")
      : "DELIVERY_FAILED";
    return NextResponse.json({ ok: false, error: message, code }, { status: statusForError(error) });
  }
}
