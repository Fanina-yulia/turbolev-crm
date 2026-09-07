import { getPrisma } from "@/src/lib/prisma";

export type PartNormalizationSource = "EXPLICIT_ARTICLE" | "LOCAL_ALIAS" | "CATALOG_NAME" | "REFERENCE_RULE" | "NONE";

export type NormalizedPartNeed = {
  displayName: string;
  normalizedQuery: string;
  normalizedArticle: string | null;
  canonicalName: string | null;
  canonicalSlug: string | null;
  genericArticle: {
    id: string;
    code: string;
    name: string;
    slug: string;
  } | null;
  position: string | null;
  axis: "FRONT" | "REAR" | null;
  side: "LEFT" | "RIGHT" | null;
  confidence: number;
  source: PartNormalizationSource;
};

type Rule = {
  slug: string;
  name: string;
  terms: string[];
};

// This is a safe bootstrap vocabulary. Approved rows in GenericArticleAlias take
// precedence and can be expanded by the service manager without changing code.
const REFERENCE_RULES: Rule[] = [
  { slug: "shock-absorber", name: "Амортизатор", terms: ["амортизатор", "стойка амортизатора", "стійка амортизатора", "shock absorber"] },
  { slug: "coil-spring", name: "Пружина підвіски", terms: ["пружина", "пружина підвіски", "пружина підвіски", "coil spring"] },
  { slug: "brake-pad", name: "Гальмівні колодки", terms: ["гальмівні колодки", "гальмівна колодка", "тормозные колодки", "brake pad", "brake pads"] },
  { slug: "brake-disc", name: "Гальмівний диск", terms: ["гальмівний диск", "гальмівні диски", "тормозной диск", "brake disc", "rotor"] },
  { slug: "brake-caliper", name: "Гальмівний супорт", terms: ["супорт", "суппорт", "гальмівний супорт", "brake caliper"] },
  { slug: "ball-joint", name: "Кульова опора", terms: ["кульова опора", "шарова опора", "шаровая опора", "ball joint"] },
  { slug: "control-arm-bushing", name: "Сайлентблок важеля", terms: ["сайлентблок", "сайлентблок важеля", "сайлентблок рычага", "control arm bushing"] },
  { slug: "tie-rod-end", name: "Рульовий наконечник", terms: ["рульовий наконечник", "рулевой наконечник", "tie rod end"] },
  { slug: "wheel-bearing", name: "Підшипник маточини", terms: ["ступичний підшипник", "ступичный подшипник", "підшипник маточини", "wheel bearing"] },
  { slug: "wheel-seal", name: "Сальник півосі", terms: ["сальник півосі", "сальник полуоси", "сальник ступиці", "axle seal"] },
  { slug: "crankshaft-seal", name: "Сальник колінвала", terms: ["сальник колінвала", "сальник коленвала", "crankshaft seal"] },
  { slug: "engine-oil-pan", name: "Піддон двигуна", terms: ["піддон двигуна", "піддон мотора", "поддон двигателя", "oil pan"] },
  { slug: "valve-cover-gasket", name: "Прокладка клапанної кришки", terms: ["клапанна кришка", "прокладка клапанної кришки", "прокладка клапанной крышки", "valve cover gasket"] },
  { slug: "exhaust-flex-pipe", name: "Гофра вихлопної системи", terms: ["гофра", "гофра вихлопної системи", "гофра выхлопной системы", "exhaust flex"] },
  { slug: "exhaust-manifold", name: "Випускний колектор", terms: ["випускний колектор", "выпускной коллектор", "exhaust manifold"] },
  { slug: "exhaust-muffler", name: "Глушник", terms: ["глушник", "глушитель", "muffler"] },
  { slug: "engine-oil", name: "Моторна олива", terms: ["моторна олива", "моторне масло", "масло двигуна", "engine oil"] },
  { slug: "coolant", name: "Охолоджувальна рідина", terms: ["охолоджувальна рідина", "антифриз", "coolant"] },
];

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizePartPosition(value: unknown) {
  const source = clean(value, 120).toLocaleLowerCase("uk-UA").replace(/[_-]+/g, " ");
  if (!source) return null;
  const front = /(front|перед|передн|передня|передній|передня)/u.test(source);
  const rear = /(rear|зад|задн|задня|задній)/u.test(source);
  const left = /(left|лів|ліва|лівою|лев|левая)/u.test(source);
  const right = /(right|прав|права|правою|правая)/u.test(source);
  const upper = /(upper|верх)/u.test(source);
  const lower = /(lower|нижн)/u.test(source);
  const axis = front ? "FRONT" : rear ? "REAR" : null;
  const side = left ? "LEFT" : right ? "RIGHT" : null;
  const vertical = upper ? "UPPER" : lower ? "LOWER" : null;
  return [axis, side, vertical].filter(Boolean).join("_") || source;
}

export function normalizePartText(value: unknown) {
  return clean(value, 240)
    .toLocaleLowerCase("uk-UA")
    .replace(/[’'`]/g, "")
    .replace(/[‐‑‒–—-]+/g, " ")
    .replace(/[^a-zа-яіїє0-9 ]/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePartArticle(value: unknown) {
  const normalized = normalizePartText(value).replace(/\s+/g, "");
  return normalized || null;
}

function phraseCandidates(source: string) {
  const tokens = source.split(" ").filter(Boolean);
  const result = new Set<string>([source]);
  for (let size = 1; size <= Math.min(4, tokens.length); size += 1) {
    for (let start = 0; start + size <= tokens.length; start += 1) {
      result.add(tokens.slice(start, start + size).join(" "));
    }
  }
  return [...result];
}

function ruleFor(source: string) {
  return REFERENCE_RULES
    .flatMap((rule) => rule.terms.map((term) => ({ rule, term: normalizePartText(term) })))
    .filter((candidate) => candidate.term && source.includes(candidate.term))
    .sort((left, right) => right.term.length - left.term.length)[0]?.rule || null;
}

function positionParts(position: string | null) {
  const value = position || "";
  return {
    axis: value.startsWith("FRONT") ? "FRONT" as const : value.startsWith("REAR") ? "REAR" as const : null,
    side: value.includes("LEFT") ? "LEFT" as const : value.includes("RIGHT") ? "RIGHT" as const : null,
  };
}

function aliasScore(alias: string, source: string) {
  if (!alias) return 0;
  if (alias === source) return 100;
  if (source.includes(alias)) return Math.min(96, 60 + alias.length);
  return 0;
}

async function findCatalogArticle(input: {
  source: string;
  candidates: string[];
  rule: Rule | null;
  genericArticleId: string;
}) {
  const prisma = getPrisma();
  if (input.genericArticleId) {
    return prisma.genericArticle.findFirst({
      where: { id: input.genericArticleId, status: "ACTIVE" },
      select: { id: true, code: true, name: true, slug: true },
    });
  }

  const aliases = await prisma.genericArticleAlias.findMany({
    where: { aliasNormalized: { in: input.candidates }, isApproved: true },
    select: {
      aliasNormalized: true,
      confidence: true,
      genericArticle: { select: { id: true, code: true, name: true, slug: true, status: true } },
    },
    take: 100,
  });
  const bestAlias = aliases
    .filter((row) => row.genericArticle.status === "ACTIVE")
    .map((row) => ({ row, score: aliasScore(row.aliasNormalized, input.source) + Math.min(Math.max(row.confidence || 0, 0), 10) }))
    .sort((left, right) => right.score - left.score)[0];
  if (bestAlias) return bestAlias.row.genericArticle;

  const nameConditions = input.candidates.slice(0, 12).map((term) => ({ name: { contains: term, mode: "insensitive" as const } }));
  const slugConditions = [input.rule?.slug, input.rule?.slug.replace(/^(front|rear|left|right)-/u, "")].filter(Boolean).map((slug) => ({ slug: { contains: slug as string, mode: "insensitive" as const } }));
  const genericArticles = await prisma.genericArticle.findMany({
    where: { status: "ACTIVE", OR: [...nameConditions, ...slugConditions] },
    select: { id: true, code: true, name: true, slug: true },
    take: 100,
  });
  const bestArticle = genericArticles
    .map((article) => ({ article, score: input.rule && article.slug.toLocaleLowerCase().includes(input.rule.slug) ? 90 : Math.max(...input.candidates.map((term) => normalizePartText(article.name).includes(term) ? term.length : 0), 0) }))
    .sort((left, right) => right.score - left.score)[0];
  return bestArticle && bestArticle.score > 0 ? bestArticle.article : null;
}

/**
 * Resolves a mechanic-facing label into a canonical search intent.
 * `displayName` is deliberately kept intact so the Diagnostic Card remains unchanged.
 */
export async function normalizePartNeed(input: {
  query?: string | null;
  partName?: string | null;
  genericArticleId?: string | null;
  position?: string | null;
}) : Promise<NormalizedPartNeed> {
  const displayName = clean(input.partName || input.query) || "Запчастина";
  const source = normalizePartText([input.partName, input.query].filter(Boolean).join(" "));
  const normalizedQuery = normalizePartText(input.query || input.partName);
  const normalizedArticle = normalizePartArticle(input.query);
  const position = normalizePartPosition(input.position || source);
  const { axis, side } = positionParts(position);
  const rule = ruleFor(source);
  const candidates = phraseCandidates(source);

  if (input.genericArticleId?.trim()) {
    try {
      const genericArticle = await findCatalogArticle({ source, candidates, rule, genericArticleId: input.genericArticleId.trim() });
      return {
        displayName,
        normalizedQuery,
        normalizedArticle,
        canonicalName: genericArticle?.name || rule?.name || null,
        canonicalSlug: genericArticle?.slug || rule?.slug || null,
        genericArticle: genericArticle || null,
        position,
        axis,
        side,
        confidence: genericArticle ? 100 : 78,
        source: genericArticle ? "EXPLICIT_ARTICLE" : "REFERENCE_RULE",
      };
    } catch (error) {
      console.warn("Explicit generic article lookup failed", error);
    }
  }

  try {
    const genericArticle = await findCatalogArticle({ source, candidates, rule, genericArticleId: "" });
    if (genericArticle) {
      const aliasMatched = await getPrisma().genericArticleAlias.findFirst({
        where: { genericArticleId: genericArticle.id, aliasNormalized: { in: candidates }, isApproved: true },
        select: { id: true },
      });
      return {
        displayName,
        normalizedQuery,
        normalizedArticle,
        canonicalName: genericArticle.name,
        canonicalSlug: genericArticle.slug,
        genericArticle,
        position,
        axis,
        side,
        confidence: aliasMatched ? 96 : 88,
        source: aliasMatched ? "LOCAL_ALIAS" : "CATALOG_NAME",
      };
    }
  } catch (error) {
    // A missing/unmigrated local catalog must not break reference search.
    console.warn("Local part normalization catalog unavailable", error);
  }

  return {
    displayName,
    normalizedQuery,
    normalizedArticle,
    canonicalName: rule?.name || null,
    canonicalSlug: rule?.slug || null,
    genericArticle: null,
    position,
    axis,
    side,
    confidence: rule ? 78 : 0,
    source: rule ? "REFERENCE_RULE" : "NONE",
  };
}
