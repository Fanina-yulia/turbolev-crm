import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(message: string, error: string, status = 400) { return NextResponse.json({ ok: false, error, message }, { status }); }
function text(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.PRODUCTION_READ, { request, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  if (!access.context.user) return fail("Потрібна авторизація.", "UNAUTHENTICATED", 401);
  const locationIds = access.context.locationIds;
  const rows = await getPrisma().workExecutionIssue.findMany({ where: { ...(locationIds.length ? { locationId: { in: locationIds } } : {}), status: { in: ["OPEN", "VIEWED", "NEEDS_CLARIFICATION"] } }, orderBy: { createdAt: "asc" }, take: 100, include: { attachments: { select: { id: true, fileName: true, fileType: true, fileSize: true } } } });
  return NextResponse.json({ ok: true, items: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const access = await authorize(PERMISSIONS.PRODUCTION_WRITE, { request, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  if (!access.context.user) return fail("Потрібна авторизація.", "UNAUTHENTICATED", 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const issueId = text(body?.issueId, 64);
  const resolutionType = text(body?.resolutionType, 48).toUpperCase();
  const resolutionComment = text(body?.resolutionComment, 500);
  if (!issueId || !resolutionType) return fail("Вкажіть рішення адміністратора.", "RESOLUTION_REQUIRED");
  const prisma = getPrisma();
  const issue = await prisma.workExecutionIssue.findUnique({ where: { id: issueId } });
  if (!issue || (access.context.locationIds.length && !access.context.locationIds.includes(issue.locationId))) return fail("Звернення не знайдено.", "ISSUE_NOT_FOUND", 404);
  const status = resolutionType === "REQUEST_CLARIFICATION" ? "NEEDS_CLARIFICATION" : resolutionType === "CANCEL" ? "CANCELLED" : "RESOLVED";
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.workExecutionIssue.update({ where: { id: issue.id }, data: { status, viewedAt: issue.viewedAt || new Date(), resolvedAt: status === "NEEDS_CLARIFICATION" ? null : new Date(), resolvedByUserId: access.context.user!.id, resolutionType, resolutionComment: resolutionComment || null } });
    await tx.mechanicNotification.create({ data: { id: crypto.randomUUID(), eventKey: `EXECUTION_ISSUE_RESPONSE:${issue.id}:${Date.now()}`, mechanicId: issue.mechanicId, workOrderId: issue.workOrderId, type: "EXECUTION_ISSUE_RESPONSE", title: "Адміністратор відповів щодо роботи", body: resolutionComment || resolutionType, payload: toPrismaJson({ issueId: issue.id, resolutionType }) } });
    await tx.auditEvent.create({ data: { actorId: access.context.user!.id, actorName: access.context.user!.employeeName || access.context.user!.name, entityType: "WorkExecutionIssue", entityId: issue.id, action: "ADMIN_RESOLVED_EXECUTION_ISSUE", before: toPrismaJson(issue), after: toPrismaJson(row), metadata: toPrismaJson({ resolutionType }) } });
    return row;
  });
  return NextResponse.json({ ok: true, issue: updated });
}
