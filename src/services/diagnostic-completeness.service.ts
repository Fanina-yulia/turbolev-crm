import {
  DiagnosticCheckState,
  DiagnosticInspectionStatus,
  DiagnosticRequestStatus,
  DiagnosticReviewState,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { ensureDiagnosticCardReviewRevision } from "@/src/services/diagnostic-card.service";
import {
  getMechanicByUserId,
  getStructuredDiagnostic,
  getStructuredDiagnosticForMechanic,
  StructuredDiagnosticError,
} from "@/src/services/structured-diagnostics.service";

export type DiagnosticCompletion = {
  canSubmit: boolean;
  total: number;
  checked: number;
  requiredTotal: number;
  requiredChecked: number;
  requiredRemaining: number;
  optionalTotal: number;
  optionalRemaining: number;
  autoFillRemaining: number;
};

async function effectiveInspectionIds(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const inspections = await prisma.diagnosticInspection.findMany({
    where: { diagnosticRequestId },
    select: { id: true, templateId: true },
  });
  if (!inspections.length) return [];

  const templateIds = Array.from(new Set(inspections.map((inspection) => inspection.templateId)));
  const templates = await prisma.diagnosticTemplate.findMany({
    where: { id: { in: templateIds } },
    select: { id: true, code: true },
  });
  const matrixTemplateIds = new Set(
    templates.filter((template) => template.code === "SUSPENSION_MATRIX").map((template) => template.id),
  );

  const effective = matrixTemplateIds.size
    ? inspections.filter((inspection) => matrixTemplateIds.has(inspection.templateId))
    : inspections;
  return effective.map((inspection) => inspection.id);
}

export async function getRequiredDiagnosticCompletion(diagnosticRequestId: string): Promise<DiagnosticCompletion> {
  const prisma = getPrisma();
  const inspectionIds = await effectiveInspectionIds(diagnosticRequestId);
  if (!inspectionIds.length) {
    return { canSubmit: false, total: 0, checked: 0, requiredTotal: 0, requiredChecked: 0, requiredRemaining: 0, optionalTotal: 0, optionalRemaining: 0, autoFillRemaining: 0 };
  }

  const checks = await prisma.diagnosticCheck.findMany({
    where: { inspectionId: { in: inspectionIds } },
    select: { templateItemId: true, state: true },
  });
  if (!checks.length) {
    return { canSubmit: false, total: 0, checked: 0, requiredTotal: 0, requiredChecked: 0, requiredRemaining: 0, optionalTotal: 0, optionalRemaining: 0, autoFillRemaining: 0 };
  }

  const templateItems = await prisma.diagnosticTemplateItem.findMany({
    where: { id: { in: Array.from(new Set(checks.map((item) => item.templateItemId))) } },
    select: { id: true, isRequired: true, sectionId: true },
  });
  const sectionIds = Array.from(new Set(templateItems.map((item) => item.sectionId)));
  const sections = sectionIds.length
    ? await prisma.diagnosticTemplateSection.findMany({
        where: { id: { in: sectionIds } },
        select: { id: true, code: true },
      })
    : [];
  const sectionCodeById = new Map(sections.map((section) => [section.id, section.code]));
  const itemMetaById = new Map(templateItems.map((item) => [item.id, {
    isRequired: item.isRequired,
    sectionCode: sectionCodeById.get(item.sectionId) || "",
  }]));

  const required = checks.filter((item) => itemMetaById.get(item.templateItemId)?.isRequired !== false);
  const optional = checks.filter((item) => itemMetaById.get(item.templateItemId)?.isRequired === false);
  const isChecked = (state: DiagnosticCheckState) => state !== DiagnosticCheckState.NOT_CHECKED;
  const requiredChecked = required.filter((item) => isChecked(item.state)).length;
  const optionalChecked = optional.filter((item) => isChecked(item.state)).length;
  // The mechanic records exceptions only. Every untouched applicable check is
  // confirmed as OK when the diagnostic is submitted, regardless of section.
  const requiredBlocking: typeof required = [];
  const autoFillRemaining = required.filter((item) => !isChecked(item.state)).length;

  return {
    canSubmit: requiredBlocking.length === 0,
    total: checks.length,
    checked: requiredChecked + optionalChecked,
    requiredTotal: required.length,
    requiredChecked,
    requiredRemaining: requiredBlocking.length,
    optionalTotal: optional.length,
    optionalRemaining: optional.length - optionalChecked,
    autoFillRemaining,
  };
}

async function markAutoFillChecksOk(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const inspectionIds = await effectiveInspectionIds(diagnosticRequestId);
  if (!inspectionIds.length) return 0;

  const result = await prisma.diagnosticCheck.updateMany({
    where: {
      inspectionId: { in: inspectionIds },
      state: DiagnosticCheckState.NOT_CHECKED,
    },
    data: {
      state: DiagnosticCheckState.OK,
      checkedAt: new Date(),
    },
  });
  return result.count;
}

export async function submitStructuredDiagnosticRespectingOptional(
  userId: string,
  diagnosticRequestId: string,
  mechanicComment?: string | null,
) {
  const prisma = getPrisma();
  const view = await getStructuredDiagnosticForMechanic(userId, diagnosticRequestId);
  if (view.diagnostic.status === DiagnosticRequestStatus.CONFIRMED || view.diagnostic.status === DiagnosticRequestStatus.CANCELLED) {
    throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Ця діагностика вже закрита.", 409);
  }
  if (view.diagnostic.review.state === DiagnosticReviewState.CONFIRMED) {
    throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Діагностичну карту вже підтверджено.", 409);
  }
  if (view.diagnostic.review.state === DiagnosticReviewState.SUBMITTED) {
    const mechanic = await getMechanicByUserId(userId);
    await ensureDiagnosticCardReviewRevision(diagnosticRequestId, userId, mechanic.name);
    return getStructuredDiagnostic(diagnosticRequestId);
  }

  let completion = await getRequiredDiagnosticCompletion(diagnosticRequestId);
  if (!completion.canSubmit) {
    throw new StructuredDiagnosticError(
      "DIAGNOSTIC_INCOMPLETE",
      `Перед передачею сервіс-менеджеру перевірте всі обов’язкові пункти. Залишилось: ${completion.requiredRemaining}.`,
      409,
    );
  }

  const autoFilledCount = await markAutoFillChecksOk(diagnosticRequestId);
  completion = await getRequiredDiagnosticCompletion(diagnosticRequestId);
  if (!completion.canSubmit) {
    throw new StructuredDiagnosticError(
      "DIAGNOSTIC_INCOMPLETE",
      `Перед передачею сервіс-менеджеру перевірте всі обов’язкові пункти. Залишилось: ${completion.requiredRemaining}.`,
      409,
    );
  }

  const mechanic = await getMechanicByUserId(userId);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.diagnosticInspection.updateMany({
      where: { diagnosticRequestId },
      data: { status: DiagnosticInspectionStatus.COMPLETED, completedAt: now },
    });
    await tx.diagnosticReview.upsert({
      where: { diagnosticRequestId },
      create: {
        diagnosticRequestId,
        state: DiagnosticReviewState.SUBMITTED,
        submittedAt: now,
        mechanicComment: mechanicComment?.trim().slice(0, 4000) || null,
      },
      update: {
        state: DiagnosticReviewState.SUBMITTED,
        submittedAt: now,
        returnedAt: null,
        mechanicComment: mechanicComment?.trim().slice(0, 4000) || null,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorName: mechanic.name,
        entityType: "DiagnosticRequest",
        entityId: diagnosticRequestId,
        action: "DIAGNOSTIC_SUBMITTED",
        metadata: toPrismaJson({
          source: "MECHANIC_MOBILE",
          counts: view.counts,
          requiredCompletion: completion,
          autoFilledCount,
        }),
      },
    });
  });

  await ensureDiagnosticCardReviewRevision(diagnosticRequestId, userId, mechanic.name);
  return getStructuredDiagnostic(diagnosticRequestId);
}
