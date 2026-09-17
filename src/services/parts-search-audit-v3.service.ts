import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import type { StrictOfferDecision } from "@/src/services/part-offer-compatibility.service";
import type { PartSearchIntentV3 } from "@/src/services/part-search-intent-v3.service";
import type { SupplierOffer } from "@/src/services/suppliers/types";

export type PartSearchAuditDecisionInput = {
  offer: SupplierOffer;
  decision: StrictOfferDecision;
};

export async function createPartSearchRunV3(input: {
  intent: PartSearchIntentV3;
  query: string;
  evidenceDriven: boolean;
  metadata?: unknown;
}) {
  try {
    const prisma = getPrisma();
    const run = await prisma.partSearchRun.create({
      data: {
        vehicleId: input.intent.vehicle.vehicleId,
        vin: input.intent.vehicle.vin,
        plate: input.intent.vehicle.plate,
        query: input.query.slice(0, 240),
        canonicalCode: input.intent.part.canonicalCode,
        axis: input.intent.part.axis,
        side: input.intent.part.side,
        algorithmVersion: input.intent.algorithm,
        evidenceDriven: input.evidenceDriven,
        metadata: input.metadata == null ? undefined : toPrismaJson(input.metadata),
      },
      select: { id: true, startedAt: true },
    });
    return run;
  } catch (error) {
    console.warn("Parts Search V3 audit run could not be created", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

export async function completePartSearchRunV3(input: {
  runId?: string | null;
  startedAtMs: number;
  rawOfferCount: number;
  acceptedCount: number;
  rejectedCount: number;
  decisions?: PartSearchAuditDecisionInput[];
  metadata?: unknown;
}) {
  if (!input.runId) return;
  try {
    const prisma = getPrisma();
    const decisions = (input.decisions || []).slice(0, 250);
    await prisma.$transaction(async (tx) => {
      if (decisions.length) {
        await tx.partSearchDecision.createMany({
          data: decisions.map(({ offer, decision }) => ({
            searchRunId: input.runId!,
            supplierId: offer.supplierId,
            externalProductId: offer.externalProductId,
            brand: offer.brand,
            article: offer.article || null,
            name: (offer.name || "Запчастина").slice(0, 320),
            detectedCanonicalCode: decision.detectedCanonicalCode,
            decision: decision.rejected ? "REJECT" : decision.evidence === "REVIEW" ? "REVIEW" : "ACCEPT",
            evidenceTier: decision.evidence,
            reasonCode: decision.rejectCode,
            reason: decision.reason,
            score: decision.score,
            metadata: toPrismaJson({
              resultType: offer.resultType || null,
              compatibilityTier: offer.compatibilityTier || null,
              sourceKind: offer.sourceKind || null,
              analogOfArticle: offer.analogOfArticle || null,
              vehicleMatch: offer.vehicleMatch || null,
              matchReasons: offer.matchReasons || [],
              detectedCanonicalCodes: decision.detectedCanonicalCodes,
            }),
          })),
        });
      }
      await tx.partSearchRun.update({
        where: { id: input.runId! },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          totalDurationMs: Math.max(0, Date.now() - input.startedAtMs),
          rawOfferCount: Math.max(0, input.rawOfferCount),
          acceptedCount: Math.max(0, input.acceptedCount),
          rejectedCount: Math.max(0, input.rejectedCount),
          metadata: input.metadata == null ? undefined : toPrismaJson(input.metadata),
        },
      });
    });
  } catch (error) {
    console.warn("Parts Search V3 audit completion failed", error instanceof Error ? error.message : "unknown error");
  }
}

export async function failPartSearchRunV3(runId: string | null | undefined, startedAtMs: number, error: unknown) {
  if (!runId) return;
  try {
    const prisma = getPrisma();
    await prisma.partSearchRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        totalDurationMs: Math.max(0, Date.now() - startedAtMs),
        metadata: toPrismaJson({ error: error instanceof Error ? error.message : String(error || "unknown error") }),
      },
    });
  } catch (auditError) {
    console.warn("Parts Search V3 failed-run audit could not be persisted", auditError instanceof Error ? auditError.message : "unknown error");
  }
}
