import { createHash } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { aggregatePartCandidates } from "@/src/services/parts-candidate-aggregator.service";
import {
  buildPartSearchIntentV3,
  PARTS_SEARCH_V3_ALGORITHM,
  type SearchSourceType,
} from "@/src/services/part-search-intent-v3.service";
import {
  completePartSearchRunV3,
  createPartSearchRunV3,
  failPartSearchRunV3,
} from "@/src/services/parts-search-audit-v3.service";
import {
  searchConfiguredSuppliersOeFirst,
  type OeFirstSupplierSearchContext,
} from "@/src/services/strict-parts-search.service";

export type PartsSearchV3Context = OeFirstSupplierSearchContext & {
  genericArticleId?: string | null;
  sourceType?: SearchSourceType;
  sourceId?: string | null;
  quantity?: number | null;
  vehicleGeneration?: string | null;
  engineCode?: string | null;
  engineVolume?: number | null;
  fuelType?: string | null;
  driveType?: string | null;
  bodyType?: string | null;
};

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function crossCandidateId(parts: Array<string | null | undefined>) {
  return createHash("sha256")
    .update(parts.map((value) => clean(value, 240)).join("\u001f"))
    .digest("hex")
    .slice(0, 64);
}

async function knownRejectedArticles(genericArticleId?: string | null) {
  const id = clean(genericArticleId, 160);
  if (!id) return [] as string[];
  try {
    const prisma = getPrisma();
    const rows = await prisma.partRejectedMatch.findMany({
      where: { genericArticleId: id, active: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { article: true },
    });
    return [...new Set(rows.map((row) => clean(row.article, 180)).filter(Boolean))];
  } catch (error) {
    console.warn("Parts V3 rejected-match knowledge unavailable", error instanceof Error ? error.message : "unknown error");
    return [];
  }
}

async function stageDiscoveredCrosses(input: {
  genericArticleId?: string | null;
  canonicalCode?: string | null;
  searchRunId?: string | null;
  offers: Awaited<ReturnType<typeof searchConfiguredSuppliersOeFirst>>["offers"];
}) {
  const genericArticleId = clean(input.genericArticleId, 160);
  if (!genericArticleId) return;
  const candidates = input.offers
    .filter((offer) => offer.resultType === "ANALOG" && offer.analogOfArticle && offer.compatibilityTier !== "REVIEW_REQUIRED")
    .slice(0, 20);
  if (!candidates.length) return;

  try {
    const prisma = getPrisma();
    for (const offer of candidates) {
      const entityId = crossCandidateId([
        genericArticleId,
        offer.supplierId,
        offer.analogOfArticle,
        offer.brand,
        offer.article,
      ]);
      const existing = await prisma.partCatalogChange.findFirst({
        where: {
          genericArticleId,
          entityType: "ProductCrossReferenceCandidate",
          entityId,
          action: "PROPOSE_SUPPLIER_CROSS",
          status: "PENDING",
        },
        select: { id: true },
      });
      if (existing) continue;
      await prisma.partCatalogChange.create({
        data: {
          genericArticleId,
          entityType: "ProductCrossReferenceCandidate",
          entityId,
          action: "PROPOSE_SUPPLIER_CROSS",
          status: "PENDING",
          afterData: toPrismaJson({
            provider: offer.supplierId,
            supplierName: offer.supplierName,
            canonicalCode: clean(input.canonicalCode, 80) || null,
            fromArticle: offer.analogOfArticle,
            toArticle: offer.article,
            toBrand: offer.brand,
            relationType: "ALTERNATIVE",
            compatibilityTier: offer.compatibilityTier || null,
            sourceKind: offer.sourceKind || null,
            searchRunId: input.searchRunId || null,
            matchReasons: offer.matchReasons || [],
          }),
          reason: "Evidence First V3 знайшов supplier cross/analog. Кандидат збережено як PENDING; автоматичної активації немає.",
        },
      });
    }
  } catch (error) {
    console.warn("Parts V3 cross staging unavailable", error instanceof Error ? error.message : "unknown error");
  }
}

export async function searchPartsV3(
  query: string,
  limitPerSupplier = 20,
  context: PartsSearchV3Context = {},
) {
  const startedAtMs = Date.now();
  const rejectedArticles = await knownRejectedArticles(context.genericArticleId);
  const intent = buildPartSearchIntentV3({
    query,
    partName: context.partName || query,
    genericArticleId: context.genericArticleId,
    canonicalCode: context.canonicalCode,
    axis: context.requestedAxis || context.axis,
    side: context.requestedSide || context.side,
    subPosition: context.subPosition,
    position: context.position,
    quantity: context.quantity,
    vehicleId: context.vehicleId,
    vin: context.vin,
    plate: context.plate,
    vehicleMake: context.vehicleBrand || context.providerVehicle?.brand,
    vehicleModel: context.vehicleModel || context.providerVehicle?.model,
    vehicleGeneration: context.vehicleGeneration,
    vehicleYear: context.vehicleYear,
    engineCode: context.engineCode,
    engineVolume: context.engineVolume,
    fuelType: context.fuelType,
    driveType: context.driveType,
    bodyType: context.bodyType,
    sourceType: context.sourceType,
    sourceId: context.sourceId,
  });

  const evidenceDriven = Boolean(
    (context.oeNumbers && context.oeNumbers.length)
    || (context.curatedOeNumbers && context.curatedOeNumbers.length)
    || (context.catalogArticles && context.catalogArticles.length)
    || (context.analogArticles && context.analogArticles.length),
  );
  const auditRun = await createPartSearchRunV3({
    intent,
    query,
    evidenceDriven,
    metadata: {
      fitmentStatus: context.fitmentStatus || null,
      fitmentExact: context.fitmentExact ?? null,
      genericArticleId: context.genericArticleId || null,
    },
  });

  try {
    const result = await searchConfiguredSuppliersOeFirst(query, limitPerSupplier, {
      ...context,
      canonicalCode: intent.part.canonicalCode,
      partName: intent.part.canonicalName,
      axis: intent.part.axis,
      requestedAxis: intent.part.axis,
      side: intent.part.side,
      requestedSide: intent.part.side,
      position: intent.part.position,
      knownRejectedArticles: [...new Set([...(context.knownRejectedArticles || []), ...rejectedArticles])],
    });
    const candidates = aggregatePartCandidates(result.offers);
    const acceptedCount = result.offers.length;
    const rejectedCount = result.strictSearch.rejectedCount;
    const rawOfferCount = result.auditDecisions.length;

    await stageDiscoveredCrosses({
      genericArticleId: context.genericArticleId,
      canonicalCode: intent.part.canonicalCode,
      searchRunId: auditRun?.id,
      offers: result.offers,
    });
    await completePartSearchRunV3({
      runId: auditRun?.id,
      startedAtMs,
      rawOfferCount,
      acceptedCount,
      rejectedCount,
      decisions: result.auditDecisions,
      metadata: {
        searchMode: result.searchMode,
        providers: result.providers,
        strictSearch: result.strictSearch,
        candidateCount: candidates.length,
      },
    });

    const { auditDecisions: _auditDecisions, ...safeResult } = result;
    return {
      ...safeResult,
      algorithm: PARTS_SEARCH_V3_ALGORITHM,
      searchId: auditRun?.id || null,
      intent,
      candidates,
      policy: {
        evidenceFirst: true,
        supplierIsCompatibilityAuthority: false,
        hardRejectsCannotBeManuallyOverridden: true,
        priceAfterCompatibility: true,
        fuzzyCanConfirm: false,
      },
      timings: {
        totalMs: Math.max(0, Date.now() - startedAtMs),
      },
    };
  } catch (error) {
    await failPartSearchRunV3(auditRun?.id, startedAtMs, error);
    throw error;
  }
}
