import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { importDiagnosticRecommendationsToEstimate } from "@/src/services/diagnostic-commercial-handoff.service";
import { ensureEstimateSnapshotTx, ensurePartsRequestTx } from "@/src/services/work-order-commercial.service";
import { createWorkOrderFromConfirmedDiagnostic } from "@/src/services/work-orders.service";
import { getFinalDiagnosticCardSnapshot } from "@/src/services/diagnostic-card.service";

export class DiagnosticCommercialProposalError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "DiagnosticCommercialProposalError";
    this.code = code;
    this.status = status;
  }
}

export async function createCommercialProposalFromDiagnostic(
  diagnosticRequestId: string,
  actorName = "CRM / Сервіс-менеджер",
  actorId: string | null = null,
) {
  const card = await getFinalDiagnosticCardSnapshot(diagnosticRequestId);
  if (!card || card.revisionKind !== "FINAL") {
    throw new DiagnosticCommercialProposalError(
      "DIAGNOSTIC_CARD_REQUIRED",
      "Комерційну пропозицію можна створити лише після підтвердження Діагностичної карти.",
      409,
    );
  }

  const workOrder = await createWorkOrderFromConfirmedDiagnostic(diagnosticRequestId);
  const handoff = await importDiagnosticRecommendationsToEstimate(diagnosticRequestId, actorName);
  if (!handoff.counts.total) {
    throw new DiagnosticCommercialProposalError(
      "NO_DIAGNOSTIC_RECOMMENDATIONS",
      "У підтвердженій Діагностичній карті немає рекомендованих робіт або деталей для Комерційної пропозиції.",
      409,
    );
  }

  const prisma = getPrisma();
  const commercial = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`diagnostic-commercial-proposal:${diagnosticRequestId}`}))`;
    const estimateState = await ensureEstimateSnapshotTx(tx, workOrder.id, { actorName });
    const partsRequest = handoff.counts.parts > 0
      ? await ensurePartsRequestTx(tx, workOrder.id, `${actorName} / Підбір запчастин`)
      : null;

    await tx.auditEvent.create({
      data: {
        actorId,
        actorName,
        entityType: "WorkOrderEstimate",
        entityId: estimateState.estimate.id,
        action: "COMMERCIAL_PROPOSAL_CREATED_FROM_DIAGNOSTIC_CARD",
        metadata: toPrismaJson({
          diagnosticRequestId,
          diagnosticCardNumber: card.cardNumber,
          workOrderId: workOrder.id,
          estimateId: estimateState.estimate.id,
          estimateRevision: estimateState.estimate.revision,
          partsRequestId: partsRequest?.id || null,
          importedRecommendations: handoff.createdCount || 0,
          totalRecommendations: handoff.counts.total,
        }),
      },
    });

    return { estimate: estimateState.estimate, partsRequest };
  });

  return {
    diagnosticCard: { number: card.cardNumber, generatedAt: card.generatedAt },
    workOrder,
    handoff,
    estimate: commercial.estimate,
    partsRequest: commercial.partsRequest,
  };
}
