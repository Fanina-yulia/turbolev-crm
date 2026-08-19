import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { getAccessContext, hasPermission } from "@/src/security/access-context";
import { PERMISSIONS } from "@/src/security/permissions";
import { createWorkOrderLine, WorkOrderLineError } from "@/src/services/work-order-lines.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type DecisionAction = "APPROVE" | "REJECT" | "CLARIFY" | "ADD_TO_ESTIMATE";

const ACTIONS = new Set<DecisionAction>(["APPROVE", "REJECT", "CLARIFY", "ADD_TO_ESTIMATE"]);

function clean(value: unknown, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function fail(message: string, error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, message, ...extra }, { status });
}

function actorName(context: Awaited<ReturnType<typeof getAccessContext>>) {
  return context.user?.employeeName || context.user?.name || "CRM / Сервіс-менеджер";
}

export async function PATCH(request: Request, context: { params: Promise<{ findingId: string }> }) {
  const { findingId } = await context.params;
  try {
    const access = await getAccessContext(request);
    if (!access.authenticated || !access.user) return fail("Потрібна авторизація.", "UNAUTHENTICATED", 401);
    if (access.provisioningState !== "ACTIVE") return fail("Профіль доступу неактивний.", "ACCESS_PROFILE_INACTIVE", 403);
    if (!access.roles.some((role) => role.code === "SERVICE_ADVISOR")) return fail("Дія доступна сервіс-менеджеру.", "SERVICE_ADVISOR_ROLE_REQUIRED", 403);
    if (!hasPermission(access, PERMISSIONS.WORK_ORDERS_ESTIMATE)) return fail("Недостатньо прав для рішень по кошторису.", "FORBIDDEN", 403);

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = clean(body?.action, 40).toUpperCase() as DecisionAction;
    const comment = clean(body?.comment, 2000);
    if (!ACTIONS.has(action)) return fail("Невідома дія з несправністю.", "INVALID_ACTION");
    if ((action === "REJECT" || action === "CLARIFY") && comment.length < 3) {
      return fail(action === "CLARIFY" ? "Напишіть, що саме потрібно уточнити механіку." : "Вкажіть причину відхилення.", "COMMENT_REQUIRED");
    }

    const prisma = getPrisma();
    const finding = await prisma.mechanicWorkFinding.findUnique({ where: { id: findingId } });
    if (!finding) return fail("Виявлену несправність не знайдено.", "FINDING_NOT_FOUND", 404);

    const serviceRole = access.roles.find((role) => role.code === "SERVICE_ADVISOR");
    const locationIds = new Set([serviceRole?.locationId, ...access.locationIds].filter((value): value is string => Boolean(value)));
    const appointment = await prisma.serviceAppointment.findFirst({
      where: { workOrderId: finding.workOrderId, ...(locationIds.size ? { locationId: { in: [...locationIds] } } : { id: "__no_location__" }) },
      select: { id: true, locationId: true },
    });
    if (!appointment) return fail("Ця несправність не належить до Вашої станції.", "FINDING_OUT_OF_SCOPE", 403);

    const reviewer = access.user.id;
    const reviewerName = actorName(access);
    const now = new Date();

    if (action === "ADD_TO_ESTIMATE") {
      let estimateLine = await prisma.workOrderLine.findFirst({
        where: { workOrderId: finding.workOrderId, sourceEntity: "MECHANIC_FINDING", sourceEntityId: finding.id },
        select: { id: true, status: true, description: true },
      });

      if (!estimateLine) {
        try {
          const created = await createWorkOrderLine(finding.workOrderId, {
            type: "OTHER",
            status: "DRAFT",
            description: finding.recommendation || finding.findingText,
            unit: "робота",
            plannedQuantity: 1,
            plannedUnitPrice: 0,
            plannedUnitCost: 0,
            plannedDiscount: 0,
            sourceEntity: "MECHANIC_FINDING",
            sourceEntityId: finding.id,
            metadata: {
              source: "MECHANIC_FINDING",
              findingId: finding.id,
              originalWorkOrderLineId: finding.workOrderLineId,
              urgency: finding.urgency,
              findingText: finding.findingText,
              recommendation: finding.recommendation,
            },
          }, reviewerName);
          estimateLine = { id: created.line.id, status: created.line.status, description: created.line.description };
        } catch (error) {
          if (error instanceof WorkOrderLineError) {
            return fail(error.message, error.code, error.code === "ACTUAL_ALREADY_LOCKED" ? 409 : 400);
          }
          throw error;
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.mechanicWorkFinding.update({
          where: { id: finding.id },
          data: {
            status: "RESOLVED",
            resolutionCode: "ADDED_TO_ESTIMATE",
            estimateLineId: estimateLine!.id,
            reviewedAt: now,
            reviewedByUserId: reviewer,
            managerComment: comment || "Додано в кошторис як нову позицію.",
          },
        });
        await tx.auditEvent.create({
          data: {
            actorName: reviewerName,
            entityType: "MechanicWorkFinding",
            entityId: finding.id,
            action: "FINDING_ADDED_TO_ESTIMATE",
            before: toPrismaJson(finding),
            after: toPrismaJson(row),
            metadata: toPrismaJson({ workOrderId: finding.workOrderId, estimateLineId: estimateLine!.id }),
          },
        });
        return row;
      });

      return NextResponse.json({
        ok: true,
        finding: updated,
        estimateLine,
        message: "Несправність додано в кошторис. Вкажіть ціну та надішліть кошторис клієнту на погодження.",
      });
    }

    const next = action === "CLARIFY"
      ? { status: "REVIEWED" as const, resolutionCode: "CLARIFICATION_REQUIRED" }
      : action === "REJECT"
        ? { status: "REJECTED" as const, resolutionCode: "REJECTED" }
        : { status: "RESOLVED" as const, resolutionCode: "APPROVED" };

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.mechanicWorkFinding.update({
        where: { id: finding.id },
        data: {
          status: next.status,
          resolutionCode: next.resolutionCode,
          reviewedAt: now,
          reviewedByUserId: reviewer,
          managerComment: comment || (action === "APPROVE" ? "Погоджено сервіс-менеджером." : null),
          mechanicReply: action === "CLARIFY" ? null : undefined,
          mechanicRepliedAt: action === "CLARIFY" ? null : undefined,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorName: reviewerName,
          entityType: "MechanicWorkFinding",
          entityId: finding.id,
          action: `FINDING_${action}`,
          before: toPrismaJson(finding),
          after: toPrismaJson(row),
          metadata: toPrismaJson({ workOrderId: finding.workOrderId, action }),
        },
      });
      return row;
    });

    const messages: Record<Exclude<DecisionAction, "ADD_TO_ESTIMATE">, string> = {
      APPROVE: "Несправність погоджено до подальшого опрацювання.",
      REJECT: "Несправність відхилено із зафіксованою причиною.",
      CLARIFY: "Запит на уточнення передано механіку.",
    };
    return NextResponse.json({ ok: true, finding: updated, message: messages[action] });
  } catch (error) {
    console.error("PATCH service advisor finding decision failed", error);
    return fail("Не вдалося зберегти рішення по несправності.", "FINDING_DECISION_FAILED", 500);
  }
}
