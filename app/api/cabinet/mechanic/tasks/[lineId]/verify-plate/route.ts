import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { normalizeRegistrationPlate } from "@/src/domain/registration-plate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function fail(message: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

export async function POST(request: Request, context: { params: Promise<{ lineId: string }> }) {
  const access = await authorize(PERMISSIONS.PRODUCTION_WRITE, { request, strict: true, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;
  if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) return fail("Дія доступна лише автомеханіку.", "MECHANIC_ROLE_REQUIRED", 403);
  const { lineId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const recognizedPlate = normalizeRegistrationPlate(typeof body?.recognizedPlate === "string" ? body.recognizedPlate : "");
  const method = body?.verificationMethod === "CAMERA" ? "CAMERA" : "MANUAL";
  if (!recognizedPlate) return fail("Введіть або відскануйте державний номер.", "PLATE_REQUIRED");
  const prisma = getPrisma();
  const mechanic = await prisma.serviceMechanic.findFirst({ where: { userId: access.context.user.id, isActive: true }, select: { id: true } });
  if (!mechanic) return fail("Кабінет механіка не прив’язаний до станції.", "MECHANIC_RESOURCE_NOT_LINKED", 409);
  const line = await prisma.workOrderLine.findFirst({ where: { id: lineId, mechanicId: { in: [mechanic.id, access.context.user.id] }, type: { not: "PART" } }, select: { id: true, workOrderId: true, metadata: true, workOrder: { select: { vehicle: { select: { plateNumber: true } } } } } });
  if (!line) return fail("Роботу не знайдено або вона не закріплена за вами.", "ASSIGNED_LINE_NOT_FOUND", 404);
  const expectedPlate = normalizeRegistrationPlate(line.workOrder.vehicle.plateNumber || "");
  if (expectedPlate && expectedPlate !== recognizedPlate) {
    await prisma.auditEvent.create({ data: { actorId: access.context.user.id, actorName: access.context.user.employeeName || access.context.user.name, entityType: "WorkOrderLine", entityId: line.id, action: "MECHANIC_PLATE_VERIFICATION_FAILED", metadata: toPrismaJson({ expectedPlate, recognizedPlate, verificationMethod: method }) } }).catch(() => undefined);
    return NextResponse.json({ ok: false, error: "PLATE_MISMATCH", message: "Номер автомобіля не збігається.", scannedPlate: recognizedPlate, expectedPlate }, { status: 409 });
  }
  const now = new Date();
  const updated = await prisma.workOrderLine.update({ where: { id: line.id }, data: { metadata: toPrismaJson({ ...record(line.metadata), mechanicPlateVerification: { plate: recognizedPlate, method, verifiedAt: now.toISOString(), verifiedByUserId: access.context.user.id } }) }, select: { id: true, metadata: true } });
  await prisma.auditEvent.create({ data: { actorId: access.context.user.id, actorName: access.context.user.employeeName || access.context.user.name, entityType: "WorkOrderLine", entityId: line.id, action: "MECHANIC_PLATE_VERIFIED", metadata: toPrismaJson({ expectedPlate, recognizedPlate, verificationMethod: method }) } }).catch(() => undefined);
  return NextResponse.json({ ok: true, verified: true, plate: recognizedPlate, line: updated });
}
