import { DiagnosticRequestStatus, DiagnosticReviewState } from "@/src/generated/prisma/client";
import { evaluateWorkflowTransition, type WorkflowTransitionDecision } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { createWorkOrderFromConfirmedDiagnostic } from "@/src/services/work-orders.service";
import {
  buildStructuredTechnicalConclusion,
  getStructuredDiagnostic,
  markStructuredDiagnosticConfirmed,
} from "@/src/services/structured-diagnostics.service";

export class DiagnosticNotFoundError extends Error {
  constructor(id: string) { super(`DiagnosticRequest not found: ${id}`); this.name = "DiagnosticNotFoundError"; }
}

export class DiagnosticValidationError extends Error {}

export class DiagnosticTransitionError extends Error {
  readonly decision: WorkflowTransitionDecision;
  constructor(decision: WorkflowTransitionDecision) {
    super(decision.code);
    this.name = "DiagnosticTransitionError";
    this.decision = decision;
  }
}

export type DiagnosticTransitionInput = {
  status: DiagnosticRequestStatus;
  technicalConclusion?: string | null;
  actorName?: string | null;
  reviewerUserId?: string | null;
};

function clean(value: unknown, max = 10000) {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next ? next.slice(0, max) : null;
}

export function parseDiagnosticStatus(value: unknown): DiagnosticRequestStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return Object.values(DiagnosticRequestStatus).find((status) => status === normalized) ?? null;
}

async function structuredMeta(ids: string[]) {
  const prisma = getPrisma();
  if (!ids.length) return new Map<string, { reviewState: string; inspections: number; checked: number; defects: number; attention: number }>();
  const [reviews, inspections] = await Promise.all([
    prisma.diagnosticReview.findMany({ where: { diagnosticRequestId: { in: ids } } }),
    prisma.diagnosticInspection.findMany({ where: { diagnosticRequestId: { in: ids } }, select: { id: true, diagnosticRequestId: true } }),
  ]);
  const inspectionIds = inspections.map((item) => item.id);
  const checks = inspectionIds.length ? await prisma.diagnosticCheck.findMany({ where: { inspectionId: { in: inspectionIds } }, select: { inspectionId: true, state: true } }) : [];
  const requestByInspection = new Map(inspections.map((item) => [item.id, item.diagnosticRequestId]));
  const result = new Map<string, { reviewState: string; inspections: number; checked: number; defects: number; attention: number }>();
  for (const id of ids) {
    result.set(id, {
      reviewState: reviews.find((row) => row.diagnosticRequestId === id)?.state || DiagnosticReviewState.DRAFT,
      inspections: inspections.filter((row) => row.diagnosticRequestId === id).length,
      checked: 0,
      defects: 0,
      attention: 0,
    });
  }
  for (const check of checks) {
    const requestId = requestByInspection.get(check.inspectionId);
    const meta = requestId ? result.get(requestId) : null;
    if (!meta) continue;
    if (check.state !== "NOT_CHECKED") meta.checked += 1;
    if (check.state === "DEFECT") meta.defects += 1;
    if (check.state === "ATTENTION") meta.attention += 1;
  }
  return result;
}

export async function listDiagnostics(input?: { status?: DiagnosticRequestStatus | null; limit?: number }) {
  const prisma = getPrisma();
  const limit = Math.max(1, Math.min(500, input?.limit ?? 200));
  const rows = await prisma.diagnosticRequest.findMany({
    where: input?.status ? { status: input.status } : undefined,
    include: {
      client: { select: { id: true, name: true, phone: true } },
      vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true, mileageKm: true } },
      lead: { select: { id: true, need: true, comment: true, assignedUserId: true } },
      workOrder: true,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: limit,
  });
  const meta = await structuredMeta(rows.map((row) => row.id));
  return rows.map((row) => {
    const structured = meta.get(row.id);
    return {
      ...row,
      reviewState: structured?.reviewState || DiagnosticReviewState.DRAFT,
      workflowState: structured?.reviewState === DiagnosticReviewState.SUBMITTED
        ? "SUBMITTED"
        : structured?.reviewState === DiagnosticReviewState.RETURNED
          ? "RETURNED"
          : row.status,
      structured: {
        inspections: structured?.inspections || 0,
        checked: structured?.checked || 0,
        defects: structured?.defects || 0,
        attention: structured?.attention || 0,
      },
    };
  });
}

export async function getDiagnostic(id: string) {
  const prisma = getPrisma();
  const row = await prisma.diagnosticRequest.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true, phone: true } },
      vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true, mileageKm: true } },
      lead: { select: { id: true, need: true, comment: true, assignedUserId: true } },
      workOrder: true,
    },
  });
  if (!row) return null;
  const meta = (await structuredMeta([id])).get(id);
  return {
    ...row,
    reviewState: meta?.reviewState || DiagnosticReviewState.DRAFT,
    workflowState: meta?.reviewState === DiagnosticReviewState.SUBMITTED
      ? "SUBMITTED"
      : meta?.reviewState === DiagnosticReviewState.RETURNED
        ? "RETURNED"
        : row.status,
    structured: {
      inspections: meta?.inspections || 0,
      checked: meta?.checked || 0,
      defects: meta?.defects || 0,
      attention: meta?.attention || 0,
    },
  };
}

export async function transitionDiagnostic(id: string, input: DiagnosticTransitionInput) {
  const prisma = getPrisma();
  const actorName = clean(input.actorName, 160) || "CRM";
  let conclusion = clean(input.technicalConclusion, 10000);

  const current = await prisma.diagnosticRequest.findUnique({ where: { id }, include: { workOrder: true } });
  if (!current) throw new DiagnosticNotFoundError(id);

  const decision = evaluateWorkflowTransition({ entity: "DIAGNOSTIC", from: current.status, to: input.status });
  if (!decision.allowed) throw new DiagnosticTransitionError(decision);

  if (input.status === DiagnosticRequestStatus.CONFIRMED) {
    const structured = await getStructuredDiagnostic(id).catch(() => null);
    if (structured?.inspections.length && structured.diagnostic.review.state !== DiagnosticReviewState.SUBMITTED && structured.diagnostic.review.state !== DiagnosticReviewState.CONFIRMED) {
      throw new DiagnosticValidationError("Автомеханік ще не передав структуровану діагностику сервіс-менеджеру.");
    }
    if (!conclusion && !current.technicalConclusion?.trim()) conclusion = await buildStructuredTechnicalConclusion(id).catch(() => null);
    if (!(conclusion || current.technicalConclusion?.trim())) {
      throw new DiagnosticValidationError("Для підтвердження діагностики заповніть технічний висновок.");
    }
  }

  if (decision.code !== "NOOP") {
    await prisma.$transaction(async (tx) => {
      const before = await tx.diagnosticRequest.findUnique({ where: { id } });
      if (!before) throw new DiagnosticNotFoundError(id);
      const freshDecision = evaluateWorkflowTransition({ entity: "DIAGNOSTIC", from: before.status, to: input.status });
      if (!freshDecision.allowed) throw new DiagnosticTransitionError(freshDecision);

      const after = await tx.diagnosticRequest.update({
        where: { id },
        data: {
          status: input.status,
          technicalConclusion: conclusion ?? undefined,
          confirmedAt: input.status === DiagnosticRequestStatus.CONFIRMED ? before.confirmedAt ?? new Date() : undefined,
        },
      });

      await tx.auditEvent.create({
        data: {
          actorName,
          entityType: "DiagnosticRequest",
          entityId: id,
          action: `STATUS_${before.status}_TO_${after.status}`,
          before: toPrismaJson(before),
          after: toPrismaJson(after),
          metadata: toPrismaJson({
            workflowDecision: freshDecision.code,
            actions: freshDecision.actions,
            hardGate: "WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS",
            structured: true,
          }),
        },
      });
    });
  } else if (conclusion && conclusion !== current.technicalConclusion) {
    await prisma.$transaction(async (tx) => {
      const after = await tx.diagnosticRequest.update({ where: { id }, data: { technicalConclusion: conclusion } });
      await tx.auditEvent.create({
        data: {
          actorName,
          entityType: "DiagnosticRequest",
          entityId: id,
          action: "UPDATE_TECHNICAL_CONCLUSION",
          before: toPrismaJson(current),
          after: toPrismaJson(after),
        },
      });
    });
  }

  let workOrder = current.workOrder;
  if (input.status === DiagnosticRequestStatus.CONFIRMED) {
    const hadWorkOrder = Boolean(current.workOrder);
    workOrder = await createWorkOrderFromConfirmedDiagnostic(id);
    await markStructuredDiagnosticConfirmed(id, input.reviewerUserId || null).catch(() => undefined);
    if (!hadWorkOrder) {
      await prisma.auditEvent.create({
        data: {
          actorName,
          entityType: "WorkOrder",
          entityId: workOrder.id,
          action: "CREATE_AFTER_CONFIRMED_DIAGNOSTICS",
          after: toPrismaJson(workOrder),
          metadata: toPrismaJson({ diagnosticRequestId: id, hardGate: "WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS", passed: true }),
        },
      }).catch(() => undefined);
    }
  }

  const diagnostic = await getDiagnostic(id);
  if (!diagnostic) throw new DiagnosticNotFoundError(id);
  return { diagnostic, workOrder: diagnostic.workOrder ?? workOrder, workflowDecision: decision };
}
