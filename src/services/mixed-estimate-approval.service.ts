import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { ensureEstimateSnapshotTx } from "@/src/services/work-order-commercial.service";
import { getWorkOrderEstimateApprovalStateTx } from "@/src/services/work-order-estimate-approval-scope.service";

type Tx = Prisma.TransactionClient;

const ACTIVE_LINE_STATUSES = ["DRAFT", "APPROVED", "IN_PROGRESS", "COMPLETED"] as const;

export class MixedEstimateApprovalError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "MixedEstimateApprovalError";
    this.code = code;
    this.status = status;
  }
}

function text(value: unknown, max = 2000) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return toPrismaJson(value);
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function currentActiveLines(tx: Tx, workOrderId: string) {
  return tx.workOrderLine.findMany({
    where: { workOrderId, status: { in: [...ACTIVE_LINE_STATUSES] } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

async function approvalDecisions(tx: Tx, estimateId: string) {
  return tx.clientEstimateLineDecision.findMany({
    where: { estimateId },
    orderBy: { decidedAt: "asc" },
    select: {
      lineId: true,
      decision: true,
      note: true,
      decidedAt: true,
      clientId: true,
      vehicleId: true,
      estimateFingerprint: true,
    },
  });
}

async function assertMixedPending(tx: Tx, workOrderId: string) {
  const state = await getWorkOrderEstimateApprovalStateTx(tx, workOrderId);
  if (!state.estimate) throw new MixedEstimateApprovalError("ESTIMATE_NOT_FOUND", "Кошторис не знайдено.", 404);
  if (!state.mixedPending || state.selectionMode !== "MIXED") {
    throw new MixedEstimateApprovalError(
      "MIXED_DECISION_NOT_READY",
      "Немає повного змішаного рішення клієнта, яке очікує підтвердження менеджера.",
      409,
    );
  }
  return state;
}

export async function getMixedEstimateApprovalState(workOrderId: string) {
  const prisma = getPrisma();
  const state = await getWorkOrderEstimateApprovalStateTx(prisma, workOrderId);
  if (!state.estimate) return { ...state, pending: false, decisions: [] };
  const decisions = await approvalDecisions(prisma, state.estimate.id);
  return {
    ...state,
    pending: state.mixedPending,
    decisions: decisions.map((item) => ({
      ...item,
      decidedAt: item.decidedAt.toISOString(),
    })),
  };
}

export async function confirmMixedEstimateApproval(
  workOrderId: string,
  actorName = "CRM / Сервіс-менеджер",
  note?: string | null,
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", "mixed-estimate-approval:" + workOrderId);
    const state = await assertMixedPending(tx, workOrderId);
    if (!state.estimate) throw new MixedEstimateApprovalError("ESTIMATE_NOT_FOUND", "Кошторис не знайдено.", 404);
    const estimate = state.estimate;
    const decisions = await approvalDecisions(tx, estimate.id);
    const decisionMap = new Map(decisions.map((item) => [item.lineId, item.decision]));
    const lines = await currentActiveLines(tx, workOrderId);
    const missing = lines.filter((line) => !decisionMap.has(line.id));
    if (missing.length) {
      throw new MixedEstimateApprovalError("DECISION_REQUIRED_FOR_EACH_LINE", "Для кожної позиції потрібне рішення клієнта.", 409);
    }
    if (lines.some((line) => line.status === "IN_PROGRESS" || line.status === "COMPLETED")) {
      throw new MixedEstimateApprovalError("MIXED_DECISION_LINE_STARTED", "Змішане погодження не можна застосувати після початку робіт по позиції.", 409);
    }

    const now = new Date();
    const approvedLines = lines.filter((line) => decisionMap.get(line.id) === "APPROVE");
    const rejectedLines = lines.filter((line) => decisionMap.get(line.id) === "REJECT");
    if (!approvedLines.length || !rejectedLines.length) {
      throw new MixedEstimateApprovalError("MIXED_DECISION_REQUIRED", "Для цієї операції потрібні одночасно погоджені та відхилені позиції.", 409);
    }

    for (const line of approvedLines) {
      await tx.workOrderLine.update({
        where: { id: line.id },
        data: { status: "APPROVED", approvedAt: line.approvedAt || now, cancelledAt: null },
      });
    }
    for (const line of rejectedLines) {
      const previousMetadata = objectValue(line.metadata);
      await tx.workOrderLine.update({
        where: { id: line.id },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          metadata: jsonSafe({
            ...previousMetadata,
            mixedApproval: {
              decision: "REJECT",
              estimateId: estimate.id,
              decidedAt: now.toISOString(),
            },
          }),
        },
      });
    }

    const rebuilt = await ensureEstimateSnapshotTx(tx, workOrderId, { actorName });
    const approvedEstimate = await tx.workOrderEstimate.update({
      where: { id: rebuilt.estimate.id },
      data: {
        status: "APPROVED",
        approvedAt: now,
        approvedByName: "Клієнт · змішане погодження",
        approvalSource: "CLIENT_GARAGE_MIXED",
        approvalNote: text(note, 2000) || "Погоджені позиції підтверджені менеджером; відхилені позиції виключені з ремонту.",
      },
      include: { partsRequests: { include: { items: true } } },
    });

    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrderEstimate",
        entityId: estimate.id,
        action: "MIXED_ESTIMATE_APPROVAL_CONFIRMED",
        before: jsonSafe({ status: estimate.status, revision: estimate.revision }),
        after: jsonSafe({
          newEstimateId: approvedEstimate.id,
          newRevision: approvedEstimate.revision,
          approvedLineIds: approvedLines.map((line) => line.id),
          rejectedLineIds: rejectedLines.map((line) => line.id),
          note: text(note, 2000),
        }),
        metadata: jsonSafe({ workOrderId, source: "CLIENT_GARAGE_MIXED" }),
      },
    });

    return {
      previousEstimate: estimate,
      estimate: approvedEstimate,
      approvedLineIds: approvedLines.map((line) => line.id),
      rejectedLineIds: rejectedLines.map((line) => line.id),
      decisionMode: "MIXED" as const,
      reused: false,
    };
  });
}

export async function requestMixedEstimateRevision(
  workOrderId: string,
  actorName = "CRM / Сервіс-менеджер",
  note?: string | null,
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", "mixed-estimate-revision:" + workOrderId);
    const state = await assertMixedPending(tx, workOrderId);
    const estimate = state.estimate;
    const now = new Date();
    const updated = await tx.workOrderEstimate.update({
      where: { id: estimate.id },
      data: {
        status: "SUPERSEDED",
        supersededAt: now,
        approvalSource: "CRM_MIXED_REVIEW",
        approvalNote: text(note, 2000) || "Потрібна нова ревізія кошторису після часткового погодження клієнта.",
      },
    });
    const rebuilt = await ensureEstimateSnapshotTx(tx, workOrderId, { actorName });
    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrderEstimate",
        entityId: estimate.id,
        action: "MIXED_ESTIMATE_REVISION_REQUESTED",
        before: jsonSafe({ status: estimate.status, revision: estimate.revision }),
        after: jsonSafe({ supersededEstimateId: updated.id, newEstimateId: rebuilt.estimate.id, newRevision: rebuilt.estimate.revision, note: text(note, 2000) }),
        metadata: jsonSafe({ workOrderId }),
      },
    });
    return { previousEstimate: updated, estimate: rebuilt.estimate, decisionMode: "MIXED" as const, reused: false };
  });
}
