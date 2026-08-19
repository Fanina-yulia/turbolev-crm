import { NextRequest, NextResponse } from "next/server";
import { getCommunicationAttachmentById } from "@/src/services/communication-attachments.service";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ attachmentId: string }> }) {
  const { attachmentId } = await context.params;
  const attachment = await getCommunicationAttachmentById(attachmentId);
  if (!attachment) return NextResponse.json({ ok: false, error: "Вкладення не знайдено" }, { status: 404 });
  return new NextResponse(new Uint8Array(attachment.fileData), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.fileSize),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
