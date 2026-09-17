import type { SupplierOffer, SupplierResultType } from "@/src/services/suppliers/types";

export type CandidateCompatibility = "CONFIRMED" | "SUPPORTED" | "REVIEW_REQUIRED";

export type PartCandidateV3 = {
  key: string;
  brand: string | null;
  article: string;
  name: string;
  resultType: SupplierResultType;
  compatibility: CandidateCompatibility;
  oeNumbers: string[];
  analogOfArticle: string | null;
  evidence: string[];
  offers: SupplierOffer[];
  bestOffer: SupplierOffer;
};

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeArticle(value: unknown) {
  return clean(value, 180).toLocaleUpperCase("uk-UA").replace(/[^A-ZА-ЯІЇЄҐ0-9]/giu, "");
}

function normalizeBrand(value: unknown) {
  return clean(value, 120).toLocaleUpperCase("uk-UA").replace(/[^A-ZА-ЯІЇЄҐ0-9]/giu, "");
}

function candidateKey(offer: SupplierOffer) {
  const article = normalizeArticle(offer.article);
  const brand = normalizeBrand(offer.brand);
  return `${brand || "UNKNOWN"}:${article || clean(offer.externalProductId || offer.name, 180)}`;
}

function compatibility(offer: SupplierOffer): CandidateCompatibility {
  if (offer.compatibilityTier === "CONFIRMED") return "CONFIRMED";
  if (offer.compatibilityTier === "PARTIAL") return "SUPPORTED";
  return "REVIEW_REQUIRED";
}

function compatibilityRank(value: CandidateCompatibility) {
  if (value === "CONFIRMED") return 3;
  if (value === "SUPPORTED") return 2;
  return 1;
}

function typeRank(value: SupplierResultType) {
  if (value === "ORIGINAL") return 5;
  if (value === "OEM_REPLACEMENT") return 4;
  if (value === "ANALOG") return 3;
  if (value === "ASSEMBLY") return 2;
  return 1;
}

function bestOffer(left: SupplierOffer, right: SupplierOffer) {
  const leftCompatibility = compatibilityRank(compatibility(left));
  const rightCompatibility = compatibilityRank(compatibility(right));
  if (leftCompatibility !== rightCompatibility) return leftCompatibility > rightCompatibility ? left : right;
  if (left.available !== right.available) return left.available ? left : right;
  if (left.purchasePrice == null && right.purchasePrice != null) return right;
  if (right.purchasePrice == null && left.purchasePrice != null) return left;
  if (left.purchasePrice != null && right.purchasePrice != null && left.purchasePrice !== right.purchasePrice) {
    return left.purchasePrice < right.purchasePrice ? left : right;
  }
  return left;
}

export function aggregatePartCandidates(offers: SupplierOffer[]): PartCandidateV3[] {
  const groups = new Map<string, SupplierOffer[]>();
  for (const offer of offers) {
    const key = candidateKey(offer);
    const rows = groups.get(key) || [];
    rows.push(offer);
    groups.set(key, rows);
  }

  const candidates: PartCandidateV3[] = [];
  for (const [key, rows] of groups.entries()) {
    const preferred = rows.reduce(bestOffer);
    const candidateCompatibility = rows
      .map(compatibility)
      .sort((a, b) => compatibilityRank(b) - compatibilityRank(a))[0] || "REVIEW_REQUIRED";
    const resultType = rows
      .map((offer) => offer.resultType || "UNKNOWN" as SupplierResultType)
      .sort((a, b) => typeRank(b) - typeRank(a))[0] || "UNKNOWN";
    const evidence = [...new Set(rows.flatMap((offer) => [
      offer.offerReason || "",
      offer.fitmentReason || "",
      ...(offer.matchReasons || []),
    ]).map((item) => item.trim()).filter(Boolean))].slice(0, 16);
    const oeNumbers = [...new Set(rows.flatMap((offer) => offer.oeNumbers || []).map((item) => item.trim()).filter(Boolean))];
    const analogOfArticle = rows.map((offer) => clean(offer.analogOfArticle, 180)).find(Boolean) || null;

    candidates.push({
      key,
      brand: preferred.brand,
      article: preferred.article,
      name: preferred.name,
      resultType,
      compatibility: candidateCompatibility,
      oeNumbers,
      analogOfArticle,
      evidence,
      offers: rows.sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        if (a.purchasePrice == null && b.purchasePrice == null) return 0;
        if (a.purchasePrice == null) return 1;
        if (b.purchasePrice == null) return -1;
        return a.purchasePrice - b.purchasePrice;
      }),
      bestOffer: preferred,
    });
  }

  return candidates.sort((a, b) => {
    const compatibilityDiff = compatibilityRank(b.compatibility) - compatibilityRank(a.compatibility);
    if (compatibilityDiff) return compatibilityDiff;
    const typeDiff = typeRank(b.resultType) - typeRank(a.resultType);
    if (typeDiff) return typeDiff;
    if (a.bestOffer.available !== b.bestOffer.available) return a.bestOffer.available ? -1 : 1;
    if (a.bestOffer.purchasePrice == null && b.bestOffer.purchasePrice == null) return 0;
    if (a.bestOffer.purchasePrice == null) return 1;
    if (b.bestOffer.purchasePrice == null) return -1;
    return a.bestOffer.purchasePrice - b.bestOffer.purchasePrice;
  });
}
