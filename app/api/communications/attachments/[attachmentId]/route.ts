import { NextRequest, NextResponse } from "next/server";
import { getCommunicationAttachmentById } from "@/src/services/communication-attachments.service";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ attachmentId: string }> }) {
  const access = await authorize(PERMISSIONS.COMMUNICATIONS_READ, { request, strict: true, minimumScope: "TEAM" });
  if (!access.allowed) return access.response!;
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
