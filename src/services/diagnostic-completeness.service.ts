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

const AUTO_OK_SECTION_CODES = new Set([
  "FRONT_SUSPENSION",
  "FRONT_STEERING",
  "FRONT_DRIVE",
  "FRONT_BRAKES",
  "REAR_SUSPENSION",
  "REAR_BRAKES",
  "AXLE_SEALS_FRONT",
  "AXLE_SEALS_REAR",
]);

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

export async function getRequiredDiagnosticCompletion(diagnosticRequestId: string): Promise<DiagnosticCompletion> {
  const prisma = getPrisma();
  const inspections = await prisma.diagnosticInspection.findMany({
    where: { diagnosticRequestId },
    select: { id: true },
  });
  if (!inspections.length) {
    return { canSubmit: false, total: 0, checked: 0, requiredTotal: 0, requiredChecked: 0, requiredRemaining: 0, optionalTotal: 0, optionalRemaining: 0, autoFillRemaining: 0 };
  }

  const checks = await prisma.diagnosticCheck.findMany({
    where: { inspectionId: { in: inspections.map((item) => item.id) } },
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
  const isAutoFill = (templateItemId: string) => AUTO_OK_SECTION_CODES.has(itemMetaById.get(templateItemId)?.sectionCode || "");
  const requiredChecked = required.filter((item) => isChecked(item.state)).length;
  const optionalChecked = optional.filter((item) => isChecked(item.state)).length;
  const requiredBlocking = required.filter((item) => !isChecked(item.state) && !isAutoFill(item.templateItemId));
  const autoFillRemaining = required.filter((item) => !isChecked(item.state) && isAutoFill(item.templateItemId)).length;

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
  const inspections = await prisma.diagnosticInspection.findMany({
    where: { diagnosticRequestId },
    select: { id: true },
  });
  if (!inspections.length) return 0;

  const sections = await prisma.diagnosticTemplateSection.findMany({
    where: { code: { in: Array.from(AUTO_OK_SECTION_CODES) } },
    select: { id: true },
  });
  if (!sections.length) return 0;

  const items = await prisma.diagnosticTemplateItem.findMany({
    where: { sectionId: { in: sections.map((section) => section.id) } },
    select: { id: true },
  });
  if (!items.length) return 0;

  const result = await prisma.diagnosticCheck.updateMany({
    where: {
      inspectionId: { in: inspections.map((inspection) => inspection.id) },
      templateItemId: { in: items.map((item) => item.id) },
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
