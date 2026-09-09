import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { PERMISSIONS } from "@/src/security/permissions";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const prisma = getPrisma();
  const expense = await prisma.expenseDocument.findUnique({ where: { id }, select: { id: true, locationId: true } });
  if (!expense) return NextResponse.json({ ok: false, error: "Витрату не знайдено." }, { status: 404 });
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_READ, request, expense.locationId);
  if (!access.ok) return access.response;
  const attachments = await prisma.expenseAttachment.findMany({ where: { expenseDocumentId: id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ ok: true, attachments }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const prisma = getPrisma();
  const expense = await prisma.expenseDocument.findUnique({ where: { id }, select: { id: true, number: true, locationId: true } });
  if (!expense) return NextResponse.json({ ok: false, error: "Витрату не знайдено." }, { status: 404 });
  const access = await authorizeScopedLocation(PERMISSIONS.FINANCE_WRITE, request, expense.locationId);
  if (!access.ok) return access.response;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Оберіть PDF, JPG або PNG файл." }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ ok: false, error: "Дозволені лише PDF, JPG та PNG." }, { status: 415 });
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) return NextResponse.json({ ok: false, error: "Розмір документа повинен бути від 1 байта до 15 МБ." }, { status: 413 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const user = access.context.user;
  const actorId = user?.id || null;
  const actorName = user?.employeeName || user?.name || user?.email || "CRM / Фінанси";

  const result = await prisma.$transaction(async (tx) => {
    const attachment = await tx.expenseAttachment.create({
      data: {
        expenseDocumentId: id,
        fileName: file.name.slice(0, 240),
        mimeType: file.type,
        sizeBytes: file.size,
        url: "pending",
        uploadedById: actorId,
      },
    });
    const url = `/api/finance/expenses/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachment.id)}`;
    const updated = await tx.expenseAttachment.update({ where: { id: attachment.id }, data: { url } });
    await tx.expenseAttachmentBlob.create({ data: { attachmentId: attachment.id, fileData: bytes } });
    await tx.auditEvent.create({
      data: {
        actorId,
        actorName,
        entityType: "ExpenseDocument",
        entityId: id,
        action: "EXPENSE_ATTACHMENT_UPLOADED",
        after: toPrismaJson({ attachmentId: attachment.id, fileName: updated.fileName, mimeType: updated.mimeType, sizeBytes: updated.sizeBytes }),
      },
    });
    return updated;
  });

  return NextResponse.json({ ok: true, attachment: result }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
