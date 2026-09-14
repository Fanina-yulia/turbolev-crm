import { normalizeCatalogNumber } from "@/src/services/parts-fitment.service";
import type { SupplierOffer, SupplierResultType } from "./types";

export type CascadeSearchContext = {
  canonicalCode?: string | null;
  partName?: string | null;
  oeNumbers?: string[];
  catalogArticles?: string[];
  analogReferences?: Array<{ brand: string | null; article: string }>;
  providerVehicleBrand?: string | null;
};

export type CascadeReference = {
  article: string;
  brand: string | null;
  reason: string;
};

export type AssemblyFallback = {
  canonicalCode: string;
  canonicalName: string;
  providerQueries: {
    BM_PARTS: string[];
    UNITRADE: string[];
  };
};

const ASSEMBLY_FALLBACKS: Record<string, AssemblyFallback> = {
  WHEEL_HUB_BEARING: {
    canonicalCode: "WHEEL_HUB_ASSEMBLY",
    canonicalName: "Ступиця в зборі",
    providerQueries: {
      BM_PARTS: ["ступица в сборе", "ступица с подшипником", "hub bearing kit"],
      UNITRADE: ["ступиця в зборі", "маточина в зборі", "ступиця з підшипником", "wheel hub assembly"],
    },
  },
};

function clean(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function looksLikePartNumber(value: string) {
  return /^[a-z0-9][a-z0-9._/\\-]{2,}$/iu.test(value.trim()) && /[0-9]/u.test(value);
}

function referenceKey(article: string, brand: string | null) {
  return `${normalizeCatalogNumber(brand)}:${normalizeCatalogNumber(article)}`;
}

export function buildCascadeReferences(
  query: string,
  context: CascadeSearchContext,
  offers: SupplierOffer[],
  limit = 8,
): CascadeReference[] {
  const references = new Map<string, CascadeReference>();
  const push = (articleValue: unknown, brandValue: unknown, reason: string) => {
    const article = clean(articleValue, 180);
    const brand = clean(brandValue, 120) || null;
    if (!article || !looksLikePartNumber(article)) return;
    const key = referenceKey(article, brand);
    if (!references.has(key)) references.set(key, { article, brand, reason });
  };

  for (const reference of context.analogReferences || []) {
    push(reference.article, reference.brand, "VIN/OE каталог повернув крос-номер");
  }
  for (const article of context.oeNumbers || []) push(article, null, "OE номер із каталогу автомобіля");
  for (const article of context.catalogArticles || []) push(article, null, "Каталожний артикул автомобіля");
  if (looksLikePartNumber(query)) push(query, null, "Прямий пошук за артикулом");

  const knownNumbers = new Set([
    ...(context.oeNumbers || []),
    ...(context.catalogArticles || []),
    ...(looksLikePartNumber(query) ? [query] : []),
  ].map(normalizeCatalogNumber).filter(Boolean));

  for (const offer of offers) {
    const article = normalizeCatalogNumber(offer.article);
    const canPromote = Boolean(
      article
      && (
        knownNumbers.has(article)
        || offer.offerClass === "OEM"
        || offer.sourceKind === "OEM"
        || offer.oeNumbers?.some((number) => knownNumbers.has(normalizeCatalogNumber(number)))
      )
    );
    if (!canPromote) continue;
    push(offer.article, offer.brand, "OEM/крос знайдено у відповіді постачальника");
    for (const number of offer.oeNumbers || []) push(number, offer.brand, "OE номер із картки товару постачальника");
  }

  const byArticle = new Map<string, CascadeReference>();
  for (const reference of references.values()) {
    const articleKey = normalizeCatalogNumber(reference.article);
    const current = byArticle.get(articleKey);
    if (!current || (!current.brand && reference.brand)) byArticle.set(articleKey, reference);
  }
  return [...byArticle.values()].slice(0, Math.max(1, limit));
}

export function getAssemblyFallback(context: Pick<CascadeSearchContext, "canonicalCode" | "partName">) {
  const canonicalCode = clean(context.canonicalCode, 80).toUpperCase();
  if (canonicalCode && ASSEMBLY_FALLBACKS[canonicalCode]) return ASSEMBLY_FALLBACKS[canonicalCode];

  const partName = clean(context.partName, 240).toLocaleLowerCase("uk-UA");
  if (/(ступічн|ступичн|підшипник\s+(ступиц|маточ)|wheel\s+(hub\s+)?bearing)/iu.test(partName)) {
    return ASSEMBLY_FALLBACKS.WHEEL_HUB_BEARING;
  }
  return null;
}

export function classifySupplierResultType(
  offer: SupplierOffer,
  input: {
    isAssembly?: boolean;
    isAnalog?: boolean;
    isOeNumber?: boolean;
    vehicleBrand?: string | null;
  } = {},
): SupplierResultType {
  if (input.isAssembly || offer.sourceKind === "ASSEMBLY") return "ASSEMBLY";
  if (input.isAnalog || offer.offerClass === "ANALOG" || offer.sourceKind === "ANALOG") return "ANALOG";
  if (input.isOeNumber || offer.offerClass === "OEM" || offer.sourceKind === "OEM") {
    const offerBrand = clean(offer.brand, 120).toLocaleLowerCase("uk-UA");
    const vehicleBrand = clean(input.vehicleBrand, 120).toLocaleLowerCase("uk-UA");
    return offerBrand && vehicleBrand && offerBrand === vehicleBrand ? "ORIGINAL" : "OEM_REPLACEMENT";
  }
  return "UNKNOWN";
}

export function cascadeReason(resultType: SupplierResultType, seedReason?: string | null) {
  if (resultType === "ASSEMBLY") return "Комплектна альтернатива — потребує підтвердження менеджера.";
  if (resultType === "ORIGINAL") return seedReason || "Оригінальний номер підтверджений у каскадному пошуку.";
  if (resultType === "OEM_REPLACEMENT") return seedReason || "Знайдено за OEM/крос-номером; сумісність потрібно звірити.";
  if (resultType === "ANALOG") return seedReason || "Аналог знайдено за OEM/крос-номером.";
  return seedReason || "Знайдено за назвою/артикулом; потрібна перевірка застосовності.";
}
