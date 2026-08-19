import { NextRequest, NextResponse } from "next/server";
import { getCommunicationAttachmentByProviderToken } from "@/src/services/communication-attachments.service";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const attachment = await getCommunicationAttachmentByProviderToken(token);
  if (!attachment) return NextResponse.json({ ok: false, error: "Asset not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(attachment.fileData), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.fileSize),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
