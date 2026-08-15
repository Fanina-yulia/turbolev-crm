import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";

type Tx = Prisma.TransactionClient;

export class WorkOrderQualityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkOrderQualityError";
    this.code = code;
  }
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function ensureWorkOrder(tx: Tx, workOrderId: string) {
  const workOrder = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, status: true } });
  if (!workOrder) throw new WorkOrderQualityError("WORK_ORDER_NOT_FOUND", "WorkOrder not found");
  return workOrder;
}

export async function getQualityControlStateTx(tx: Tx, workOrderId: string) {
  await ensureWorkOrder(tx, workOrderId);
  const attempts = await tx.workOrderQualityControl.findMany({
    where: { workOrderId },
    orderBy: [{ attempt: "desc" }, { createdAt: "desc" }],
  });
  const latest = attempts[0] ?? null;
  return {
    latest,
    attempts,
    passed: latest?.status === "PASSED",
    failed: latest?.status === "FAILED",
    active: Boolean(latest && ["PENDING", "IN_PROGRESS", "RECHECK"].includes(latest.status)),
  };
}

export async function getQualityControlState(workOrderId: string) {
  const prisma = getPrisma();
  return getQualityControlStateTx(prisma, workOrderId);
}

export async function ensureQualityControlTaskTx(
  tx: Tx,
  workOrderId: string,
  actorName = "CRM / Контроль якості",
) {
  await ensureWorkOrder(tx, workOrderId);
  const latest = await tx.workOrderQualityControl.findFirst({
    where: { workOrderId },
    orderBy: [{ attempt: "desc" }, { createdAt: "desc" }],
  });
  if (latest && ["PENDING", "IN_PROGRESS", "RECHECK"].includes(latest.status)) return latest;
  if (latest?.status === "PASSED") return latest;

  const task = await tx.workOrderQualityControl.create({
    data: { workOrderId, attempt: (latest?.attempt ?? 0) + 1, status: "PENDING" },
  });
  await tx.auditEvent.create({
    data: {
      actorName,
      entityType: "WorkOrderQualityControl",
      entityId: task.id,
      action: "QC_TASK_CREATED",
      after: jsonSafe(task),
      metadata: jsonSafe({ workOrderId, attempt: task.attempt }),
    },
  });
  return task;
}

export async function ensureQualityControlTask(workOrderId: string, actorName = "CRM / Контроль якості") {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-order-qc:${workOrderId}`}))`;
    return ensureQualityControlTaskTx(tx, workOrderId, actorName);
  });
}

export async function updateQualityControl(
  workOrderId: string,
  input: Record<string, unknown>,
  actorName = "CRM / Контроль якості",
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-order-qc:${workOrderId}`}))`;
    await ensureWorkOrder(tx, workOrderId);
    let latest = await tx.workOrderQualityControl.findFirst({
      where: { workOrderId },
      orderBy: [{ attempt: "desc" }, { createdAt: "desc" }],
    });
    if (!latest) latest = await ensureQualityControlTaskTx(tx, workOrderId, actorName);

    const action = typeof input.action === "string" ? input.action.trim().toUpperCase() : "";
    const now = new Date();
    let status = latest.status;
    if (action === "START") {
      if (!["PENDING", "RECHECK"].includes(latest.status)) throw new WorkOrderQualityError("QC_START_NOT_ALLOWED", "QC cannot be started from the current status");
      status = "IN_PROGRESS";
    } else if (action === "PASS") {
      if (latest.status !== "IN_PROGRESS") throw new WorkOrderQualityError("QC_RESULT_NOT_ALLOWED", "Start QC before recording the result");
      status = "PASSED";
    } else if (action === "FAIL") {
      if (latest.status !== "IN_PROGRESS") throw new WorkOrderQualityError("QC_RESULT_NOT_ALLOWED", "Start QC before recording the result");
      status = "FAILED";
    } else if (action === "RECHECK") {
      if (latest.status !== "FAILED") throw new WorkOrderQualityError("QC_RECHECK_NOT_ALLOWED", "Recheck is available only after a failed QC attempt");
      const task = await tx.workOrderQualityControl.create({
        data: {
          workOrderId,
          attempt: latest.attempt + 1,
          status: "RECHECK",
          performedByName: typeof input.performedByName === "string" ? input.performedByName.trim().slice(0, 160) || null : null,
          resultNote: typeof input.note === "string" ? input.note.trim().slice(0, 4000) || null : null,
        },
      });
      await tx.auditEvent.create({
        data: { actorName, entityType: "WorkOrderQualityControl", entityId: task.id, action: "QC_RECHECK_CREATED", after: jsonSafe(task), metadata: jsonSafe({ workOrderId, attempt: task.attempt }) },
      });
      return getQualityControlStateTx(tx, workOrderId);
    } else {
      throw new WorkOrderQualityError("QC_ACTION_REQUIRED", "Use START, PASS, FAIL or RECHECK");
    }

    const before = latest;
    const checklist = Object.prototype.hasOwnProperty.call(input, "checklist")
      ? input.checklist == null ? Prisma.JsonNull : jsonSafe(input.checklist)
      : latest.checklist === null ? Prisma.JsonNull : latest.checklist;
    const updated = await tx.workOrderQualityControl.update({
      where: { id: latest.id },
      data: {
        status,
        checklist,
        performedByName: typeof input.performedByName === "string" ? input.performedByName.trim().slice(0, 160) || null : latest.performedByName,
        resultNote: typeof input.note === "string" ? input.note.trim().slice(0, 4000) || null : latest.resultNote,
        startedAt: status === "IN_PROGRESS" ? latest.startedAt ?? now : latest.startedAt,
        completedAt: ["PASSED", "FAILED"].includes(status) ? now : latest.completedAt,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrderQualityControl",
        entityId: updated.id,
        action: `QC_${action}`,
        before: jsonSafe(before),
        after: jsonSafe(updated),
        metadata: jsonSafe({ workOrderId, attempt: updated.attempt }),
      },
    });
    return getQualityControlStateTx(tx, workOrderId);
  });
}
