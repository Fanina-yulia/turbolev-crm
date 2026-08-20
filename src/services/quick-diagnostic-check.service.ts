import {
  DiagnosticCheckState,
  DiagnosticFindingAction,
  DiagnosticReviewState,
  DiagnosticUrgency,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

type QuickCheckInput = {
  state: string;
  measurementValue?: string | number | null;
  measurementText?: string | null;
  note?: string | null;
  action?: string | null;
  urgency?: string | null;
  findingText?: string | null;
};

/**
 * Fast persistence path for the mechanic's tap-first chassis matrix.
 * It validates assignment/lock state and persists only the touched check,
 * intentionally avoiding rebuilding the whole structured diagnostic payload.
 */
export async function updateQuickDiagnosticCheck(
  userId: string,
  diagnosticRequestId: string,
  checkId: string,
  input: QuickCheckInput,
) {
  const prisma = getPrisma();

  const mechanic = await prisma.serviceMechanic.findFirst({
    where: { userId, isActive: true },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!mechanic) {
    throw new StructuredDiagnosticError(
      "MECHANIC_NOT_LINKED",
      "Профіль користувача не прив’язаний до ресурсу автомеханіка.",
      403,
    );
  }

  const [assignment, review] = await Promise.all([
    prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId } }),
    prisma.diagnosticReview.findUnique({ where: { diagnosticRequestId } }),
  ]);
  if (!assignment || assignment.mechanicId !== mechanic.id) {
    throw new StructuredDiagnosticError(
      "DIAGNOSTIC_NOT_ASSIGNED",
      "Ця діагностика не призначена цьому автомеханіку.",
      403,
    );
  }
  if (review?.state === DiagnosticReviewState.SUBMITTED || review?.state === DiagnosticReviewState.CONFIRMED) {
    throw new StructuredDiagnosticError(
      "DIAGNOSTIC_LOCKED",
      "Діагностика вже передана на перевірку.",
      409,
    );
  }

  const state = Object.values(DiagnosticCheckState).find(
    (value) => value === String(input.state || "").toUpperCase(),
  );
  if (!state) {
    throw new StructuredDiagnosticError("INVALID_CHECK_STATE", "Оберіть коректний стан перевірки.");
  }

  const check = await prisma.diagnosticCheck.findUnique({ where: { id: checkId } });
  if (!check) throw new StructuredDiagnosticError("CHECK_NOT_FOUND", "Пункт перевірки не знайдено.", 404);

  const [inspection, item] = await Promise.all([
    prisma.diagnosticInspection.findUnique({ where: { id: check.inspectionId } }),
    prisma.diagnosticTemplateItem.findUnique({ where: { id: check.templateItemId } }),
  ]);
  if (!inspection || inspection.diagnosticRequestId !== diagnosticRequestId) {
    throw new StructuredDiagnosticError(
      "CHECK_SCOPE_MISMATCH",
      "Пункт не належить цій діагностиці.",
      403,
    );
  }

  const measurementValue = input.measurementValue === "" || input.measurementValue == null
    ? null
    : Number(input.measurementValue);
  if (measurementValue !== null && !Number.isFinite(measurementValue)) {
    throw new StructuredDiagnosticError("INVALID_MEASUREMENT", "Вкажіть коректний числовий замір.");
  }

  const action = Object.values(DiagnosticFindingAction).find(
    (value) => value === String(input.action || "NONE").toUpperCase(),
  ) || DiagnosticFindingAction.NONE;
  const urgency = Object.values(DiagnosticUrgency).find(
    (value) => value === String(input.urgency || "INFO").toUpperCase(),
  ) || DiagnosticUrgency.INFO;

  await prisma.$transaction(async (tx) => {
    await tx.diagnosticCheck.update({
      where: { id: checkId },
      data: {
        state,
        measurementValue,
        measurementText: typeof input.measurementText === "string"
          ? input.measurementText.trim().slice(0, 160) || null
          : null,
        note: typeof input.note === "string" ? input.note.trim().slice(0, 4000) || null : null,
        checkedAt: state === DiagnosticCheckState.NOT_CHECKED ? null : new Date(),
      },
    });

    const problem = state === DiagnosticCheckState.ATTENTION || state === DiagnosticCheckState.DEFECT;
    if (problem) {
      await tx.diagnosticFinding.upsert({
        where: { checkId },
        create: {
          checkId,
          action,
          urgency,
          findingText: typeof input.findingText === "string"
            ? input.findingText.trim().slice(0, 4000) || null
            : null,
          suggestedWorkName: item?.suggestedWorkName || null,
          suggestedPartName: item?.suggestedPartName || null,
        },
        update: {
          action,
          urgency,
          findingText: typeof input.findingText === "string"
            ? input.findingText.trim().slice(0, 4000) || null
            : null,
          suggestedWorkName: item?.suggestedWorkName || undefined,
          suggestedPartName: item?.suggestedPartName || undefined,
        },
      });
    } else {
      const finding = await tx.diagnosticFinding.findUnique({ where: { checkId } });
      if (finding) {
        await tx.diagnosticMedia.deleteMany({ where: { findingId: finding.id } });
        await tx.diagnosticFinding.delete({ where: { id: finding.id } });
      }
    }
  });

  return {
    saved: true,
    check: { id: checkId, state },
  };
}
