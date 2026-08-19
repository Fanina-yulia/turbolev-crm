import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { transitionWorkOrder, WorkOrderNotFoundError, WorkOrderTransitionError } from "@/src/services/work-orders.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Action = "START" | "PAUSE" | "RESUME" | "COMPLETE";

type WorkflowMeta = {
  pausedAt: string | null;
  totalPausedSeconds: number;
  lastAction: Action | null;
  lastActionAt: string | null;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function workflowMeta(metadata: unknown): WorkflowMeta {
  const root = record(metadata);
  const workflow = record(root.mechanicWorkflow);
  const pausedAt = typeof workflow.pausedAt === "string" && workflow.pausedAt ? workflow.pausedAt : null;
  const totalPausedSeconds = Number(workflow.totalPausedSeconds ?? 0);
  return {
    pausedAt,
    totalPausedSeconds: Number.isFinite(totalPausedSeconds) && totalPausedSeconds > 0 ? Math.floor(totalPausedSeconds) : 0,
    lastAction: ["START", "PAUSE", "RESUME", "COMPLETE"].includes(String(workflow.lastAction)) ? workflow.lastAction as Action : null,
    lastActionAt: typeof workflow.lastActionAt === "string" ? workflow.lastActionAt : null,
  };
}

function mergedMetadata(metadata: unknown, workflow: WorkflowMeta) {
  return toPrismaJson({ ...record(metadata), mechanicWorkflow: workflow });
}

function error(message: string, code: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: code, message, ...extra }, { status });
}

export async function PATCH(request: Request, context: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.PRODUCTION_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return error("Дія доступна лише автомеханіку.", "MECHANIC_ROLE_REQUIRED", 403);
    }

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = typeof body?.action === "string" ? body.action.trim().toUpperCase() as Action : "" as Action;
    if (!(["START", "PAUSE", "RESUME", "COMPLETE"] as string[]).includes(action)) {
      return error("Невідома дія з роботою.", "INVALID_ACTION", 400);
    }

    const prisma = getPrisma();
    const mechanic = await prisma.serviceMechanic.findFirst({
      where: { userId: access.context.user.id, isActive: true },
      select: { id: true, name: true },
    });
    if (!mechanic) return error("Кабінет механіка не прив’язаний до ресурсу автомеханіка.", "MECHANIC_RESOURCE_NOT_LINKED", 409);

    const mechanicIds = [mechanic.id, access.context.user.id];
    const now = new Date();
    const nowIso = now.toISOString();

    const mutation = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`mechanic-line:${lineId}`}))`;
      const line = await tx.workOrderLine.findFirst({
        where: { id: lineId, mechanicId: { in: mechanicIds } },
        select: {
          id: true,
          workOrderId: true,
          status: true,
          type: true,
          description: true,
          metadata: true,
          startedAt: true,
          completedAt: true,
          cancelledAt: true,
          mechanicId: true,
        },
      });
      if (!line) throw new Error("ASSIGNED_LINE_NOT_FOUND");
      if (line.type === "PART") throw new Error("PART_LINE_NOT_EXECUTABLE");

      const previous = {
        status: line.status,
        metadata: line.metadata,
        startedAt: line.startedAt,
        completedAt: line.completedAt,
      };
      const current = workflowMeta(line.metadata);
      const isPaused = line.status === "IN_PROGRESS" && Boolean(current.pausedAt);
      let nextStatus = line.status;
      let nextStartedAt = line.startedAt;
      let nextCompletedAt = line.completedAt;
      let nextWorkflow = { ...current, lastAction: action, lastActionAt: nowIso } as WorkflowMeta;

      if (action === "START") {
        if (line.status !== "APPROVED") throw new Error(line.status === "DRAFT" ? "LINE_NOT_APPROVED" : "INVALID_START_STATE");
        nextStatus = "IN_PROGRESS";
        nextStartedAt = line.startedAt ?? now;
        nextWorkflow = { ...nextWorkflow, pausedAt: null };
      } else if (action === "PAUSE") {
        if (line.status !== "IN_PROGRESS" || isPaused) throw new Error(isPaused ? "ALREADY_PAUSED" : "INVALID_PAUSE_STATE");
        nextWorkflow = { ...nextWorkflow, pausedAt: nowIso };
      } else if (action === "RESUME") {
        if (line.status !== "IN_PROGRESS" || !isPaused || !current.pausedAt) throw new Error("INVALID_RESUME_STATE");
        const elapsed = Math.max(0, Math.round((now.getTime() - new Date(current.pausedAt).getTime()) / 1000));
        nextWorkflow = { ...nextWorkflow, pausedAt: null, totalPausedSeconds: current.totalPausedSeconds + elapsed };
      } else if (action === "COMPLETE") {
        if (line.status !== "IN_PROGRESS") throw new Error("INVALID_COMPLETE_STATE");
        if (isPaused && current.pausedAt) {
          const elapsed = Math.max(0, Math.round((now.getTime() - new Date(current.pausedAt).getTime()) / 1000));
          nextWorkflow = { ...nextWorkflow, pausedAt: null, totalPausedSeconds: current.totalPausedSeconds + elapsed };
        } else {
          nextWorkflow = { ...nextWorkflow, pausedAt: null };
        }
        nextStatus = "COMPLETED";
        nextCompletedAt = now;
      }

      const updated = await tx.workOrderLine.update({
        where: { id: line.id },
        data: {
          status: nextStatus,
          startedAt: nextStartedAt,
          completedAt: nextCompletedAt,
          metadata: mergedMetadata(line.metadata, nextWorkflow),
        },
        select: { id: true, workOrderId: true, status: true, description: true, metadata: true, startedAt: true, completedAt: true },
      });

      let finishOrder = false;
      if (action === "COMPLETE") {
        const remaining = await tx.workOrderLine.count({
          where: {
            workOrderId: line.workOrderId,
            type: { not: "PART" },
            id: { not: line.id },
            status: { notIn: ["COMPLETED", "CANCELLED"] },
          },
        });
        finishOrder = remaining === 0;
      }

      return { line: updated, previous, finishOrder };
    });

    const target = action === "START" ? "IN_REPAIR"
      : action === "PAUSE" ? "PAUSED"
        : action === "RESUME" ? "IN_REPAIR"
          : mutation.finishOrder ? "WAITING_QC" : null;

    let workOrder: unknown = null;
    if (target) {
      try {
        const actorName = access.context.user.employeeName || access.context.user.name || mechanic.name || "Автомеханік";
        workOrder = await transitionWorkOrder(mutation.line.workOrderId, target, actorName);
      } catch (cause) {
        await prisma.workOrderLine.update({
          where: { id: mutation.line.id },
          data: {
            status: mutation.previous.status,
            metadata: mutation.previous.metadata === null ? undefined : mutation.previous.metadata,
            startedAt: mutation.previous.startedAt,
            completedAt: mutation.previous.completedAt,
          },
        }).catch(() => undefined);
        if (cause instanceof WorkOrderNotFoundError) return error("Замовлення-наряд не знайдено.", "WORK_ORDER_NOT_FOUND", 404);
        if (cause instanceof WorkOrderTransitionError) {
          return error(
            cause.decision.missingGates.length ? "Дію заблоковано: спочатку мають бути виконані обов’язкові умови ремонту." : "Ця дія недоступна з поточного статусу наряду.",
            cause.decision.code,
            409,
            { missingGates: cause.decision.missingGates },
          );
        }
        throw cause;
      }
    }

    const effective = workflowMeta(mutation.line.metadata).pausedAt && mutation.line.status === "IN_PROGRESS" ? "PAUSED" : mutation.line.status;
    return NextResponse.json({
      ok: true,
      action,
      line: { ...mutation.line, effectiveStatus: effective },
      workOrder,
      orderAdvancedToQc: action === "COMPLETE" && mutation.finishOrder,
    });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "UNKNOWN";
    const known: Record<string, [string, number]> = {
      ASSIGNED_LINE_NOT_FOUND: ["Призначену Вам роботу не знайдено.", 404],
      PART_LINE_NOT_EXECUTABLE: ["Рядок запчастини не є виконуваною роботою механіка.", 409],
      LINE_NOT_APPROVED: ["Робота ще не погоджена сервіс-менеджером.", 409],
      INVALID_START_STATE: ["Цю роботу зараз не можна розпочати.", 409],
      INVALID_PAUSE_STATE: ["На паузу можна поставити лише активну роботу.", 409],
      ALREADY_PAUSED: ["Робота вже на паузі.", 409],
      INVALID_RESUME_STATE: ["Продовжити можна лише роботу, що перебуває на паузі.", 409],
      INVALID_COMPLETE_STATE: ["Завершити можна лише розпочату роботу.", 409],
    };
    if (known[code]) return error(known[code][0], code, known[code][1]);
    console.error("PATCH mechanic task lifecycle failed", cause);
    return error("Не вдалося змінити стан роботи.", "MECHANIC_TASK_UPDATE_FAILED", 500);
  }
}
