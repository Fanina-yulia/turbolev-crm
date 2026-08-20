import { DiagnosticRequestStatus, DiagnosticReviewState } from "@/src/generated/prisma/client";
import { evaluateWorkflowTransition, type WorkflowTransitionDecision } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
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

type StructuredMeta = {
  reviewState: string;
  reviewerUserId: string | null;
  inspections: number;
  checked: number;
  defects: number;
  attention: number;
};

export function parseDiagnosticStatus(value: unknown): DiagnosticRequestStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return Object.values(DiagnosticRequestStatus).find((status) => status === normalized) ?? null;
}

async function structuredMeta(ids: string[]) {
  const prisma = getPrisma();
  if (!ids.length) return new Map<string, StructuredMeta>();
  const [reviews, inspections] = await Promise.all([
    prisma.diagnosticReview.findMany({ where: { diagnosticRequestId: { in: ids } } }),
    prisma.diagnosticInspection.findMany({ where: { diagnosticRequestId: { in: ids } }, select: { id: true, diagnosticRequestId: true } }),
  ]);
  const inspectionIds = inspections.map((item) => item.id);
  const checks = inspectionIds.length ? await prisma.diagnosticCheck.findMany({ where: { inspectionId: { in: inspectionIds } }, select: { inspectionId: true, state: true } }) : [];
  const requestByInspection = new Map(inspections.map((item) => [item.id, item.diagnosticRequestId]));
  const result = new Map<string, StructuredMeta>();
  for (const id of ids) {
    const review = reviews.find((row) => row.diagnosticRequestId === id);
    result.set(id, {
      reviewState: review?.state || DiagnosticReviewState.DRAFT,
      reviewerUserId: review?.reviewerUserId || null,
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

async function reportShareMeta(ids: string[]) {
  const prisma = getPrisma();
  const result = new Map<string, { id: string; createdAt: Date; expiresAt: Date | null; revokedAt: Date | null; active: boolean }>();
  if (!ids.length) return result;
  const shares = await prisma.diagnosticReportShare.findMany({
    where: { diagnosticRequestId: { in: ids } },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, diagnosticRequestId: true, createdAt: true, expiresAt: true, revokedAt: true },
  });
  for (const share of shares) {
    if (result.has(share.diagnosticRequestId)) continue;
    result.set(share.diagnosticRequestId, {
      id: share.id,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      revokedAt: share.revokedAt,
      active: !share.revokedAt && (!share.expiresAt || share.expiresAt.getTime() > Date.now()),
    });
  }
  return result;
}

function diagnosticWorkflowState(status: DiagnosticRequestStatus, structured: StructuredMeta | undefined, reportActive: boolean) {
  if (status === DiagnosticRequestStatus.CONFIRMED && reportActive) return "CARD_SENT";
  if (structured?.reviewState === DiagnosticReviewState.SUBMITTED && structured.reviewerUserId) return "REVIEWING";
  if (structured?.reviewState === DiagnosticReviewState.SUBMITTED) return "SUBMITTED";
  if (structured?.reviewState === DiagnosticReviewState.RETURNED) return "RETURNED";
  return status;
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
  const ids = rows.map((row) => row.id);
  const [meta, reports] = await Promise.all([structuredMeta(ids), reportShareMeta(ids)]);
  return rows.map((row) => {
    const structured = meta.get(row.id);
    const reportShare = reports.get(row.id) || null;
    return {
      ...row,
      reviewState: structured?.reviewState || DiagnosticReviewState.DRAFT,
      reviewerUserId: structured?.reviewerUserId || null,
      workflowState: diagnosticWorkflowState(row.status, structured, Boolean(reportShare?.active)),
      reportShare,
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
  const [meta, reports] = await Promise.all([structuredMeta([id]), reportShareMeta([id])]);
  const structured = meta.get(id);
  const reportShare = reports.get(id) || null;
  return {
    ...row,
    reviewState: structured?.reviewState || DiagnosticReviewState.DRAFT,
    reviewerUserId: structured?.reviewerUserId || null,
    workflowState: diagnosticWorkflowState(row.status, structured, Boolean(reportShare?.active)),
    reportShare,
    structured: {
      inspections: structured?.inspections || 0,
      checked: structured?.checked || 0,
      defects: structured?.defects || 0,
      attention: structured?.attention || 0,
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
      throw new DiagnosticValidationError("Автомеханік ще не завершив діагностику та не передав її сервіс-менеджеру.");
    }
    if (!conclusion && !current.technicalConclusion?.trim()) conclusion = await buildStructuredTechnicalConclusion(id).catch(() => null);
    if (!(conclusion || current.technicalConclusion?.trim())) {
      throw new DiagnosticValidationError("Перед створенням діагностичної карти заповніть технічний висновок.");
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
            workOrderCreationDeferred: input.status === DiagnosticRequestStatus.CONFIRMED,
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

  if (input.status === DiagnosticRequestStatus.CONFIRMED) {
    await markStructuredDiagnosticConfirmed(id, input.reviewerUserId || null).catch(() => undefined);
  }

  const diagnostic = await getDiagnostic(id);
  if (!diagnostic) throw new DiagnosticNotFoundError(id);
  return { diagnostic, workOrder: diagnostic.workOrder ?? current.workOrder, workflowDecision: decision };
}
