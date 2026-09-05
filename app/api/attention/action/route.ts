import { NextRequest, NextResponse } from "next/server";
import { InquiryState, PlannerAppointmentStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";
import { updatePlannerAppointment } from "@/src/services/planner.service";
import { patchTaskForUser } from "@/src/services/tasks.service";

export const runtime = "nodejs";

type AttentionAction = "RESOLVE" | "SPAM" | "NO_SHOW" | "CANCEL";

export async function POST(request: NextRequest) {
  try {
    const access = await getAccessContext(request);
    if (access.provisioningState !== "ACTIVE" || !access.user) {
      return NextResponse.json({ ok: false, error: "Access denied" }, { status: 401 });
    }
    if (access.enforcementMode === "ENFORCED" && !hasPermission(access, PERMISSIONS.OVERVIEW_READ)) {
      return NextResponse.json({ ok: false, error: "Access denied" }, { status: 403 });
    }

    const body = await request.json() as {
      action?: AttentionAction;
      sourceType?: string;
      sourceId?: string;
      taskId?: string;
    };
    const action = body.action;
    const sourceType = String(body.sourceType || "").toUpperCase();
    const sourceId = String(body.sourceId || "").trim();
    if (!action || !["RESOLVE", "SPAM", "NO_SHOW", "CANCEL"].includes(action)) {
      return NextResponse.json({ ok: false, error: "INVALID_ACTION" }, { status: 422 });
    }
    if (!sourceId && !body.taskId) {
      return NextResponse.json({ ok: false, error: "SOURCE_REQUIRED" }, { status: 422 });
    }

    const prisma = getPrisma();
    if (sourceType === "INQUIRY") {
      if (access.enforcementMode === "ENFORCED" && !hasPermission(access, PERMISSIONS.COMMUNICATIONS_WRITE)) {
        return NextResponse.json({ ok: false, error: "Access denied" }, { status: 403 });
      }
      const inquiry = await prisma.communicationInquiry.findUnique({ where: { id: sourceId } });
      if (!inquiry) return NextResponse.json({ ok: false, error: "Звернення не знайдено" }, { status: 404 });
      const updated = await prisma.communicationInquiry.update({
        where: { id: sourceId },
        data: action === "SPAM"
          ? { state: InquiryState.SPAM, answered: true, unread: false, assignedUserId: inquiry.assignedUserId || access.user.id }
          : { state: InquiryState.IN_WORK, answered: true, unread: false, assignedUserId: inquiry.assignedUserId || access.user.id },
      });
      return NextResponse.json({ ok: true, sourceType, sourceId, state: updated.state });
    }

    if (sourceType === "APPOINTMENT") {
      if (access.enforcementMode === "ENFORCED" && !hasPermission(access, PERMISSIONS.PLANNER_WRITE)) {
        return NextResponse.json({ ok: false, error: "Access denied" }, { status: 403 });
      }
      const appointment = await prisma.serviceAppointment.findUnique({ where: { id: sourceId }, select: { id: true, locationId: true } });
      if (!appointment) return NextResponse.json({ ok: false, error: "Запис не знайдено" }, { status: 404 });
      const plannerScope = access.permissions[PERMISSIONS.PLANNER_WRITE];
      if (plannerScope !== "ALL" && access.locationIds.length > 0 && !access.locationIds.includes(appointment.locationId)) {
        return NextResponse.json({ ok: false, error: "Запис не входить до Вашого доступу" }, { status: 403 });
      }
      const status = action === "NO_SHOW" ? PlannerAppointmentStatus.NO_SHOW : PlannerAppointmentStatus.CANCELLED;
      const result = await updatePlannerAppointment(sourceId, { status });
      if (!result.ok) return NextResponse.json({ ok: false, error: "Не вдалося змінити запис" }, { status: 409 });
      return NextResponse.json({ ok: true, sourceType, sourceId, status });
    }

    if (body.taskId) {
      const task = await patchTaskForUser(access.user.id, body.taskId, { status: "DONE" });
      return NextResponse.json({ ok: true, sourceType, sourceId, task });
    }

    return NextResponse.json({ ok: false, error: "UNSUPPORTED_SOURCE" }, { status: 422 });
  } catch (error) {
    console.error("POST /api/attention/action failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося виконати рішення" }, { status: 500 });
  }
}
