import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; attachmentId: string }> }) {
  const { id, attachmentId } = await context.params;
  const prisma = getPrisma();
  const expense = await prisma.expenseDocument.findUnique({ where: { id }, select: { id: true, locationId: true } });
  if (!expense) return NextResponse.json({ ok: false, error: "Витрату не знайдено." }, { status: 404 });
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_READ, request, expense.locationId);
  if (!access.ok) return access.response;

  const attachment = await prisma.expenseAttachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || attachment.expenseDocumentId !== id) return NextResponse.json({ ok: false, error: "Документ не знайдено." }, { status: 404 });
  const blob = await prisma.expenseAttachmentBlob.findUnique({ where: { attachmentId } });
  if (!blob) return NextResponse.json({ ok: false, error: "Файл документа відсутній." }, { status: 404 });

  const bytes = new Uint8Array(blob.fileData);
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
