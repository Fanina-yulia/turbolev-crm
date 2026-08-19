import { NextRequest, NextResponse } from "next/server";
import { sendCommunicationReply } from "@/src/services/communication-delivery.service";

export const runtime = "nodejs";

function statusForError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  if (code === "TEXT_REQUIRED" || code === "ATTACHMENT_INVALID" || code === "ATTACHMENT_EMPTY" || code === "ATTACHMENT_LIMIT") return 400;
  if (code === "INQUIRY_NOT_FOUND") return 404;
  if (code === "META_REPLY_WINDOW_EXPIRED") return 409;
  if (code === "ATTACHMENT_TOO_LARGE") return 413;
  if (code === "ATTACHMENT_TYPE_NOT_ALLOWED") return 415;
  if (code === "ATTACHMENT_OWNERSHIP_INVALID" || code === "ATTACHMENT_CHANNEL_NOT_SUPPORTED" || code === "META_ATTACHMENT_LIMIT" || code === "META_ATTACHMENT_TYPE_NOT_SUPPORTED") return 422;
  if (code.includes("NOT_CONFIGURED") || code.includes("NOT_AUTHORIZED") || code.includes("REAUTH_REQUIRED") || code.includes("TARGET_MISSING") || code.includes("THREAD_MISSING")) return 422;
  if (code === "OLX_RATE_LIMITED") return 429;
  return 502;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const text = String(body.text || "").trim();
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (!text) return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });
    const result = await sendCommunicationReply(id, text, attachments);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("POST /api/communications/[id]/messages failed", error);
    const message = error instanceof Error ? error.message : "Failed to deliver message";
    const code = typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code || "DELIVERY_FAILED")
      : "DELIVERY_FAILED";
    return NextResponse.json({ ok: false, error: message, code }, { status: statusForError(error) });
  }
}
