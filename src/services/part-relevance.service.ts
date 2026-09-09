import type { SupplierOffer } from "@/src/services/suppliers/types";
import { resolvePartTerminology } from "@/src/services/parts-terminology.service";

export type PartRelevanceInput = {
  query?: string | null;
  partName?: string | null;
  canonicalCode?: string | null;
  catalogArticles?: string[];
  analogArticles?: string[];
  oeNumbers?: string[];
};

export type PartRelevanceResult = {
  relevant: boolean;
  canonicalCode: string | null;
  reason: string;
};

function normalizeArticle(value: unknown) {
  return typeof value === "string"
    ? value.trim().toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/giu, "")
    : "";
}

function cleanText(value: unknown) {
  return typeof value === "string"
    ? value
      .toLocaleLowerCase("uk-UA")
      .replace(/[’'`]/g, "")
      .replace(/[‐‑‒–—-]+/g, " ")
      .replace(/[^a-zа-яіїєґ0-9 ]/giu, " ")
      .replace(/\s+/g, " ")
      .trim()
    : "";
}

function firstIndex(source: string, pattern: RegExp) {
  const match = pattern.exec(source);
  return match?.index ?? -1;
}

function requestedCanonicalCode(input: PartRelevanceInput) {
  const explicit = input.canonicalCode?.trim().toUpperCase();
  if (explicit) return explicit;
  return resolvePartTerminology({
    query: input.query,
    partName: input.partName,
  }).definition?.code || null;
}

function hasTrustedArticle(offer: SupplierOffer, input: PartRelevanceInput) {
  const trusted = new Set([
    ...(input.catalogArticles || []),
    ...(input.analogArticles || []),
    ...(input.oeNumbers || []),
  ].map(normalizeArticle).filter(Boolean));
  if (!trusted.size) return false;

  if (trusted.has(normalizeArticle(offer.article))) return true;
  return (offer.oeNumbers || []).some((number) => trusted.has(normalizeArticle(number)));
}

const BALL_JOINT_TERM = /(?:кульов\w*|шаров\w*|ball\s+joint)/u;
const CONTROL_ARM_TERM = /(?:важел\w*|важіл\w*|важил\w*|рычаг\w*|control\s+arm)/u;
const BUSHING_TERM = /(?:сайлентблок\w*|втулк\w*|bushing\w*)/u;

/**
 * Supplier search is intentionally fuzzy, but the picker must not display a
 * different part family as if it were a match. Exact catalog/OE evidence is
 * trusted; otherwise family-specific semantic guards are applied here.
 */
export function checkPartOfferRelevance(offer: SupplierOffer, input: PartRelevanceInput): PartRelevanceResult {
  const canonicalCode = requestedCanonicalCode(input);
  if (!canonicalCode) {
    return { relevant: true, canonicalCode: null, reason: "Канонічну групу деталі не визначено; результат залишено для ручної перевірки." };
  }

  const name = cleanText(offer.name);

  if (canonicalCode === "BALL_JOINT") {
    const hasBallJointTerm = BALL_JOINT_TERM.test(name);
    const hasControlArmTerm = CONTROL_ARM_TERM.test(name);
    const hasBushingTerm = BUSHING_TERM.test(name);
    const trustedArticle = hasTrustedArticle(offer, input);

    if (!hasBallJointTerm) {
      if (trustedArticle) {
        return { relevant: true, canonicalCode, reason: "Артикул або OE-номер підтверджений каталогом CRM." };
      }
      return {
        relevant: false,
        canonicalCode,
        reason: "Назва товару не містить ознаки кульової опори.",
      };
    }

    // A common BM Parts false positive is an arm title ending with “кульова”
    // because the arm includes a ball joint. It is an assembly, not the requested
    // standalone ball joint, so it must not appear in the picker. This guard runs
    // before article trust: an incorrect supplier title must not be rescued by a
    // broad cross/OE number belonging to the assembly.
    if (hasControlArmTerm && (firstIndex(name, CONTROL_ARM_TERM) < firstIndex(name, BALL_JOINT_TERM) || hasBushingTerm)) {
      return {
        relevant: false,
        canonicalCode,
        reason: "Постачальник повернув важіль/сайлентблок із згадкою кульової, а не окрему кульову опору.",
      };
    }

    if (trustedArticle) {
      return { relevant: true, canonicalCode, reason: "Артикул або OE-номер підтверджений каталогом CRM." };
    }

    return { relevant: true, canonicalCode, reason: "Назва товару відповідає групі кульової опори." };
  }

  if (hasTrustedArticle(offer, input)) {
    return { relevant: true, canonicalCode, reason: "Артикул або OE-номер підтверджений каталогом CRM." };
  }

  if (canonicalCode !== "BALL_JOINT") {
    return { relevant: true, canonicalCode, reason: "Для цієї групи діє загальна перевірка постачальника." };
  }

  // The BALL_JOINT branch above returns for every possible outcome. Keep an
  // explicit defensive fallback so strict production type-checking remains
  // stable if the terminology union grows in the future.
  return { relevant: true, canonicalCode, reason: "Результат залишено для ручної перевірки." };
}

export function isPartOfferRelevant(offer: SupplierOffer, input: PartRelevanceInput) {
  return checkPartOfferRelevance(offer, input).relevant;
}
