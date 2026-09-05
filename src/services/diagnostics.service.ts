import { DiagnosticRequestStatus, DiagnosticReviewState } from "@/src/generated/prisma/client";
import { evaluateWorkflowTransition, type WorkflowTransitionDecision } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { finalizeDiagnosticCard } from "@/src/services/diagnostic-card.service";
import {
  buildStructuredTechnicalConclusion,
  getStructuredDiagnostic,
  markStructuredDiagnosticConfirmed,
} from "@/src/services/structured-diagnostics.service";
import { resolveDiagnosticWorkflowState } from "@/src/services/diagnostic-workflow.service";

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

type DiagnosticListInput = {
  status?: DiagnosticRequestStatus | null;
  limit?: number;
  vehicleId?: string | null;
  clientId?: string | null;
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
  if (!ids.length) return new Map<string, {
    reviewState: string;
    submittedAt: Date | null;
    returnedAt: Date | null;
    confirmedAt: Date | null;
    managerComment: string | null;
    inspections: number;
    checked: number;
    defects: number;
    attention: number;
  }>();
  const [reviews, inspections] = await Promise.all([
    prisma.diagnosticReview.findMany({ where: { diagnosticRequestId: { in: ids } } }),
    prisma.diagnosticInspection.findMany({ where: { diagnosticRequestId: { in: ids } }, select: { id: true, diagnosticRequestId: true } }),
  ]);
  const inspectionIds = inspections.map((item) => item.id);
  const checks = inspectionIds.length ? await prisma.diagnosticCheck.findMany({ where: { inspectionId: { in: inspectionIds } }, select: { inspectionId: true, state: true } }) : [];
  const requestByInspection = new Map(inspections.map((item) => [item.id, item.diagnosticRequestId]));
  const result = new Map<string, {
    reviewState: string;
    submittedAt: Date | null;
    returnedAt: Date | null;
    confirmedAt: Date | null;
    managerComment: string | null;
    inspections: number;
    checked: number;
    defects: number;
    attention: number;
  }>();
  for (const id of ids) {
    const review = reviews.find((row) => row.diagnosticRequestId === id);
    result.set(id, {
      reviewState: review?.state || DiagnosticReviewState.DRAFT,
      submittedAt: review?.submittedAt || null,
      returnedAt: review?.returnedAt || null,
      confirmedAt: review?.confirmedAt || null,
      managerComment: review?.managerComment || null,
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

async function diagnosticCardMeta(ids: string[]) {
  const result = new Map<string, { id: string; number: string; currentRevision: number; finalizedAt: Date | null; confirmedByUserId: string | null }>();
  if (!ids.length) return result;
  const rows = await getPrisma().diagnosticCard.findMany({
    where: { diagnosticRequestId: { in: ids } },
    select: { id: true, diagnosticRequestId: true, number: true, currentRevision: true, finalizedAt: true, confirmedByUserId: true },
  });
  for (const row of rows) result.set(row.diagnosticRequestId, row);
  return result;
}

async function assignmentMeta(ids: string[]) {
  const prisma = getPrisma();
  const result = new Map<string, { mechanicId: string | null; mechanicName: string | null; locationId: string | null }>();
  if (!ids.length) return result;
  const assignments = await prisma.diagnosticAssignment.findMany({
    where: { diagnosticRequestId: { in: ids } },
    select: { diagnosticRequestId: true, mechanicId: true, locationId: true },
  });
  const mechanicIds = Array.from(new Set(assignments.flatMap((row) => row.mechanicId ? [row.mechanicId] : [])));
  const mechanics = mechanicIds.length ? await prisma.serviceMechanic.findMany({
    where: { id: { in: mechanicIds } },
    select: { id: true, name: true },
  }) : [];
  const nameById = new Map(mechanics.map((row) => [row.id, row.name]));
  for (const row of assignments) {
    result.set(row.diagnosticRequestId, {
      mechanicId: row.mechanicId,
      mechanicName: row.mechanicId ? nameById.get(row.mechanicId) || null : null,
      locationId: row.locationId,
    });
  }
  return result;
}

async function visitMeta(ids: string[]) {
  const prisma = getPrisma();
  const result = new Map<string, {
    appointmentId: string | null;
    plannedStartAt: Date | null;
    plannedEndAt: Date | null;
    actualArrivalAt: Date | null;
    actualStartAt: Date | null;
    actualEndAt: Date | null;
    postName: string | null;
    locationName: string | null;
  }>();
  if (!ids.length) return result;

  const links = await prisma.diagnosticVisitLink.findMany({
    where: { diagnosticRequestId: { in: ids } },
    select: { diagnosticRequestId: true, appointmentId: true },
  });
  const appointments = links.length ? await prisma.serviceAppointment.findMany({
    where: { id: { in: links.map((link) => link.appointmentId) } },
    select: {
      id: true,
      plannedStartAt: true,
      plannedEndAt: true,
      actualArrivalAt: true,
      actualStartAt: true,
      actualEndAt: true,
      post: { select: { name: true } },
      location: { select: { name: true } },
    },
  }) : [];
  const appointmentById = new Map(appointments.map((appointment) => [appointment.id, appointment]));

  for (const id of ids) {
    const link = links.find((item) => item.diagnosticRequestId === id);
    const appointment = link ? appointmentById.get(link.appointmentId) : null;
    result.set(id, {
      appointmentId: link?.appointmentId || null,
      plannedStartAt: appointment?.plannedStartAt || null,
      plannedEndAt: appointment?.plannedEndAt || null,
      actualArrivalAt: appointment?.actualArrivalAt || null,
      actualStartAt: appointment?.actualStartAt || null,
      actualEndAt: appointment?.actualEndAt || null,
      postName: appointment?.post?.name || null,
      locationName: appointment?.location?.name || null,
    });
  }
  return result;
}

async function commercialMeta(rows: Array<{ id: string; workOrder: { id: string } | null }>) {
  const prisma = getPrisma();
  const result = new Map<string, {
    workOrderId: string;
    stage: "PARTS_SELECTION" | "DRAFT" | "SENT" | "APPROVED" | "REJECTED" | "SUPERSEDED";
    estimate: { id: string; revision: number; status: string } | null;
    partsRequest: { id: string; status: string } | null;
  }>();
  const workOrders = rows.flatMap((row) => row.workOrder ? [{ diagnosticId: row.id, workOrderId: row.workOrder.id }] : []);
  if (!workOrders.length) return result;
  const workOrderIds = workOrders.map((row) => row.workOrderId);
  const [estimates, partsRequests] = await Promise.all([
    prisma.workOrderEstimate.findMany({
      where: { workOrderId: { in: workOrderIds } },
      orderBy: [{ workOrderId: "asc" }, { revision: "desc" }],
      select: { id: true, workOrderId: true, revision: true, status: true },
    }),
    prisma.partsRequest.findMany({
      where: { workOrderId: { in: workOrderIds }, status: { not: "CANCELLED" } },
      orderBy: [{ workOrderId: "asc" }, { createdAt: "desc" }],
      select: { id: true, workOrderId: true, status: true },
    }),
  ]);
  const latestEstimate = new Map<string, { id: string; revision: number; status: string }>();
  const latestParts = new Map<string, { id: string; status: string }>();
  for (const row of estimates) if (!latestEstimate.has(row.workOrderId)) latestEstimate.set(row.workOrderId, { id: row.id, revision: row.revision, status: row.status });
  for (const row of partsRequests) if (!latestParts.has(row.workOrderId)) latestParts.set(row.workOrderId, { id: row.id, status: row.status });
  for (const row of workOrders) {
    const estimate = latestEstimate.get(row.workOrderId) || null;
    const partsRequest = latestParts.get(row.workOrderId) || null;
    if (!estimate && !partsRequest) continue;
    const stage = estimate
      ? (["DRAFT", "SENT", "APPROVED", "REJECTED", "SUPERSEDED"].includes(estimate.status) ? estimate.status : "DRAFT")
      : "PARTS_SELECTION";
    result.set(row.diagnosticId, {
      workOrderId: row.workOrderId,
      stage: stage as "PARTS_SELECTION" | "DRAFT" | "SENT" | "APPROVED" | "REJECTED" | "SUPERSEDED",
      estimate,
      partsRequest,
    });
  }
  return result;
}

function businessWorkflowState(rowStatus: DiagnosticRequestStatus, reviewState?: string) {
  return resolveDiagnosticWorkflowState(rowStatus, reviewState);
}

export async function listDiagnostics(input?: DiagnosticListInput) {
  const prisma = getPrisma();
  const limit = Math.max(1, Math.min(500, input?.limit ?? 200));
  const rows = await prisma.diagnosticRequest.findMany({
    where: {
      ...(input?.status ? { status: input.status } : {}),
      ...(input?.vehicleId ? { vehicleId: input.vehicleId } : {}),
      ...(input?.clientId ? { clientId: input.clientId } : {}),
    },
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
  const [meta, reports, cards, assignments, commercial, visits] = await Promise.all([
    structuredMeta(ids),
    reportShareMeta(ids),
    diagnosticCardMeta(ids),
    assignmentMeta(ids),
    commercialMeta(rows),
    visitMeta(ids),
  ]);
  return rows.map((row) => {
    const structured = meta.get(row.id);
    const reportShare = reports.get(row.id) || null;
    const diagnosticCard = cards.get(row.id) || null;
    const assignment = assignments.get(row.id) || null;
    const commercialProposal = commercial.get(row.id) || null;
    const visit = visits.get(row.id) || null;
    return {
      ...row,
      reviewState: structured?.reviewState || DiagnosticReviewState.DRAFT,
      reviewSubmittedAt: structured?.submittedAt || null,
      reviewReturnedAt: structured?.returnedAt || null,
      reviewConfirmedAt: structured?.confirmedAt || null,
      reviewManagerComment: structured?.managerComment || null,
      workflowState: businessWorkflowState(row.status, structured?.reviewState),
      reportShare,
      diagnosticCard,
      assignment,
      visit,
      assignedMechanic: assignment?.mechanicId ? { id: assignment.mechanicId, name: assignment.mechanicName } : null,
      commercialProposal,
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
  const rows = await listDiagnostics({ limit: 1 });
  const cached = rows.find((row) => row.id === id);
  if (cached) return cached;

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
  const [meta, reports, cards, assignments, commercial] = await Promise.all([
    structuredMeta([id]),
    reportShareMeta([id]),
    diagnosticCardMeta([id]),
    assignmentMeta([id]),
    commercialMeta([row]),
  ]);
  const structured = meta.get(id);
  const reportShare = reports.get(id) || null;
  const diagnosticCard = cards.get(id) || null;
  const assignment = assignments.get(id) || null;
  return {
    ...row,
    reviewState: structured?.reviewState || DiagnosticReviewState.DRAFT,
    reviewSubmittedAt: structured?.submittedAt || null,
    reviewReturnedAt: structured?.returnedAt || null,
    reviewConfirmedAt: structured?.confirmedAt || null,
    reviewManagerComment: structured?.managerComment || null,
    workflowState: businessWorkflowState(row.status, structured?.reviewState),
    reportShare,
    diagnosticCard,
    assignment,
    assignedMechanic: assignment?.mechanicId ? { id: assignment.mechanicId, name: assignment.mechanicName } : null,
    commercialProposal: commercial.get(id) || null,
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
  let structuredForConfirmation: Awaited<ReturnType<typeof getStructuredDiagnostic>> | null = null;

  const current = await prisma.diagnosticRequest.findUnique({ where: { id }, include: { workOrder: true } });
  if (!current) throw new DiagnosticNotFoundError(id);

  const decision = evaluateWorkflowTransition({ entity: "DIAGNOSTIC", from: current.status, to: input.status });
  if (!decision.allowed) throw new DiagnosticTransitionError(decision);

  if (input.status === DiagnosticRequestStatus.CONFIRMED) {
    structuredForConfirmation = await getStructuredDiagnostic(id).catch(() => null);
    if (structuredForConfirmation?.inspections.length && structuredForConfirmation.diagnostic.review.state !== DiagnosticReviewState.SUBMITTED && structuredForConfirmation.diagnostic.review.state !== DiagnosticReviewState.CONFIRMED) {
      throw new DiagnosticValidationError("Автомеханік ще не завершив діагностику та не передав її сервіс-менеджеру.");
    }
    if (!conclusion && !current.technicalConclusion?.trim() && structuredForConfirmation?.inspections.length) {
      conclusion = await buildStructuredTechnicalConclusion(id).catch(() => null);
    }
    if (!(conclusion || current.technicalConclusion?.trim())) {
      throw new DiagnosticValidationError(structuredForConfirmation?.inspections.length ? "Перед підтвердженням Діагностичної карти перевірте технічний висновок." : "Перед підтвердженням діагностики заповніть технічний висновок.");
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
            structured: Boolean(structuredForConfirmation?.inspections.length),
            diagnosticCardRequired: input.status === DiagnosticRequestStatus.CONFIRMED && Boolean(structuredForConfirmation?.inspections.length),
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
    await markStructuredDiagnosticConfirmed(id, input.reviewerUserId || null);
    if (structuredForConfirmation?.inspections.length) {
      await finalizeDiagnosticCard(id, {
        reviewerUserId: input.reviewerUserId || null,
        technicalConclusion: conclusion || current.technicalConclusion,
        actorName,
      });
    }
  }

  const diagnostic = await getDiagnostic(id);
  if (!diagnostic) throw new DiagnosticNotFoundError(id);
  return { diagnostic, workOrder: diagnostic.workOrder ?? current.workOrder, workflowDecision: decision };
}
