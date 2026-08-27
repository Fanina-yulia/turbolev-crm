import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const REASONS = new Set(["VEHICLE_NOT_PRESENT", "VEHICLE_NOT_HANDED_OVER", "BAY_OCCUPIED", "EQUIPMENT_UNAVAILABLE", "EQUIPMENT_BROKEN", "PARTS_UNAVAILABLE", "ASSISTANCE_REQUIRED", "ALREADY_IN_PROGRESS", "INCORRECT_ASSIGNMENT_DATA", "LICENSE_PLATE_MISMATCH", "TIME_UNAVAILABLE", "OTHER"]);
const REQUIRED_COMMENT = new Set(["INCORRECT_ASSIGNMENT_DATA", "LICENSE_PLATE_MISMATCH", "TIME_UNAVAILABLE", "OTHER"]);
const MAX_FILE_BYTES = 2_800_000;

const fail = (message: string, error: string, status = 400) => NextResponse.json({ ok: false, error, message }, { status });
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const label = (v: { brand: string | null; model: string | null; year: number | null } | null) => v ? [v.brand, v.model, v.year].filter(Boolean).join(" ") || "Автомобіль" : "Автомобіль";

async function mechanicContext(userId: string) {
  return getPrisma().serviceMechanic.findFirst({ where: { userId, isActive: true }, select: { id: true, name: true, locationId: true } });
}

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.PRODUCTION_READ, { request, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;
  if (!access.context.user) return fail("Потрібна авторизація.", "UNAUTHENTICATED", 401);
  const mechanic = await mechanicContext(access.context.user.id);
  if (!mechanic) return NextResponse.json({ ok: true, linked: false, items: [] });
  const rows = await getPrisma().workExecutionIssue.findMany({ where: { mechanicId: { in: [mechanic.id, access.context.user.id] }, status: { in: ["OPEN", "VIEWED", "NEEDS_CLARIFICATION"] } }, orderBy: { createdAt: "desc" }, take: 50, include: { attachments: { select: { id: true, fileName: true, fileType: true, fileSize: true } } } });
  return NextResponse.json({ ok: true, linked: true, items: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const access = await authorize(PERMISSIONS.PRODUCTION_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) return fail("Дія доступна лише автомеханіку.", "MECHANIC_ROLE_REQUIRED", 403);
    const mechanic = await mechanicContext(access.context.user.id);
    if (!mechanic) return fail("Кабінет механіка не прив’язаний до станції.", "MECHANIC_RESOURCE_NOT_LINKED", 409);
    const form = await request.formData();
    const assignmentId = text(form.get("assignmentId"), 64);
    const reasonCode = text(form.get("reasonCode"), 48).toUpperCase();
    const comment = text(form.get("comment"), 500);
    if (!assignmentId) return fail("Не визначено роботу.", "ASSIGNMENT_ID_REQUIRED");
    if (!REASONS.has(reasonCode)) return fail("Виберіть причину.", "INVALID_REASON");
    if (REQUIRED_COMMENT.has(reasonCode) && comment.length < 3) return fail("Для цієї причини потрібен короткий опис.", "COMMENT_REQUIRED");
    const prisma = getPrisma();
    const line = await prisma.workOrderLine.findFirst({ where: { id: assignmentId, mechanicId: { in: [mechanic.id, access.context.user.id] }, type: { not: "PART" } }, include: { workOrder: { include: { vehicle: true } } } });
    if (!line) return fail("Роботу не знайдено або вона не закріплена за вами.", "ASSIGNED_LINE_NOT_FOUND", 404);
    const existing = await prisma.workExecutionIssue.findFirst({ where: { assignmentId: line.id, status: { in: ["OPEN", "VIEWED", "NEEDS_CLARIFICATION"] } } });
    if (existing) return NextResponse.json({ ok: true, duplicate: true, issue: existing, message: "Це звернення вже передано адміністратору." });
    const files = form.getAll("photos").filter((item): item is File => item instanceof File).slice(0, 5);
    const attachments = [] as Array<{ id: string; fileId: string; fileType: string; fileName: string; fileSize: number; fileData: Uint8Array<ArrayBuffer>; createdByUserId: string }>;
    for (const file of files) {
      if (!file.type.startsWith("image/") || file.size > MAX_FILE_BYTES) return fail("Фото має бути зображенням до 2,8 МБ.", "INVALID_ATTACHMENT");
      attachments.push({ id: randomUUID(), fileId: randomUUID(), fileType: file.type, fileName: text(file.name, 240) || "photo.jpg", fileSize: file.size, fileData: new Uint8Array(await file.arrayBuffer()) as unknown as Uint8Array<ArrayBuffer>, createdByUserId: access.context.user.id });
    }
    const now = new Date();
    const actorName = access.context.user.employeeName || access.context.user.name || mechanic.name;
    const issue = await prisma.$transaction(async (tx) => {
      const created = await tx.workExecutionIssue.create({ data: { assignmentId: line.id, workOrderId: line.workOrderId, vehicleId: line.workOrder.vehicleId, clientId: line.workOrder.clientId, mechanicId: mechanic.id, locationId: mechanic.locationId, reasonCode, comment: comment || null, attachments: attachments.length ? { create: attachments } : undefined } });
      const managers = await tx.userAccessRole.findMany({ where: { locationId: mechanic.locationId, isActive: true, role: { code: { in: ["STATION_MANAGER", "SERVICE_ADVISOR", "OWNER"] } } }, select: { userId: true } });
      const recipientIds = Array.from(new Set(managers.map((item) => item.userId).filter((id) => id !== access.context.user!.id)));
      if (recipientIds.length) await tx.mechanicNotification.createMany({ data: recipientIds.map((recipientUserId) => ({ id: randomUUID(), eventKey: `EXECUTION_ISSUE:${created.id}:${recipientUserId}`, mechanicId: recipientUserId, recipientUserId, workOrderId: line.workOrderId, type: "EXECUTION_ISSUE", title: "Механік не може виконати роботу", body: `${label(line.workOrder.vehicle)} · ${line.workOrder.vehicle.plateNumber || "Без номера"}\nПричина: ${reasonCode}\nМеханік: ${actorName}`, vehicleLabel: label(line.workOrder.vehicle), plateNumber: line.workOrder.vehicle.plateNumber, payload: toPrismaJson({ issueId: created.id, assignmentId: line.id, locationId: mechanic.locationId }) })) });
      await tx.auditEvent.create({ data: { actorId: access.context.user!.id, actorName, entityType: "WorkExecutionIssue", entityId: created.id, action: "MECHANIC_REPORTED_EXECUTION_ISSUE", metadata: toPrismaJson({ assignmentId: line.id, reasonCode, locationId: mechanic.locationId }) } });
      return created;
    });
    return NextResponse.json({ ok: true, issue, message: "Адміністратора повідомлено. Робота залишається у вашому списку до прийняття рішення." }, { status: 201 });
  } catch (error) {
    console.error("POST mechanic execution issue failed", error);
    return fail("Не вдалося повідомити адміністратора.", "EXECUTION_ISSUE_CREATE_FAILED", 500);
  }
}
