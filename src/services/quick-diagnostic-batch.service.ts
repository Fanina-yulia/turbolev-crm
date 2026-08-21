import { DiagnosticCheckState, DiagnosticReviewState } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { getRequiredDiagnosticCompletion } from "@/src/services/diagnostic-completeness.service";
import { StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

type BatchUpdate = {
  checkId: string;
  state: "OK";
};

/**
 * Persists the mechanic matrix's bulk "normal" operation in one authorization
 * scope and one database transaction instead of N independent check mutations.
 */
export async function updateQuickDiagnosticChecksBatch(
  userId: string,
  diagnosticRequestId: string,
  updates: BatchUpdate[],
) {
  const prisma = getPrisma();
  const uniqueIds = Array.from(new Set(updates.map((item) => item.checkId).filter(Boolean)));
  if (!uniqueIds.length) {
    throw new StructuredDiagnosticError("CHECKS_REQUIRED", "Не передано пункти діагностики.", 400);
  }
  if (uniqueIds.length > 100) {
    throw new StructuredDiagnosticError("TOO_MANY_CHECKS", "За один раз можна зберегти не більше 100 пунктів.", 400);
  }

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

  const [assignment, review, checks] = await Promise.all([
    prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId } }),
    prisma.diagnosticReview.findUnique({ where: { diagnosticRequestId } }),
    prisma.diagnosticCheck.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, inspectionId: true },
    }),
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
  if (checks.length !== uniqueIds.length) {
    throw new StructuredDiagnosticError("CHECK_NOT_FOUND", "Один або кілька пунктів перевірки не знайдено.", 404);
  }

  const inspectionIds = Array.from(new Set(checks.map((item) => item.inspectionId)));
  const inspections = await prisma.diagnosticInspection.findMany({
    where: { id: { in: inspectionIds } },
    select: { id: true, diagnosticRequestId: true },
  });
  if (inspections.length !== inspectionIds.length || inspections.some((item) => item.diagnosticRequestId !== diagnosticRequestId)) {
    throw new StructuredDiagnosticError(
      "CHECK_SCOPE_MISMATCH",
      "Один або кілька пунктів не належать цій діагностиці.",
      403,
    );
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const findings = await tx.diagnosticFinding.findMany({
      where: { checkId: { in: uniqueIds } },
      select: { id: true },
    });
    if (findings.length) {
      await tx.diagnosticMedia.deleteMany({ where: { findingId: { in: findings.map((item) => item.id) } } });
      await tx.diagnosticFinding.deleteMany({ where: { checkId: { in: uniqueIds } } });
    }
    await tx.diagnosticCheck.updateMany({
      where: { id: { in: uniqueIds } },
      data: { state: DiagnosticCheckState.OK, checkedAt: now },
    });
  });

  const completion = await getRequiredDiagnosticCompletion(diagnosticRequestId);
  return {
    saved: true,
    updatedIds: uniqueIds,
    state: DiagnosticCheckState.OK,
    canSubmit: completion.canSubmit,
    completion,
  };
}
