import "server-only";

import { DiagnosticReviewState } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

/**
 * Claims a completed diagnostic for the first service manager who opens it.
 * We intentionally keep DiagnosticReviewState.SUBMITTED for DB compatibility:
 * reviewerUserId distinguishes "Завершена діагностика" from
 * "На перевірці менеджера" without a risky enum migration.
 */
export async function claimDiagnosticManagerReview(diagnosticRequestId: string, reviewerUserId: string, reviewerName?: string | null) {
  const prisma = getPrisma();
  const review = await prisma.diagnosticReview.findUnique({ where: { diagnosticRequestId } });
  if (!review || review.state !== DiagnosticReviewState.SUBMITTED || review.reviewerUserId) return review;

  const updated = await prisma.diagnosticReview.updateMany({
    where: {
      diagnosticRequestId,
      state: DiagnosticReviewState.SUBMITTED,
      reviewerUserId: null,
    },
    data: { reviewerUserId },
  });

  if (updated.count) {
    await prisma.auditEvent.create({
      data: {
        actorId: reviewerUserId,
        actorName: reviewerName?.trim() || "CRM / Сервіс-менеджер",
        entityType: "DiagnosticRequest",
        entityId: diagnosticRequestId,
        action: "DIAGNOSTIC_MANAGER_REVIEW_STARTED",
        metadata: toPrismaJson({ reviewerUserId }),
      },
    }).catch(() => undefined);
  }

  return prisma.diagnosticReview.findUnique({ where: { diagnosticRequestId } });
}
