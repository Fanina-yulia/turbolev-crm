import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

async function gate(id: string, request: Request, write: boolean) {
  const access = await authorize(write ? PERMISSIONS.PERSONNEL_WRITE : PERMISSIONS.PERSONNEL_READ, { request, strict: write, minimumScope: write ? "LOCATION" : "SELF" });
  if (!access.allowed) return { ok: false as const, response: access.response! };
  if (access.grantedScope === "ALL" || access.shadowBypass || access.context.user?.employeeId === id) return { ok: true as const };
  const now = new Date();
  const row = await getPrisma().employeeRoleAssignment.findFirst({ where: { employeeId: id, locationId: { in: access.context.locationIds }, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, select: { id: true } });
  return row ? { ok: true as const } : { ok: false as const, response: NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }) };
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const allowed = await gate(id, request, true); if (!allowed.ok) return allowed.response;
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "FILE_REQUIRED" }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ ok: false, error: "PHOTO_TYPE_NOT_ALLOWED", message: "Дозволені JPG, PNG або WEBP." }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "PHOTO_TOO_LARGE", message: "Максимальний розмір фото — 5 МБ." }, { status: 413 });
  const prisma = getPrisma();
  const employee = await prisma.employeeProfile.findUnique({ where: { id }, select: { id: true } });
  if (!employee) return NextResponse.json({ ok: false, error: "EMPLOYEE_NOT_FOUND" }, { status: 404 });
  const documentId = `employee_photo_${id}`;
  const existing = await prisma.employeeDocument.findUnique({ where: { id: documentId }, select: { id: true } });
  if (!existing) await prisma.employeeDocument.create({ data: { id: documentId, employeeId: id, type: "PROFILE_PHOTO", name: "Фото працівника", status: "MISSING" } });
  const bytes = Buffer.from(await file.arrayBuffer());
  const url = `/api/personnel/${encodeURIComponent(id)}/photo`;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`UPDATE "EmployeeDocument" SET "fileName"=$1,"mimeType"=$2,"fileSize"=$3,"fileData"=$4,"fileUrl"=$5,"status"='UPLOADED',"uploadedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$6`, file.name.slice(0,240), file.type, file.size, bytes, url, documentId);
    await tx.employeeProfile.update({ where: { id }, data: { photoUrl: url } });
  });
  return NextResponse.json({ ok: true, photoUrl: url });
}

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const allowed = await gate(id, request, false); if (!allowed.ok) return allowed.response;
  const rows = await getPrisma().$queryRawUnsafe<Array<{ mimeType: string | null; fileData: Buffer | null }>>(`SELECT "mimeType","fileData" FROM "EmployeeDocument" WHERE "id"=$1 LIMIT 1`, `employee_photo_${id}`);
  const row = rows[0];
  if (!row?.fileData) return NextResponse.json({ ok: false, error: "PHOTO_NOT_FOUND" }, { status: 404 });
  return new NextResponse(new Uint8Array(row.fileData), { headers: { "Content-Type": row.mimeType || "image/jpeg", "Cache-Control": "private, no-store" } });
}
