import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE = ["OPEN", "VIEWED", "NEEDS_CLARIFICATION"] as const;
const RESOLUTIONS = new Set(["KEEP_CURRENT_MECHANIC", "HELP", "REASSIGN", "RESCHEDULE", "REQUEST_CLARIFICATION", "CANCEL"]);
const COMMENT_REQUIRED = new Set(["HELP", "REASSIGN", "RESCHEDULE", "REQUEST_CLARIFICATION", "CANCEL"]);

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function fail(message: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

function managerRole(access: Awaited<ReturnType<typeof authorize>>) {
  return access.context.roles.some((role) => ["OWNER", "STATION_MANAGER", "SERVICE_ADVISOR"].includes(role.code));
}

function inScope(access: Awaited<ReturnType<typeof authorize>>, locationId: string) {
  return access.grantedScope === "ALL" || access.context.locationIds.includes(locationId);
}

async function enrichedRows(locationIds: string[]) {
  const prisma = getPrisma();
  const rows = await prisma.workExecutionIssue.findMany({
    where: { ...(locationIds.length ? { locationId: { in: locationIds } } : {}), status: { in: [...ACTIVE] } },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: { attachments: { select: { id: true, fileName: true, fileType: true, fileSize: true } }, comments: { orderBy: { createdAt: "asc" } } },
  });
  const lineIds = rows.map((row) => row.assignmentId);
  const mechanicIds = rows.map((row) => row.mechanicId);
  const [lines, mechanics] = await Promise.all([
    lineIds.length ? prisma.workOrderLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, description: true, mechanicId: true, workOrder: { select: { vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } } } } } }) : [],
    mechanicIds.length ? prisma.serviceMechanic.findMany({ where: { id: { in: mechanicIds } }, select: { id: true, name: true } }) : [],
  ]);
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const mechanicById = new Map(mechanics.map((mechanic) => [mechanic.id, mechanic]));
  return rows.map((row) => {
    const line = lineById.get(row.assignmentId);
    const vehicle = line?.workOrder.vehicle;
    return {
      ...row,
      workDescription: line?.description || "Робота",
      mechanicName: mechanicById.get(row.mechanicId)?.name || "Механік",
      vehicleLabel: [vehicle?.brand, vehicle?.model, vehicle?.year].filter(Boolean).join(" ") || "Автомобіль",
      plateNumber: vehicle?.plateNumber || null,
    };
  });
}

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.PRODUCTION_READ, { request, strict: true, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  if (!managerRole(access)) return fail("Перегляд звернень доступний керівнику станції або сервіс-менеджеру.", "MANAGER_ROLE_REQUIRED", 403);
  const items = await enrichedRows(access.grantedScope === "ALL" ? [] : access.context.locationIds);
  const mechanics = await getPrisma().serviceMechanic.findMany({ where: { ...(access.grantedScope === "ALL" ? {} : { locationId: { in: access.context.locationIds } }), isActive: true }, orderBy: [{ locationId: "asc" }, { sortOrder: "asc" }], select: { id: true, name: true, locationId: true } });
  const posts = await getPrisma().servicePost.findMany({ where: { ...(access.grantedScope === "ALL" ? {} : { locationId: { in: access.context.locationIds } }), isActive: true }, orderBy: [{ locationId: "asc" }, { sortOrder: "asc" }], select: { id: true, name: true, locationId: true } });
  return NextResponse.json({ ok: true, items, mechanics, posts }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const access = await authorize(PERMISSIONS.PRODUCTION_WRITE, { request, strict: true, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  if (!access.context.user || !managerRole(access)) return fail("Рішення доступне лише керівнику станції або сервіс-менеджеру.", "MANAGER_ROLE_REQUIRED", 403);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const issueId = clean(body?.issueId, 64);
  const resolutionType = clean(body?.resolutionType, 48).toUpperCase();
  const resolutionComment = clean(body?.resolutionComment, 500);
  if (!issueId || !RESOLUTIONS.has(resolutionType)) return fail("Вкажіть коректне рішення адміністратора.", "RESOLUTION_REQUIRED");
  if (COMMENT_REQUIRED.has(resolutionType) && resolutionComment.length < 3) return fail("Для цього рішення потрібен коментар.", "RESOLUTION_COMMENT_REQUIRED");

  const prisma = getPrisma();
  const source = await prisma.workExecutionIssue.findUnique({ where: { id: issueId } });
  if (!source || !inScope(access, source.locationId)) return fail("Звернення не знайдено.", "ISSUE_NOT_FOUND", 404);
  if (!ACTIVE.includes(source.status as typeof ACTIVE[number])) return fail("Звернення вже закрите.", "ISSUE_NOT_ACTIVE", 409);

  const requestedMechanicId = clean(body?.mechanicId, 64) || null;
  const requestedStart = clean(body?.plannedStartAt, 64);
  const requestedEnd = clean(body?.plannedEndAt, 64);
  const requestedPostId = clean(body?.postId, 64) || null;
  const start = requestedStart ? new Date(requestedStart) : null;
  const end = requestedEnd ? new Date(requestedEnd) : null;
  if (resolutionType === "REASSIGN") {
    if (!requestedMechanicId) return fail("Оберіть нового механіка.", "MECHANIC_REQUIRED");
    const mechanic = await prisma.serviceMechanic.findFirst({ where: { id: requestedMechanicId, locationId: source.locationId, isActive: true }, select: { id: true } });
    if (!mechanic) return fail("Обраний механік недоступний на цій станції.", "MECHANIC_NOT_AVAILABLE", 409);
  }
  if (resolutionType === "RESCHEDULE") {
    if (!start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return fail("Вкажіть коректний новий час.", "INVALID_TIME_RANGE");
    if (end.getTime() - start.getTime() > 24 * 60 * 60 * 1000) return fail("Тривалість не може перевищувати 24 години.", "APPOINTMENT_TOO_LONG");
    if (requestedMechanicId) {
      const mechanic = await prisma.serviceMechanic.findFirst({ where: { id: requestedMechanicId, locationId: source.locationId, isActive: true }, select: { id: true } });
      if (!mechanic) return fail("Обраний механік недоступний на цій станції.", "MECHANIC_NOT_AVAILABLE", 409);
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`execution-issue-decision:${issueId}`}))`;
      const issue = await tx.workExecutionIssue.findUnique({ where: { id: issueId } });
      if (!issue || !ACTIVE.includes(issue.status as typeof ACTIVE[number])) throw new Error("ISSUE_NOT_ACTIVE");
      const line = await tx.workOrderLine.findUnique({ where: { id: issue.assignmentId }, select: { id: true, status: true, metadata: true } });
      if (!line) throw new Error("ASSIGNMENT_NOT_FOUND");
      let appointment: { id: string; mechanicId: string | null; postId: string | null } | null = null;
      if (resolutionType === "RESCHEDULE") {
        appointment = await tx.serviceAppointment.findFirst({ where: { workOrderId: issue.workOrderId, locationId: issue.locationId, status: { not: "CANCELLED" } }, orderBy: [{ actualArrivalAt: "desc" }, { plannedStartAt: "desc" }], select: { id: true, mechanicId: true, postId: true } });
        if (!appointment) throw new Error("APPOINTMENT_NOT_FOUND");
        const resourceFilters = [
          requestedPostId || appointment.postId ? { postId: requestedPostId || appointment.postId } : null,
          requestedMechanicId || appointment.mechanicId ? { mechanicId: requestedMechanicId || appointment.mechanicId } : null,
        ].filter((value): value is { postId: string | null } | { mechanicId: string | null } => value !== null);
        if (resourceFilters.length) {
          const conflicts = await tx.serviceAppointment.findMany({ where: { id: { not: appointment.id }, locationId: issue.locationId, status: { not: "CANCELLED" }, plannedStartAt: { lt: end! }, plannedEndAt: { gt: start! }, OR: resourceFilters }, select: { id: true }, take: 1 });
          if (conflicts.length) throw new Error("SCHEDULE_CONFLICT");
        }
      }
      const nextMechanicId = resolutionType === "REASSIGN" ? requestedMechanicId : null;
      const nextStatus = resolutionType === "REQUEST_CLARIFICATION" ? "NEEDS_CLARIFICATION" : resolutionType === "CANCEL" ? "CANCELLED" : "RESOLVED";
      const metadata = line.metadata !== null && typeof line.metadata === "object" && !Array.isArray(line.metadata) ? line.metadata as Record<string, unknown> : {};
      const updatedIssue = await tx.workExecutionIssue.update({ where: { id: issueId }, data: { status: nextStatus, viewedAt: issue.viewedAt || new Date(), resolvedAt: nextStatus === "NEEDS_CLARIFICATION" ? null : new Date(), resolvedByUserId: access.context.user!.id, resolutionType, resolutionComment: resolutionComment || null, mechanicId: nextMechanicId || issue.mechanicId } });
      if (resolutionType === "REASSIGN") await tx.workOrderLine.update({ where: { id: line.id }, data: { mechanicId: nextMechanicId } });
      if (resolutionType === "RESCHEDULE" && appointment) await tx.serviceAppointment.update({ where: { id: appointment.id }, data: { plannedStartAt: start!, plannedEndAt: end!, postId: requestedPostId || appointment.postId, mechanicId: requestedMechanicId || appointment.mechanicId } });
      if (resolutionType === "RESCHEDULE" && requestedMechanicId) await tx.workOrderLine.update({ where: { id: line.id }, data: { mechanicId: requestedMechanicId } });
      if (resolutionType === "CANCEL") {
        await tx.workOrderLine.update({ where: { id: line.id }, data: { status: "CANCELLED", cancelledAt: new Date(), metadata: toPrismaJson({ ...metadata, executionIssue: { id: issueId, status: "CANCELLED", resolutionType } }) } });
        await tx.serviceAppointment.updateMany({ where: { workOrderId: issue.workOrderId, locationId: issue.locationId, status: { not: "CANCELLED" } }, data: { status: "CANCELLED" } });
      } else {
        await tx.workOrderLine.update({ where: { id: line.id }, data: { metadata: toPrismaJson({ ...metadata, executionIssue: { id: issueId, status: nextStatus, resolutionType, resolvedAt: nextStatus === "RESOLVED" ? new Date().toISOString() : null } }) } });
      }
      const recipients = Array.from(new Set([issue.mechanicId, nextMechanicId].filter((value): value is string => Boolean(value))));
      await tx.mechanicNotification.createMany({ data: recipients.map((mechanicId) => ({ id: randomUUID(), eventKey: `EXECUTION_ISSUE_RESPONSE:${issueId}:${mechanicId}:${Date.now()}`, mechanicId, workOrderId: issue.workOrderId, type: "EXECUTION_ISSUE_RESPONSE", title: "Адміністратор відповів щодо роботи", body: resolutionComment || resolutionType, payload: toPrismaJson({ issueId, resolutionType, mechanicId }) })) });
      await tx.auditEvent.create({ data: { actorId: access.context.user!.id, actorName: access.context.user!.employeeName || access.context.user!.name, entityType: "WorkExecutionIssue", entityId: issueId, action: "ADMIN_RESOLVED_EXECUTION_ISSUE", before: toPrismaJson(issue), after: toPrismaJson(updatedIssue), metadata: toPrismaJson({ resolutionType, mechanicId: nextMechanicId, plannedStartAt: requestedStart || null, plannedEndAt: requestedEnd || null, postId: requestedPostId }) } });
      return updatedIssue;
    });
    return NextResponse.json({ ok: true, issue: result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "ISSUE_NOT_ACTIVE") return fail("Звернення вже закрите.", code, 409);
    if (code === "ASSIGNMENT_NOT_FOUND") return fail("Роботу не знайдено.", code, 404);
    if (code === "APPOINTMENT_NOT_FOUND") return fail("Для цієї роботи не знайдено запис у планувальнику.", code, 409);
    if (code === "SCHEDULE_CONFLICT") return fail("Новий час конфліктує з іншим записом поста або механіка.", code, 409);
    console.error("PATCH execution issue failed", error);
    return fail("Не вдалося застосувати рішення адміністратора.", "EXECUTION_ISSUE_RESOLVE_FAILED", 500);
  }
}
