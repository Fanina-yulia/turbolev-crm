import type { SupplierCompatibilityTier, SupplierOffer } from "@/src/services/suppliers/types";
import { normalizeSearchAxis } from "@/src/services/parts-oe-evidence.service";

export type StrictOfferEvidence = "EXACT_OE" | "CATALOG_CROSS" | "MODEL_MATCH" | "REVIEW";
export type StrictRejectCode = "AXIS_CONFLICT" | "VEHICLE_CONFLICT" | "PART_FAMILY_CONFLICT";

export type StrictOfferContext = {
  query?: string | null;
  partName?: string | null;
  canonicalCode?: string | null;
  axis?: string | null;
  position?: string | null;
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
  fitmentConfirmed?: boolean | null;
  fitmentExact?: boolean | null;
  oeNumbers?: string[];
  curatedOeNumbers?: string[];
  catalogArticles?: string[];
  analogArticles?: string[];
};

export type StrictOfferDecision = {
  accepted: boolean;
  rejected: boolean;
  rejectCode: StrictRejectCode | null;
  evidence: StrictOfferEvidence;
  compatibilityTier: SupplierCompatibilityTier;
  score: number;
  reason: string;
};

const VEHICLE_MAKES: Array<{ canonical: string; aliases: RegExp[] }> = [
  { canonical: "GEELY", aliases: [/\bGEELY\b/iu, /\bДЖИЛ[ІИ]\b/iu] },
  { canonical: "AUDI", aliases: [/\bAUDI\b/iu] },
  { canonical: "VOLKSWAGEN", aliases: [/\bVOLKSWAGEN\b/iu, /\bVW\b/iu] },
  { canonical: "SKODA", aliases: [/\bSKODA\b/iu, /\bŠKODA\b/iu] },
  { canonical: "MERCEDES", aliases: [/\bMERCEDES(?:\s*BENZ)?\b/iu, /\bMB\b/iu, /\bSPRINTER\b/iu] },
  { canonical: "RENAULT", aliases: [/\bRENAULT\b/iu] },
  { canonical: "FIAT", aliases: [/\bFIAT\b/iu] },
  { canonical: "HYUNDAI", aliases: [/\bHYUNDAI\b/iu] },
  { canonical: "KIA", aliases: [/\bKIA\b/iu] },
  { canonical: "TOYOTA", aliases: [/\bTOYOTA\b/iu] },
  { canonical: "LEXUS", aliases: [/\bLEXUS\b/iu] },
  { canonical: "BMW", aliases: [/\bBMW\b/iu] },
  { canonical: "FORD", aliases: [/\bFORD\b/iu] },
  { canonical: "OPEL", aliases: [/\bOPEL\b/iu] },
  { canonical: "PEUGEOT", aliases: [/\bPEUGEOT\b/iu] },
  { canonical: "CITROEN", aliases: [/\bCITRO[EË]N\b/iu] },
  { canonical: "NISSAN", aliases: [/\bNISSAN\b/iu] },
  { canonical: "MITSUBISHI", aliases: [/\bMITSUBISHI\b/iu] },
  { canonical: "HONDA", aliases: [/\bHONDA\b/iu] },
  { canonical: "MAZDA", aliases: [/\bMAZDA\b/iu] },
  { canonical: "SUBARU", aliases: [/\bSUBARU\b/iu] },
  { canonical: "CHEVROLET", aliases: [/\bCHEVROLET\b/iu] },
  { canonical: "DAEWOO", aliases: [/\bDAEWOO\b/iu] },
  { canonical: "VOLVO", aliases: [/\bVOLVO\b/iu] },
  { canonical: "LAND ROVER", aliases: [/\bLAND\s+ROVER\b/iu] },
  { canonical: "JEEP", aliases: [/\bJEEP\b/iu] },
  { canonical: "DODGE", aliases: [/\bDODGE\b/iu] },
  { canonical: "CHERY", aliases: [/\bCHERY\b/iu] },
  { canonical: "GREAT WALL", aliases: [/\bGREAT\s+WALL\b/iu] },
  { canonical: "HAVAL", aliases: [/\bHAVAL\b/iu] },
  { canonical: "BYD", aliases: [/\bBYD\b/iu] },
  { canonical: "JAC", aliases: [/\bJAC\b/iu] },
  { canonical: "SUZUKI", aliases: [/\bSUZUKI\b/iu] },
  { canonical: "PORSCHE", aliases: [/\bPORSCHE\b/iu] },
  { canonical: "SEAT", aliases: [/\bSEAT\b/iu] },
];

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

function requestedVehicleMake(value: unknown) {
  const text = clean(value);
  for (const make of VEHICLE_MAKES) {
    if (make.aliases.some((pattern) => pattern.test(text))) return make.canonical;
  }
  return normalizeText(value);
}

function detectedVehicleMakes(value: unknown) {
  const text = clean(value);
  return [...new Set(VEHICLE_MAKES
    .filter((make) => make.aliases.some((pattern) => pattern.test(text)))
    .map((make) => make.canonical))];
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

function isStabilizerBushingName(value: string) {
  const text = value.toLocaleLowerCase("uk-UA");
  const bushing = /(?:втулк\w*|bushing\w*|\bbush\b)/u.test(text);
  const stabilizer = /(?:стабіл\w*|стабилиз\w*|sway\s*bar|anti\s*roll|stabili[sz]er)/u.test(text);
  return bushing && stabilizer;
}

function vehicleModelMatch(offer: SupplierOffer, context: StrictOfferContext) {
  const brand = requestedVehicleMake(context.vehicleBrand);
  if (!brand) return false;
  const evidence = `${offer.vehicleMatch || ""} ${offer.name || ""}`;
  const makes = detectedVehicleMakes(evidence);
  if (!makes.includes(brand)) return false;

  const model = normalizeText(context.vehicleModel)
    .replace(/\bEX7\b/gu, "X7")
    .replace(/\bEMGRAND\s+EX7\b/gu, "EMGRAND X7");
  if (!model) return true;
  const source = normalizeText(evidence)
    .replace(/\bEX7\b/gu, "X7")
    .replace(/\bEMGRAND\s+EX7\b/gu, "EMGRAND X7");
  const usefulTokens = model.split(" ").filter((token) => token.length >= 2 && token !== brand);
  return usefulTokens.length === 0 || usefulTokens.every((token) => source.includes(token));
}

export function evaluateStrictOffer(offer: SupplierOffer, context: StrictOfferContext): StrictOfferDecision {
  const titleEvidence = `${offer.name || ""} ${offer.vehicleMatch || ""}`;
  const requestedAxis = normalizeSearchAxis(context.axis)
    || normalizeSearchAxis(context.position)
    || normalizeSearchAxis(context.partName)
    || normalizeSearchAxis(context.query);
  const offeredAxis = normalizeSearchAxis(titleEvidence);

  if (requestedAxis && offeredAxis && requestedAxis !== offeredAxis) {
    return {
      accepted: false,
      rejected: true,
      rejectCode: "AXIS_CONFLICT",
      evidence: "REVIEW",
      compatibilityTier: "UNCONFIRMED",
      score: -1000,
      reason: `Позиція відхилена: запит ${requestedAxis}, а товар явно позначений як ${offeredAxis}.`,
    };
  }

  const requestedMake = requestedVehicleMake(context.vehicleBrand);
  const explicitMakes = detectedVehicleMakes(titleEvidence);
  if (requestedMake && explicitMakes.length && !explicitMakes.includes(requestedMake)) {
    return {
      accepted: false,
      rejected: true,
      rejectCode: "VEHICLE_CONFLICT",
      evidence: "REVIEW",
      compatibilityTier: "UNCONFIRMED",
      score: -900,
      reason: `Позиція відхилена: у назві/fitment вказано ${explicitMakes.join(", ")}, а автомобіль — ${requestedMake}.`,
    };
  }

  const numbers = offerNumberSet(offer);
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

  const canonicalCode = normalizeText(context.canonicalCode);
  if (canonicalCode === "STABILIZER_BUSHING" && !exactOe && !curatedOe && !catalogCross && !isStabilizerBushingName(offer.name || "")) {
    return {
      accepted: false,
      rejected: true,
      rejectCode: "PART_FAMILY_CONFLICT",
      evidence: "REVIEW",
      compatibilityTier: "UNCONFIRMED",
      score: -800,
      reason: "Позиція відхилена: назва не підтверджує, що це саме втулка стабілізатора.",
    };
  }

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
        ? "OE-номер підтверджений точним VIN/каталожним fitment."
        : curatedOe
          ? "OE-номер підтверджений моделлю, роком і позицією з curated OE reference; точний VIN-fitment ще не доведений."
          : "OE-номер збігається з каталогом автомобіля; точну модифікацію потрібно перевірити.",
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
      reason: "Артикул отриманий через OE/cross-граф і не має конфлікту автомобіля або осі.",
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
      reason: "Постачальник підтверджує модель автомобіля; точну модифікацію потрібно перевірити.",
    };
  }

  return {
    accepted: true,
    rejected: false,
    rejectCode: null,
    evidence: "REVIEW",
    compatibilityTier: "REVIEW_REQUIRED",
    score: 100,
    reason: "Знайдено лише за назвою/артикулом без достатнього доказу застосовності.",
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
