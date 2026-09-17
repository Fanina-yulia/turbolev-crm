import type { SupplierOffer } from "@/src/services/suppliers/types";
import { resolvePartTerminology } from "@/src/services/parts-terminology.service";
import { evaluatePartFamily } from "@/src/services/part-family-policy.service";

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
 * Provider relevance is a pre-filter, not the final compatibility authority.
 * V3 nevertheless applies the same universal family invariant here so a
 * clearly wrong component family cannot contaminate BM vehicle fitment/OE
 * discovery before the strict policy layer runs.
 */
export function checkPartOfferRelevance(offer: SupplierOffer, input: PartRelevanceInput): PartRelevanceResult {
  const canonicalCode = requestedCanonicalCode(input);
  if (!canonicalCode) {
    return { relevant: true, canonicalCode: null, reason: "Канонічну групу деталі не визначено; результат залишено для strict review." };
  }

  const family = evaluatePartFamily(offer, canonicalCode);
  if (family.conflict) {
    return {
      relevant: false,
      canonicalCode,
      reason: `PART_FAMILY_CONFLICT: ${family.reason}`,
    };
  }

  const name = cleanText(offer.name);
  if (canonicalCode === "BALL_JOINT") {
    const hasBallJointTerm = BALL_JOINT_TERM.test(name);
    const hasControlArmTerm = CONTROL_ARM_TERM.test(name);
    const hasBushingTerm = BUSHING_TERM.test(name);

    // Preserve the stronger historical ball-joint assembly guard. A control
    // arm mentioning a ball joint is still a different sellable component.
    if (hasControlArmTerm && (firstIndex(name, CONTROL_ARM_TERM) < firstIndex(name, BALL_JOINT_TERM) || hasBushingTerm)) {
      return {
        relevant: false,
        canonicalCode,
        reason: "PART_FAMILY_CONFLICT: постачальник повернув важіль/сайлентблок із згадкою кульової, а не окрему кульову опору.",
      };
    }
    if (!hasBallJointTerm && !hasTrustedArticle(offer, input)) {
      return {
        relevant: false,
        canonicalCode,
        reason: "Назва товару не містить ознаки кульової опори і trusted OE/article evidence відсутній.",
      };
    }
  }

  if (hasTrustedArticle(offer, input)) {
    return { relevant: true, canonicalCode, reason: "Артикул або OE-номер підтверджений каталогом CRM і family conflict відсутній." };
  }

  if (family.matchedCanonicalCode === canonicalCode) {
    return { relevant: true, canonicalCode, reason: `Назва товару відповідає canonical family ${canonicalCode}.` };
  }

  // Unknown family is not silently promoted to compatible. It may continue to
  // the strict layer, but can only become REVIEW_REQUIRED without OE/cross/model evidence.
  return {
    relevant: true,
    canonicalCode,
    reason: "Canonical family з назви не доведена; результат допускається лише до strict evidence review.",
  };
}

export function isPartOfferRelevant(offer: SupplierOffer, input: PartRelevanceInput) {
  return checkPartOfferRelevance(offer, input).relevant;
}
