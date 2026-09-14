import { createHash } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";
import { createCatalogChange, recordSearchFeedback } from "@/src/services/part-catalog-intelligence.service";

export type SelectionKnowledgeResultType = "ORIGINAL" | "OEM_REPLACEMENT" | "ANALOG" | "ASSEMBLY" | "UNKNOWN";
export type SelectionKnowledgeCompatibility = "CONFIRMED" | "PARTIAL" | "REVIEW_REQUIRED" | "UNCONFIRMED";

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeResultType(value: unknown): SelectionKnowledgeResultType {
  const normalized = clean(value, 32).toUpperCase();
  return (["ORIGINAL", "OEM_REPLACEMENT", "ANALOG", "ASSEMBLY", "UNKNOWN"] as const).includes(normalized as SelectionKnowledgeResultType)
    ? normalized as SelectionKnowledgeResultType
    : "UNKNOWN";
}

function normalizeCompatibility(value: unknown): SelectionKnowledgeCompatibility {
  const normalized = clean(value, 32).toUpperCase();
  return (["CONFIRMED", "PARTIAL", "REVIEW_REQUIRED", "UNCONFIRMED"] as const).includes(normalized as SelectionKnowledgeCompatibility)
    ? normalized as SelectionKnowledgeCompatibility
    : "UNCONFIRMED";
}

function candidateId(parts: Array<string | null | undefined>) {
  return createHash("sha256").update(parts.map((value) => clean(value, 240)).join("\u001f")).digest("hex").slice(0, 64);
}

export async function recordPartSelectionKnowledge(input: {
  genericArticleId?: string | null;
  vehicleId?: string | null;
  diagnosticId: string;
  query: string;
  provider?: string | null;
  selectedArticle?: string | null;
  selectedBrand?: string | null;
  resultType?: string | null;
  compatibilityTier?: string | null;
  sourceKind?: string | null;
  offerReason?: string | null;
  matchReasons?: string[] | null;
  manualConfirmation?: boolean;
  fitmentStatus?: string | null;
  fitmentExact?: boolean | null;
  createdByUserId?: string | null;
  createdByName?: string | null;
}) {
  const prisma = getPrisma();
  const genericArticleId = clean(input.genericArticleId, 160) || null;
  const provider = clean(input.provider, 64) || null;
  const selectedArticle = clean(input.selectedArticle, 180) || null;
  const selectedBrand = clean(input.selectedBrand, 120) || null;
  const resultType = normalizeResultType(input.resultType);
  const compatibilityTier = normalizeCompatibility(input.compatibilityTier);
  const actorId = clean(input.createdByUserId, 128) || null;
  const actorName = clean(input.createdByName, 160) || null;
  const manualConfirmation = input.manualConfirmation === true;
  const reasons = [...new Set((input.matchReasons || []).map((value) => clean(value, 320)).filter(Boolean))].slice(0, 12);
  const reason = clean(input.offerReason, 1200) || reasons.join("; ") || null;

  const feedback = await recordSearchFeedback({
    genericArticleId,
    vehicleId: clean(input.vehicleId, 160) || null,
    query: clean(input.query, 240) || selectedArticle || "Вибрана деталь",
    provider,
    selectedArticle,
    selectedBrand,
    resultStatus: resultType === "ASSEMBLY" ? "ASSEMBLY_SELECTED" : "SELECTED",
    reason,
    metadata: {
      diagnosticId: clean(input.diagnosticId, 160),
      resultType,
      compatibilityTier,
      sourceKind: clean(input.sourceKind, 32) || null,
      manualConfirmation,
      fitmentStatus: clean(input.fitmentStatus, 40) || null,
      fitmentExact: input.fitmentExact ?? null,
      matchReasons: reasons,
    },
    createdByUserId: actorId,
    createdByName: actorName,
  });

  if (!genericArticleId || !provider || !selectedArticle) {
    return { feedbackId: feedback.id, stagedChangeId: null, staged: false };
  }

  const entityType = resultType === "ASSEMBLY"
    ? "SupplierAssemblyAlternative"
    : "GenericArticleExternalReferenceCandidate";
  const action = resultType === "ASSEMBLY"
    ? "PROPOSE_ASSEMBLY_ALTERNATIVE"
    : "PROPOSE_SUPPLIER_REFERENCE";
  const entityId = candidateId([genericArticleId, provider, selectedArticle, selectedBrand, resultType]);

  if (resultType !== "ASSEMBLY") {
    const knownReference = await prisma.genericArticleExternalReference.findFirst({
      where: {
        genericArticleId,
        provider,
        externalId: selectedArticle,
      },
      select: { id: true },
    });
    if (knownReference) return { feedbackId: feedback.id, stagedChangeId: null, staged: false };
  }

  const existing = await prisma.partCatalogChange.findFirst({
    where: {
      genericArticleId,
      entityType,
      entityId,
      action,
      status: "PENDING",
    },
    select: { id: true },
  });
  if (existing) return { feedbackId: feedback.id, stagedChangeId: existing.id, staged: false };

  const change = await createCatalogChange({
    entityType,
    entityId,
    action,
    genericArticleId,
    afterData: {
      provider,
      externalType: resultType === "ASSEMBLY" ? "SUPPLIER_ASSEMBLY_ALTERNATIVE" : "SUPPLIER_ARTICLE",
      externalId: selectedArticle,
      article: selectedArticle,
      brand: selectedBrand,
      resultType,
      compatibilityTier,
      sourceKind: clean(input.sourceKind, 32) || null,
      manualConfirmation,
      fitmentStatus: clean(input.fitmentStatus, 40) || null,
      fitmentExact: input.fitmentExact ?? null,
      matchReasons: reasons,
      diagnosticId: clean(input.diagnosticId, 160),
    },
    reason: resultType === "ASSEMBLY"
      ? "Комплектну альтернативу вибрано менеджером вручну. Створено кандидат на перевірку; автоматичної еквівалентності з компонентом немає."
      : "Постачальницький артикул був фактично вибраний у підборі. Створено кандидат на перевірку перед додаванням до активного knowledge-каталогу.",
    requestedByUserId: actorId,
    requestedByName: actorName,
  });

  return { feedbackId: feedback.id, stagedChangeId: change.id, staged: true };
}
