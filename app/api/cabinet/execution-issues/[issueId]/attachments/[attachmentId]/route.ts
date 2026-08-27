import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ issueId: string; attachmentId: string }> }) {
  const access = await authorize(PERMISSIONS.PRODUCTION_READ, { request, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;
  const { issueId, attachmentId } = await context.params;
  const row = await getPrisma().workExecutionIssueAttachment.findFirst({ where: { id: attachmentId, issueId }, include: { issue: { select: { mechanicId: true, locationId: true } } } });
  if (!row) return NextResponse.json({ ok: false, error: "ATTACHMENT_NOT_FOUND" }, { status: 404 });
  if (access.context.locationIds.length && !access.context.locationIds.includes(row.issue.locationId) && row.issue.mechanicId !== access.context.user?.id) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  return new Response(row.fileData, { headers: { "Content-Type": row.fileType, "Content-Length": String(row.fileSize), "Content-Disposition": `inline; filename="${row.fileName.replace(/[\r\n"]/g, "_")}"`, "Cache-Control": "private, max-age=3600" } });
}
