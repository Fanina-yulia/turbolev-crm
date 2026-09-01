import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/src/generated/prisma/client";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { transitionWorkOrder, WorkOrderNotFoundError, WorkOrderTransitionError } from "@/src/services/work-orders.service";
import { normalizeRegistrationPlate } from "@/src/domain/registration-plate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Action = "START" | "PAUSE" | "STOP" | "RESUME" | "COMPLETE" | "WAITING_PARTS";

const STOP_REASONS = new Set(["PARTS_UNAVAILABLE", "TECHNICAL_PROBLEM", "SAFETY_RISK", "CUSTOMER_APPROVAL_REQUIRED", "OTHER"]);
const STOP_COMMENT_REQUIRED = new Set(["TECHNICAL_PROBLEM", "SAFETY_RISK", "CUSTOMER_APPROVAL_REQUIRED", "OTHER"]);
const STOP_REASON_LABELS: Record<string, string> = {
  PARTS_UNAVAILABLE: "Немає потрібної запчастини",
  TECHNICAL_PROBLEM: "Технічна проблема",
  SAFETY_RISK: "Ризик для безпеки",
  CUSTOMER_APPROVAL_REQUIRED: "Потрібне погодження клієнта",
  OTHER: "Інша причина",
};

type WorkflowMeta = {
  pausedAt: string | null;
  pauseReason: string | null;
  pauseNote: string | null;
  stopAt: string | null;
  stopReason: string | null;
  stopNote: string | null;
  stopIssueId: string | null;
  stopStatus: string | null;
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
  const pauseReason = typeof workflow.pauseReason === "string" && workflow.pauseReason ? workflow.pauseReason : null;
  const pauseNote = typeof workflow.pauseNote === "string" && workflow.pauseNote ? workflow.pauseNote : null;
  const stopAt = typeof workflow.stopAt === "string" && workflow.stopAt ? workflow.stopAt : null;
  const stopReason = typeof workflow.stopReason === "string" && workflow.stopReason ? workflow.stopReason : null;
  const stopNote = typeof workflow.stopNote === "string" && workflow.stopNote ? workflow.stopNote : null;
  const stopIssueId = typeof workflow.stopIssueId === "string" && workflow.stopIssueId ? workflow.stopIssueId : null;
  const stopStatus = typeof workflow.stopStatus === "string" && workflow.stopStatus ? workflow.stopStatus : null;
  const totalPausedSeconds = Number(workflow.totalPausedSeconds ?? 0);
  return {
    pausedAt,
    pauseReason,
    pauseNote,
    stopAt,
    stopReason,
    stopNote,
    stopIssueId,
    stopStatus,
    totalPausedSeconds: Number.isFinite(totalPausedSeconds) && totalPausedSeconds > 0 ? Math.floor(totalPausedSeconds) : 0,
    lastAction: ["START", "PAUSE", "STOP", "RESUME", "COMPLETE", "WAITING_PARTS"].includes(String(workflow.lastAction)) ? workflow.lastAction as Action : null,
    lastActionAt: typeof workflow.lastActionAt === "string" ? workflow.lastActionAt : null,
  };
}

function plateVerification(metadata: unknown) {
  const root = record(metadata);
  const verification = record(root.mechanicPlateVerification);
  return typeof verification.plate === "string" ? verification.plate : null;
}

function mergedMetadata(metadata: unknown, workflow: WorkflowMeta) {
  return toPrismaJson({ ...record(metadata), mechanicWorkflow: workflow });
}

function error(message: string, code: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: code, message, ...extra }, { status });
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null; plateNumber: string | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || vehicle.plateNumber || "Автомобіль";
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
    if (!(["START", "PAUSE", "STOP", "RESUME", "COMPLETE", "WAITING_PARTS"] as string[]).includes(action)) {
      return error("Невідома дія з роботою.", "INVALID_ACTION", 400);
    }
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 240) : "";
    const reasonCode = typeof body?.reasonCode === "string" ? body.reasonCode.trim().toUpperCase().slice(0, 48) : "";
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : reason;
    const verifiedPlate = typeof body?.verifiedPlate === "string" ? body.verifiedPlate.trim().slice(0, 32) : "";
    const verifiedByScan = body?.verifiedByScan === true;
    if (action === "STOP") {
      if (!STOP_REASONS.has(reasonCode)) return error("Виберіть причину зупинки роботи.", "STOP_REASON_REQUIRED", 400);
      if (STOP_COMMENT_REQUIRED.has(reasonCode) && note.length < 3) return error("Для цієї причини додайте короткий опис.", "STOP_NOTE_REQUIRED", 400);
    }

    const prisma = getPrisma();
    const mechanic = await prisma.serviceMechanic.findFirst({
      where: { userId: access.context.user.id, isActive: true },
      select: { id: true, name: true, locationId: true },
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
          workOrder: { select: { clientId: true, vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true } } } },
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
      const isStopped = line.status === "IN_PROGRESS" && Boolean(current.stopAt);
      let nextStatus = line.status;
      let nextStartedAt = line.startedAt;
      let nextCompletedAt = line.completedAt;
      let nextWorkflow = { ...current, lastAction: action, lastActionAt: nowIso } as WorkflowMeta;
      let createdStopIssueId: string | null = null;

      if (action === "START") {
        if (line.status !== "APPROVED") throw new Error(line.status === "DRAFT" ? "LINE_NOT_APPROVED" : "INVALID_START_STATE");
        const expectedPlate = line.workOrder.vehicle.plateNumber;
        if (expectedPlate && plateVerification(line.metadata) !== normalizeRegistrationPlate(expectedPlate)) throw new Error("PLATE_VERIFICATION_REQUIRED");
        nextStatus = "IN_PROGRESS";
        nextStartedAt = line.startedAt ?? now;
        nextWorkflow = { ...nextWorkflow, pausedAt: null, pauseReason: null, pauseNote: null, stopAt: null, stopReason: null, stopNote: null, stopIssueId: null, stopStatus: null };
      } else if (action === "PAUSE") {
        if (line.status !== "IN_PROGRESS" || isPaused) throw new Error(isStopped ? "STOPPED_REQUIRES_RESUME" : isPaused ? "ALREADY_PAUSED" : "INVALID_PAUSE_STATE");
        nextWorkflow = { ...nextWorkflow, pausedAt: nowIso, pauseReason: "OTHER", pauseNote: reason || null };
      } else if (action === "STOP") {
        if (line.status !== "IN_PROGRESS" || isPaused) throw new Error(isPaused ? "ALREADY_PAUSED" : "INVALID_STOP_STATE");
        const existingIssue = await tx.workExecutionIssue.findFirst({
          where: { assignmentId: line.id, status: { in: ["OPEN", "VIEWED", "NEEDS_CLARIFICATION"] } },
          orderBy: { createdAt: "desc" },
        });
        const stopIssue = existingIssue || await tx.workExecutionIssue.create({
          data: {
            assignmentId: line.id,
            workOrderId: line.workOrderId,
            vehicleId: line.workOrder.vehicle.id,
            clientId: line.workOrder.clientId,
            mechanicId: mechanic.id,
            locationId: mechanic.locationId,
            reasonCode,
            comment: note || null,
          },
        });
        if (!existingIssue) createdStopIssueId = stopIssue.id;
        const displayVehicle = vehicleLabel(line.workOrder.vehicle);
        const managers = await tx.userAccessRole.findMany({
          where: { locationId: mechanic.locationId, isActive: true, role: { code: { in: ["STATION_MANAGER", "SERVICE_ADVISOR", "OWNER"] } } },
          select: { userId: true },
        });
        const recipients = [
          { mechanicId: mechanic.id, recipientUserId: access.context.user!.id },
          ...managers.map((item) => ({ mechanicId: item.userId, recipientUserId: item.userId })),
        ].filter((item, index, all) => all.findIndex((candidate) => candidate.mechanicId === item.mechanicId) === index);
        if (!existingIssue && recipients.length) {
          await tx.mechanicNotification.createMany({
            data: recipients.map((recipient) => ({
              id: randomUUID(),
              eventKey: `MECHANIC_STOP:${stopIssue.id}:${recipient.mechanicId}`,
              mechanicId: recipient.mechanicId,
              recipientUserId: recipient.recipientUserId,
              workOrderId: line.workOrderId,
              type: "WORK_STOP",
              title: "СТОП — робота потребує уваги",
              body: `${displayVehicle} · ${line.workOrder.vehicle.plateNumber || "Без номера"}\nПричина: ${STOP_REASON_LABELS[reasonCode] || reasonCode}${note ? `\n${note}` : ""}`,
              vehicleLabel: displayVehicle,
              plateNumber: line.workOrder.vehicle.plateNumber,
              payload: toPrismaJson({ issueId: stopIssue.id, assignmentId: line.id, stopReason: reasonCode, status: "OPEN" }),
            })),
          });
        }
        await tx.auditEvent.create({
          data: {
            actorId: access.context.user!.id,
            actorName: access.context.user!.employeeName || access.context.user!.name || mechanic.name,
            entityType: "WorkExecutionIssue",
            entityId: stopIssue.id,
            action: "MECHANIC_WORK_STOPPED",
            metadata: toPrismaJson({ assignmentId: line.id, workOrderId: line.workOrderId, reasonCode, note: note || null, issueId: stopIssue.id }),
          },
        });
        nextWorkflow = { ...nextWorkflow, pausedAt: nowIso, pauseReason: reasonCode, pauseNote: note || null, stopAt: nowIso, stopReason: reasonCode, stopNote: note || null, stopIssueId: stopIssue.id, stopStatus: "OPEN" };
      } else if (action === "RESUME") {
        if (line.status !== "IN_PROGRESS" || !isPaused || !current.pausedAt) throw new Error("INVALID_RESUME_STATE");
        if (isStopped) {
          const expectedPlate = normalizeRegistrationPlate(line.workOrder.vehicle.plateNumber || "");
          if (expectedPlate && (!verifiedByScan || normalizeRegistrationPlate(verifiedPlate) !== expectedPlate)) throw new Error("STOP_PLATE_VERIFICATION_REQUIRED");
          const stopIssue = current.stopIssueId
            ? await tx.workExecutionIssue.findFirst({ where: { id: current.stopIssueId, assignmentId: line.id } })
            : await tx.workExecutionIssue.findFirst({ where: { assignmentId: line.id, status: { in: ["OPEN", "VIEWED", "NEEDS_CLARIFICATION"] } }, orderBy: { createdAt: "desc" } });
          if (stopIssue) {
            await tx.workExecutionIssue.update({
              where: { id: stopIssue.id },
              data: {
                status: "RESOLVED",
                viewedAt: stopIssue.viewedAt || now,
                resolvedAt: now,
                resolvedByUserId: access.context.user!.id,
                resolutionType: "MECHANIC_RESUMED",
                resolutionComment: "Роботу продовжено після повторного сканування автомобіля.",
              },
            });
          }
        }
        const elapsed = Math.max(0, Math.round((now.getTime() - new Date(current.pausedAt).getTime()) / 1000));
        nextWorkflow = { ...nextWorkflow, pausedAt: null, pauseReason: null, pauseNote: null, stopAt: null, stopReason: null, stopNote: null, stopIssueId: null, stopStatus: null, totalPausedSeconds: current.totalPausedSeconds + elapsed };
      } else if (action === "WAITING_PARTS") {
        if (line.status !== "IN_PROGRESS" || isPaused) throw new Error(isStopped ? "STOPPED_REQUIRES_RESUME" : isPaused ? "ALREADY_PAUSED" : "INVALID_WAITING_PARTS_STATE");
        nextWorkflow = { ...nextWorkflow, pausedAt: nowIso, pauseReason: "PARTS", pauseNote: reason || "Потрібна запчастина" };
      } else if (action === "COMPLETE") {
        if (line.status !== "IN_PROGRESS") throw new Error("INVALID_COMPLETE_STATE");
        if (isStopped) throw new Error("STOPPED_REQUIRES_RESUME");
        if (isPaused && current.pausedAt) {
          const elapsed = Math.max(0, Math.round((now.getTime() - new Date(current.pausedAt).getTime()) / 1000));
          nextWorkflow = { ...nextWorkflow, pausedAt: null, pauseReason: null, pauseNote: null, stopAt: null, stopReason: null, stopNote: null, stopIssueId: null, stopStatus: null, totalPausedSeconds: current.totalPausedSeconds + elapsed };
        } else {
          nextWorkflow = { ...nextWorkflow, pausedAt: null, pauseReason: null, pauseNote: null, stopAt: null, stopReason: null, stopNote: null, stopIssueId: null, stopStatus: null };
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

      return { line: updated, previous, finishOrder, createdStopIssueId };
    });

    const target = action === "START" ? "IN_REPAIR"
      : action === "PAUSE" ? "PAUSED"
        : action === "STOP" ? "PAUSED"
        : action === "RESUME" ? "IN_REPAIR"
          : action === "WAITING_PARTS" ? "WAITING_PARTS"
          : mutation.finishOrder ? "WAITING_QC" : null;

    let workOrder: unknown = null;
    if (target) {
      const resumeAppointments = action === "RESUME" ? await prisma.serviceAppointment.findMany({
        where: { workOrderId: mutation.line.workOrderId, actualStartAt: { not: null } },
        select: { id: true, actualStartAt: true },
      }) : [];
      try {
        const actorName = access.context.user.employeeName || access.context.user.name || mechanic.name || "Автомеханік";
        workOrder = await transitionWorkOrder(mutation.line.workOrderId, target, actorName);
        if (action === "RESUME" && resumeAppointments.length) {
          await Promise.all(resumeAppointments.map((appointment) => prisma.serviceAppointment.update({
            where: { id: appointment.id },
            data: { actualStartAt: appointment.actualStartAt },
          })));
        }
      } catch (cause) {
        await prisma.workOrderLine.update({
          where: { id: mutation.line.id },
          data: {
            status: mutation.previous.status,
            metadata: mutation.previous.metadata === null ? Prisma.DbNull : toPrismaJson(mutation.previous.metadata),
            startedAt: mutation.previous.startedAt,
            completedAt: mutation.previous.completedAt,
          },
        }).catch(() => undefined);
        if (mutation.createdStopIssueId) {
          await prisma.workExecutionIssue.delete({ where: { id: mutation.createdStopIssueId } }).catch(() => undefined);
        }
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

    const actorName = access.context.user.employeeName || access.context.user.name || mechanic.name || "Автомеханік";
    await prisma.auditEvent.create({
      data: {
        actorId: access.context.user.id,
        actorName,
        entityType: "WorkOrderLine",
        entityId: mutation.line.id,
        action: `MECHANIC_WORK_${action}`,
        before: toPrismaJson(mutation.previous),
        after: toPrismaJson(mutation.line),
        metadata: toPrismaJson({ workOrderId: mutation.line.workOrderId, reasonCode: action === "STOP" ? reasonCode : null, note: action === "STOP" ? note || null : null }),
      },
    }).catch(() => undefined);
    const finalWorkflow = workflowMeta(mutation.line.metadata);
    const effective = finalWorkflow.stopAt && mutation.line.status === "IN_PROGRESS"
      ? "STOPPED"
      : finalWorkflow.pausedAt && mutation.line.status === "IN_PROGRESS" ? "PAUSED" : mutation.line.status;
    return NextResponse.json({
      ok: true,
      action,
      line: { ...mutation.line, effectiveStatus: effective, stopReason: finalWorkflow.stopReason, stopNote: finalWorkflow.stopNote, stopIssueId: finalWorkflow.stopIssueId },
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
      INVALID_STOP_STATE: ["Зупинити можна лише активну роботу.", 409],
      STOPPED_REQUIRES_RESUME: ["Спочатку відновіть роботу повторним скануванням автомобіля.", 409],
      STOP_PLATE_VERIFICATION_REQUIRED: ["Для продовження після СТОП повторно підтвердіть номер автомобіля скануванням.", 409],
      STOP_REASON_REQUIRED: ["Виберіть причину зупинки роботи.", 400],
      STOP_NOTE_REQUIRED: ["Додайте короткий опис причини зупинки.", 400],
      ALREADY_PAUSED: ["Робота вже на паузі.", 409],
      INVALID_RESUME_STATE: ["Продовжити можна лише роботу, що перебуває на паузі.", 409],
      INVALID_WAITING_PARTS_STATE: ["Очікувати запчастину можна лише для розпочатої роботи.", 409],
      INVALID_COMPLETE_STATE: ["Завершити можна лише розпочату роботу.", 409],
      PLATE_VERIFICATION_REQUIRED: ["Перед початком підтвердіть номер саме цього автомобіля.", 409],
    };
    if (known[code]) return error(known[code][0], code, known[code][1]);
    console.error("PATCH mechanic task lifecycle failed", cause);
    return error("Не вдалося змінити стан роботи.", "MECHANIC_TASK_UPDATE_FAILED", 500);
  }
}
