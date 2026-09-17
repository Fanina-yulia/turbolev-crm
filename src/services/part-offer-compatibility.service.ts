import type { SupplierCompatibilityTier, SupplierOffer } from "@/src/services/suppliers/types";
import { normalizeSearchAxis } from "@/src/services/parts-oe-evidence.service";
import {
  detectOfferAxis,
  detectOfferSide,
  evaluatePartFamily,
  evaluateVehicleMakeEvidence,
} from "@/src/services/part-family-policy.service";
import { resolvePositionPolicyV3 } from "@/src/services/part-search-intent-v3.service";

export type StrictOfferEvidence = "EXACT_OE" | "CATALOG_CROSS" | "MODEL_MATCH" | "REVIEW";
export type StrictRejectCode =
  | "PART_FAMILY_CONFLICT"
  | "AXIS_CONFLICT"
  | "SIDE_CONFLICT"
  | "VEHICLE_MAKE_CONFLICT"
  | "VEHICLE_MODEL_CONFLICT"
  | "YEAR_CONFLICT"
  | "ENGINE_CONFLICT"
  | "OE_CONFLICT"
  | "KNOWN_REJECTED_MATCH";

export type StrictOfferContext = {
  query?: string | null;
  partName?: string | null;
  canonicalCode?: string | null;
  axis?: string | null;
  side?: string | null;
  position?: string | null;
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: number | null;
  fitmentConfirmed?: boolean | null;
  fitmentExact?: boolean | null;
  oeNumbers?: string[];
  curatedOeNumbers?: string[];
  catalogArticles?: string[];
  analogArticles?: string[];
  knownRejectedArticles?: string[];
};

export type StrictOfferDecision = {
  accepted: boolean;
  rejected: boolean;
  rejectCode: StrictRejectCode | null;
  evidence: StrictOfferEvidence;
  compatibilityTier: SupplierCompatibilityTier;
  score: number;
  reason: string;
  detectedCanonicalCode: string | null;
  detectedCanonicalCodes: string[];
};

function clean(value: unknown, max = 360) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeArticle(value: unknown) {
  return clean(value, 180).toUpperCase().replace(/[^A-ZА-ЯІЇЄҐ0-9]/giu, "");
}

function normalizeText(value: unknown) {
  return clean(value)
    .toLocaleUpperCase("uk-UA")
    .replace(/[’'`]/g, "")
    .replace(/[‐‑‒–—-]+/g, " ")
    .replace(/[^A-ZА-ЯІЇЄҐ0-9 ]/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function setOf(values: string[] | undefined) {
  return new Set((values || []).map(normalizeArticle).filter(Boolean));
}

function offerNumberSet(offer: SupplierOffer) {
  return new Set([
    normalizeArticle(offer.article),
    ...(offer.oeNumbers || []).map(normalizeArticle),
  ].filter(Boolean));
}

function intersects(left: Set<string>, right: Set<string>) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function emptyDetected(family: ReturnType<typeof evaluatePartFamily>) {
  return {
    detectedCanonicalCode: family.matchedCanonicalCode,
    detectedCanonicalCodes: family.detectedCanonicalCodes,
  };
}

function rejected(
  family: ReturnType<typeof evaluatePartFamily>,
  rejectCode: StrictRejectCode,
  reason: string,
  score: number,
): StrictOfferDecision {
  return {
    accepted: false,
    rejected: true,
    rejectCode,
    evidence: "REVIEW",
    compatibilityTier: "UNCONFIRMED",
    score,
    reason,
    ...emptyDetected(family),
  };
}

function vehicleModelMatch(offer: SupplierOffer, context: StrictOfferContext) {
  const model = normalizeText(context.vehicleModel)
    .replace(/\bEX7\b/gu, "X7")
    .replace(/\bEMGRAND\s+EX7\b/gu, "EMGRAND X7");
  if (!model) return false;
  const source = normalizeText(`${offer.vehicleMatch || ""} ${offer.name || ""}`)
    .replace(/\bEX7\b/gu, "X7")
    .replace(/\bEMGRAND\s+EX7\b/gu, "EMGRAND X7");
  if (!source) return false;
  const usefulTokens = model.split(" ").filter((token) => token.length >= 2);
  return usefulTokens.length > 0 && usefulTokens.every((token) => source.includes(token));
}

export function evaluateStrictOffer(offer: SupplierOffer, context: StrictOfferContext): StrictOfferDecision {
  const family = evaluatePartFamily(offer, context.canonicalCode);

  // V3 invariant: an explicit canonical-family contradiction can never be
  // rescued by price, supplier ranking or a manual checkbox.
  if (family.conflict) {
    return rejected(family, "PART_FAMILY_CONFLICT", `Позиція відхилена: ${family.reason}`, -1400);
  }

  const titleEvidence = `${offer.name || ""} ${offer.vehicleMatch || ""}`;
  const requestedAxis = normalizeSearchAxis(context.axis)
    || normalizeSearchAxis(context.position)
    || normalizeSearchAxis(context.partName)
    || normalizeSearchAxis(context.query);
  const offeredAxis = detectOfferAxis(titleEvidence);
  if (requestedAxis && offeredAxis && requestedAxis !== offeredAxis) {
    return rejected(
      family,
      "AXIS_CONFLICT",
      `Позиція відхилена: запит ${requestedAxis}, а товар явно позначений як ${offeredAxis}.`,
      -1300,
    );
  }

  const positionPolicy = resolvePositionPolicyV3({
    canonicalCode: context.canonicalCode,
    partName: context.partName || context.query,
    axis: context.axis,
    side: context.side,
    position: context.position,
  });
  const requestedSide = positionPolicy.side;
  const offeredSide = detectOfferSide(titleEvidence);
  if (positionPolicy.sideSensitive && requestedSide && offeredSide && requestedSide !== offeredSide) {
    return rejected(
      family,
      "SIDE_CONFLICT",
      `Позиція відхилена: потрібна сторона ${requestedSide}, а товар явно позначений як ${offeredSide}.`,
      -1250,
    );
  }

  const makeEvidence = evaluateVehicleMakeEvidence(offer, context.vehicleBrand);
  if (makeEvidence.conflict) {
    return rejected(family, "VEHICLE_MAKE_CONFLICT", `Позиція відхилена: ${makeEvidence.reason}`, -1200);
  }

  const numbers = offerNumberSet(offer);
  const knownRejected = setOf(context.knownRejectedArticles);
  if (knownRejected.size && intersects(numbers, knownRejected)) {
    return rejected(
      family,
      "KNOWN_REJECTED_MATCH",
      "Позиція відхилена: цей артикул раніше підтверджено як несумісний для цієї canonical family.",
      -1500,
    );
  }

  const oeNumbers = setOf(context.oeNumbers);
  const curatedOeNumbers = setOf(context.curatedOeNumbers);
  const catalogArticles = setOf(context.catalogArticles);
  const analogArticles = setOf(context.analogArticles);
  const exactOe = intersects(numbers, oeNumbers);
  const curatedOe = intersects(numbers, curatedOeNumbers);
  const catalogCross = intersects(numbers, catalogArticles)
    || intersects(numbers, analogArticles)
    || Boolean(offer.analogOfArticle && (
      oeNumbers.has(normalizeArticle(offer.analogOfArticle))
      || catalogArticles.has(normalizeArticle(offer.analogOfArticle))
      || analogArticles.has(normalizeArticle(offer.analogOfArticle))
    ));

  if (exactOe || curatedOe) {
    const exact = context.fitmentConfirmed === true && context.fitmentExact !== false && !curatedOe;
    return {
      accepted: true,
      rejected: false,
      rejectCode: null,
      evidence: "EXACT_OE",
      compatibilityTier: exact ? "CONFIRMED" : "PARTIAL",
      score: exact ? 1100 : 1000,
      reason: exact
        ? "OE-номер підтверджений точним VIN/VehicleFitment evidence."
        : curatedOe
          ? "OE-номер підтверджений моделлю, роком і позицією; exact VIN-fitment ще не доведений."
          : "OE-номер збігається з каталогом автомобіля; точну модифікацію потрібно перевірити.",
      ...emptyDetected(family),
    };
  }

  if (catalogCross || (offer.sourceKind === "ANALOG" && Boolean(offer.analogOfArticle))) {
    return {
      accepted: true,
      rejected: false,
      rejectCode: null,
      evidence: "CATALOG_CROSS",
      compatibilityTier: context.fitmentConfirmed === true && context.fitmentExact !== false ? "CONFIRMED" : "PARTIAL",
      score: context.fitmentConfirmed === true && context.fitmentExact !== false ? 1000 : 900,
      reason: "Артикул отриманий через OE/cross-граф і пройшов family/vehicle/position guards.",
      ...emptyDetected(family),
    };
  }

  if (vehicleModelMatch(offer, context)) {
    return {
      accepted: true,
      rejected: false,
      rejectCode: null,
      evidence: "MODEL_MATCH",
      compatibilityTier: "PARTIAL",
      score: 700,
      reason: "Постачальник підтверджує модель автомобіля; exact VIN/OE доказ ще потрібен.",
      ...emptyDetected(family),
    };
  }

  return {
    accepted: true,
    rejected: false,
    rejectCode: null,
    evidence: "REVIEW",
    compatibilityTier: "REVIEW_REQUIRED",
    score: 100,
    reason: "Знайдено лише за назвою/артикулом без достатнього OE/cross/vehicle evidence.",
    ...emptyDetected(family),
  };
}

export function sanitizeSupplierOfferPrice(offer: SupplierOffer): SupplierOffer {
  if (offer.purchasePrice == null || offer.purchasePrice > 0) return offer;
  const note = "Постачальник повернув нульову/некоректну закупівельну ціну; ціну потрібно уточнити.";
  return {
    ...offer,
    purchasePrice: null,
    sellPrice: null,
    offerReason: [offer.offerReason, note].filter(Boolean).join(" "),
    matchReasons: [...new Set([...(offer.matchReasons || []), note])],
  };
}

export function applyStrictOfferPolicy(offer: SupplierOffer, context: StrictOfferContext) {
  const decision = evaluateStrictOffer(offer, context);
  if (decision.rejected) return { offer: null, decision };

  const sanitized = sanitizeSupplierOfferPrice(offer);
  const priceAvailable = sanitized.purchasePrice != null && sanitized.purchasePrice > 0;
  const availabilityBonus = sanitized.available ? 20 : 0;
  const priceBonus = priceAvailable ? 5 : 0;
  const reason = decision.reason;
  const patched: SupplierOffer = {
    ...sanitized,
    compatibilityTier: decision.compatibilityTier,
    requiresManualConfirmation: decision.compatibilityTier !== "CONFIRMED",
    fitmentStatus: decision.evidence === "REVIEW" ? (sanitized.fitmentStatus || "MANUAL_REQUIRED") : "VERIFIED",
    fitmentExact: decision.compatibilityTier === "CONFIRMED",
    fitmentReason: reason,
    offerReason: reason,
    matchReasons: [...new Set([...(sanitized.matchReasons || []), reason])],
  };

  return {
    offer: patched,
    decision: { ...decision, score: decision.score + availabilityBonus + priceBonus },
  };
}

export function compareStrictOffers(
  left: { offer: SupplierOffer; decision: StrictOfferDecision },
  right: { offer: SupplierOffer; decision: StrictOfferDecision },
) {
  const score = right.decision.score - left.decision.score;
  if (score) return score;
  if (left.offer.available !== right.offer.available) return left.offer.available ? -1 : 1;
  if (left.offer.purchasePrice == null && right.offer.purchasePrice == null) return 0;
  if (left.offer.purchasePrice == null) return 1;
  if (right.offer.purchasePrice == null) return -1;
  return left.offer.purchasePrice - right.offer.purchasePrice;
}
