import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ issueId: string }> };

function clean(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function fail(message: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

async function loadIssue(issueId: string) {
  return getPrisma().workExecutionIssue.findUnique({
    where: { id: issueId },
    select: { id: true, mechanicId: true, locationId: true, workOrderId: true, status: true },
  });
}

function canManage(access: Awaited<ReturnType<typeof authorize>>) {
  return access.context.roles.some((role) => ["OWNER", "STATION_MANAGER", "SERVICE_ADVISOR"].includes(role.code));
}

export async function GET(request: Request, context: Context) {
  const access = await authorize(PERMISSIONS.PRODUCTION_READ, { request, strict: true, minimumScope: "SELF" });
  if (!access.allowed) return access.response!;
  const { issueId } = await context.params;
  const issue = await loadIssue(issueId);
  if (!issue) return fail("Звернення не знайдено.", "ISSUE_NOT_FOUND", 404);
  const mechanic = access.context.user
    ? await getPrisma().serviceMechanic.findFirst({ where: { userId: access.context.user.id, isActive: true }, select: { id: true } })
    : null;
  const visible = canManage(access)
    ? access.grantedScope === "ALL" || access.context.locationIds.includes(issue.locationId)
    : Boolean(mechanic && [mechanic.id, access.context.user?.id].includes(issue.mechanicId));
  if (!visible) return fail("Звернення недоступне.", "FORBIDDEN", 403);
  const comments = await getPrisma().workExecutionIssueComment.findMany({ where: { issueId }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ ok: true, items: comments }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: Context) {
  const access = await authorize(PERMISSIONS.PRODUCTION_WRITE, { request, strict: true, minimumScope: "SELF" });
  if (!access.allowed) return access.response!;
  if (!access.context.user) return fail("Потрібна авторизація.", "UNAUTHENTICATED", 401);
  const { issueId } = await context.params;
  const issue = await loadIssue(issueId);
  if (!issue || ["RESOLVED", "CANCELLED"].includes(issue.status)) return fail("До закритого звернення не можна додати уточнення.", "ISSUE_NOT_ACTIVE", 409);
  const mechanic = await getPrisma().serviceMechanic.findFirst({ where: { userId: access.context.user.id, isActive: true }, select: { id: true } });
  const isMechanic = Boolean(mechanic && [mechanic.id, access.context.user.id].includes(issue.mechanicId));
  const isManager = canManage(access) && (access.grantedScope === "ALL" || access.context.locationIds.includes(issue.locationId));
  if (!isMechanic && !isManager) return fail("Звернення недоступне.", "FORBIDDEN", 403);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const comment = clean(body?.comment, 1000);
  if (comment.length < 3) return fail("Уточнення має містити щонайменше 3 символи.", "COMMENT_REQUIRED");
  const actorName = access.context.user.employeeName || access.context.user.name || "Користувач CRM";
  const prisma = getPrisma();
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.workExecutionIssueComment.create({ data: { issueId, authorUserId: access.context.user!.id, authorName: actorName, body: comment } });
    await tx.workExecutionIssue.update({ where: { id: issueId }, data: { status: isManager ? "VIEWED" : "OPEN", viewedAt: isManager ? new Date() : undefined } });
    if (isManager) {
      await tx.mechanicNotification.create({ data: { id: randomUUID(), eventKey: `EXECUTION_ISSUE_COMMENT:${issueId}:${row.id}`, mechanicId: issue.mechanicId, workOrderId: issue.workOrderId, type: "EXECUTION_ISSUE_COMMENT", title: "Адміністратор додав уточнення", body: comment, payload: toPrismaJson({ issueId, commentId: row.id }) } });
    } else {
      const managers = await tx.userAccessRole.findMany({ where: { locationId: issue.locationId, isActive: true, role: { code: { in: ["STATION_MANAGER", "SERVICE_ADVISOR", "OWNER"] } } }, select: { userId: true } });
      const recipients = Array.from(new Set(managers.map((item) => item.userId).filter((id) => id !== access.context.user!.id)));
      if (recipients.length) await tx.mechanicNotification.createMany({ data: recipients.map((recipientUserId) => ({ id: randomUUID(), eventKey: `EXECUTION_ISSUE_COMMENT:${issueId}:${row.id}:${recipientUserId}`, mechanicId: recipientUserId, recipientUserId, workOrderId: issue.workOrderId, type: "EXECUTION_ISSUE_COMMENT", title: "Механік додав уточнення", body: comment, payload: toPrismaJson({ issueId, commentId: row.id }) })) });
    }
    await tx.auditEvent.create({ data: { actorId: access.context.user!.id, actorName, entityType: "WorkExecutionIssue", entityId: issueId, action: "EXECUTION_ISSUE_COMMENT_ADDED", metadata: toPrismaJson({ commentId: row.id, isManager }) } });
    return row;
  });
  return NextResponse.json({ ok: true, comment: created }, { status: 201 });
}
