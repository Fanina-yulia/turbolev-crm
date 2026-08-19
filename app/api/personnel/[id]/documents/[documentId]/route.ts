import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Context = { params: Promise<{ id: string; documentId: string }> };
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024;

async function withinScope(employeeId: string, request: Request, write: boolean) {
  const permission = write ? PERMISSIONS.PERSONNEL_WRITE : PERMISSIONS.PERSONNEL_READ;
  const access = await authorize(permission, { request, strict: write, minimumScope: write ? "LOCATION" : "SELF" });
  if (!access.allowed) return { allowed: false as const, response: access.response! };
  if (access.grantedScope === "ALL" || access.shadowBypass) return { allowed: true as const, access };
  if (access.grantedScope === "SELF") {
    if (access.context.user?.employeeId !== employeeId) return { allowed: false as const, response: NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }) };
    return { allowed: true as const, access };
  }
  const prisma = getPrisma();
  const now = new Date();
  const assignment = await prisma.employeeRoleAssignment.findFirst({
    where: { employeeId, locationId: { in: access.context.locationIds }, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    select: { id: true },
  });
  if (!assignment) return { allowed: false as const, response: NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }) };
  return { allowed: true as const, access };
}

export async function POST(request: Request, context: Context) {
  const { id, documentId } = await context.params;
  const gate = await withinScope(id, request, true);
  if (!gate.allowed) return gate.response;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "FILE_REQUIRED", message: "Оберіть файл." }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ ok: false, error: "FILE_TYPE_NOT_ALLOWED", message: "Дозволені PDF, JPG, PNG або WEBP." }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "FILE_TOO_LARGE", message: "Максимальний розмір документа — 10 МБ." }, { status: 413 });

  const prisma = getPrisma();
  const existing = await prisma.employeeDocument.findFirst({ where: { id: documentId, employeeId: id }, select: { id: true } });
  if (!existing) return NextResponse.json({ ok: false, error: "DOCUMENT_NOT_FOUND" }, { status: 404 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const url = `/api/personnel/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`;
  await prisma.$executeRawUnsafe(
    `UPDATE "EmployeeDocument" SET "fileName"=$1,"mimeType"=$2,"fileSize"=$3,"fileData"=$4,"fileUrl"=$5,"status"='UPLOADED',"uploadedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$6 AND "employeeId"=$7`,
    file.name.slice(0, 240), file.type, file.size, bytes, url, documentId, id,
  );
  return NextResponse.json({ ok: true, document: { id: documentId, fileName: file.name, mimeType: file.type, fileSize: file.size, fileUrl: url, status: "UPLOADED" } });
}

export async function GET(request: Request, context: Context) {
  const { id, documentId } = await context.params;
  const gate = await withinScope(id, request, false);
  if (!gate.allowed) return gate.response;
  const prisma = getPrisma();
  const rows = await prisma.$queryRawUnsafe<Array<{ fileName: string | null; mimeType: string | null; fileData: Buffer | null }>>(
    `SELECT "fileName","mimeType","fileData" FROM "EmployeeDocument" WHERE "id"=$1 AND "employeeId"=$2 LIMIT 1`, documentId, id,
  );
  const row = rows[0];
  if (!row?.fileData) return NextResponse.json({ ok: false, error: "DOCUMENT_FILE_NOT_FOUND" }, { status: 404 });
  return new NextResponse(new Uint8Array(row.fileData), {
    headers: {
      "Content-Type": row.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.fileName || "document")}`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function DELETE(request: Request, context: Context) {
  const { id, documentId } = await context.params;
  const gate = await withinScope(id, request, true);
  if (!gate.allowed) return gate.response;
  const prisma = getPrisma();
  await prisma.$executeRawUnsafe(
    `UPDATE "EmployeeDocument" SET "fileName"=NULL,"mimeType"=NULL,"fileSize"=NULL,"fileData"=NULL,"fileUrl"=NULL,"status"='MISSING',"uploadedAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "employeeId"=$2`,
    documentId, id,
  );
  return NextResponse.json({ ok: true });
}
