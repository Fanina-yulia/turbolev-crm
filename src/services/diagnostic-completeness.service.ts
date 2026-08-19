import {
  DiagnosticCheckState,
  DiagnosticInspectionStatus,
  DiagnosticRequestStatus,
  DiagnosticReviewState,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
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
};

export async function getRequiredDiagnosticCompletion(diagnosticRequestId: string): Promise<DiagnosticCompletion> {
  const prisma = getPrisma();
  const inspections = await prisma.diagnosticInspection.findMany({
    where: { diagnosticRequestId },
    select: { id: true },
  });
  if (!inspections.length) {
    return { canSubmit: false, total: 0, checked: 0, requiredTotal: 0, requiredChecked: 0, requiredRemaining: 0, optionalTotal: 0, optionalRemaining: 0 };
  }

  const checks = await prisma.diagnosticCheck.findMany({
    where: { inspectionId: { in: inspections.map((item) => item.id) } },
    select: { templateItemId: true, state: true },
  });
  if (!checks.length) {
    return { canSubmit: false, total: 0, checked: 0, requiredTotal: 0, requiredChecked: 0, requiredRemaining: 0, optionalTotal: 0, optionalRemaining: 0 };
  }

  const templateItems = await prisma.diagnosticTemplateItem.findMany({
    where: { id: { in: Array.from(new Set(checks.map((item) => item.templateItemId))) } },
    select: { id: true, isRequired: true },
  });
  const requiredById = new Map(templateItems.map((item) => [item.id, item.isRequired]));
  const required = checks.filter((item) => requiredById.get(item.templateItemId) !== false);
  const optional = checks.filter((item) => requiredById.get(item.templateItemId) === false);
  const isChecked = (state: DiagnosticCheckState) => state !== DiagnosticCheckState.NOT_CHECKED;
  const requiredChecked = required.filter((item) => isChecked(item.state)).length;
  const optionalChecked = optional.filter((item) => isChecked(item.state)).length;

  return {
    canSubmit: required.every((item) => isChecked(item.state)),
    total: checks.length,
    checked: requiredChecked + optionalChecked,
    requiredTotal: required.length,
    requiredChecked,
    requiredRemaining: required.length - requiredChecked,
    optionalTotal: optional.length,
    optionalRemaining: optional.length - optionalChecked,
  };
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
  if (view.diagnostic.review.state === DiagnosticReviewState.SUBMITTED || view.diagnostic.review.state === DiagnosticReviewState.CONFIRMED) {
    throw new StructuredDiagnosticError("DIAGNOSTIC_LOCKED", "Діагностика вже передана на перевірку.", 409);
  }

  const completion = await getRequiredDiagnosticCompletion(diagnosticRequestId);
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
        }),
      },
    });
  });

  return getStructuredDiagnostic(diagnosticRequestId);
}
