import { createHash } from "node:crypto";
import { CatalogEntityStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import {
  buildProviderPartQueryCandidates,
  normalizePartTerminology,
  resolvePartTerminology,
  listPartTerminology,
  type PartProvider,
  type PartTerminologyInput,
  type PartTerminologyResolution,
} from "@/src/services/parts-terminology.service";

export type PartKnowledgeInput = PartTerminologyInput & {
  genericArticleId?: string | null;
  provider?: PartProvider | null;
};

export type PartKnowledgeResolution = PartTerminologyResolution & {
  source: "CRM_KNOWLEDGE" | "STATIC_FALLBACK";
  aliasId: string | null;
  matchedAlias: string | null;
  genericArticleId: string | null;
  candidates: string[];
};

type KnowledgeAttributes = PartKnowledgeResolution["attributes"];

export type PartNameSuggestion = {
  id: string | null;
  code: string;
  name: string;
  category: string | null;
  matchedAlias: string | null;
  positionHint: string | null;
  source: "CRM_CATALOG" | "STATIC_FALLBACK";
};

function text(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function suggestionPosition(axisHint: string | null | undefined, sideHint: string | null | undefined, subPositionHint: string | null | undefined) {
  const axis = axisHint === "FRONT" ? "передня" : axisHint === "REAR" ? "задня" : "";
  const side = sideHint === "LEFT" ? "ліва" : sideHint === "RIGHT" ? "права" : "";
  const sub = subPositionHint === "UPPER" ? "верхня" : subPositionHint === "LOWER" ? "нижня" : "";
  return [axis, side, sub].filter(Boolean).join(" ") || null;
}

function suggestionScore(query: string, tokens: string[], name: string, code: string, aliases: string[]) {
  const normalizedName = normalizePartTerminology(name);
  const normalizedCode = normalizePartTerminology(code);
  const normalizedAliases = aliases.map(normalizePartTerminology);
  const haystack = [normalizedName, normalizedCode, ...normalizedAliases].join(" ");
  const allTokens = tokens.every((token) => haystack.includes(token));
  const exactName = normalizedName === query;
  const startsName = normalizedName.startsWith(query);
  const exactAlias = normalizedAliases.some((alias) => alias === query);
  const startsAlias = normalizedAliases.some((alias) => alias.startsWith(query));
  return (exactName ? 1000 : 0)
    + (exactAlias ? 850 : 0)
    + (startsName ? 700 : 0)
    + (startsAlias ? 550 : 0)
    + (allTokens ? 300 : 0)
    + (normalizedName.includes(query) ? 120 : 0)
    + (normalizedCode.includes(query) ? 100 : 0);
}

/**
 * Lightweight name-only search for the review form. It deliberately does not
 * call supplier APIs or resolve VIN fitment; those are expensive and belong
 * to the next, explicit parts-selection step.
 */
export async function searchPartNameSuggestions(query: string, limit = 8): Promise<PartNameSuggestion[]> {
  const normalizedQuery = normalizePartTerminology(query);
  if (normalizedQuery.length < 2) return [];
  const safeLimit = Math.max(1, Math.min(12, Math.floor(limit) || 8));
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  const fallback = listPartTerminology().map((definition) => ({
    id: null,
    code: definition.code,
    name: definition.canonicalName,
    category: null,
    matchedAlias: definition.aliases.find((alias) => normalizePartTerminology(alias).includes(normalizedQuery)) || null,
    positionHint: null,
    source: "STATIC_FALLBACK" as const,
    score: suggestionScore(normalizedQuery, tokens, definition.canonicalName, definition.code, [...definition.aliases]),
  })).filter((item) => item.score > 0);

  const catalog: Array<PartNameSuggestion & { score: number }> = [];
  try {
    const prisma = getPrisma();
    const rows = await prisma.genericArticle.findMany({
      where: {
        status: CatalogEntityStatus.ACTIVE,
        OR: tokens.flatMap((token) => [
          { name: { contains: token, mode: "insensitive" as const } },
          { code: { contains: token, mode: "insensitive" as const } },
          { aliases: { some: { status: CatalogEntityStatus.ACTIVE, aliasNormalized: { contains: token, mode: "insensitive" as const } } } },
          { aliases: { some: { status: CatalogEntityStatus.ACTIVE, aliasRaw: { contains: token, mode: "insensitive" as const } } } },
        ]),
      },
      take: 100,
      select: {
        id: true,
        code: true,
        name: true,
        aliases: {
          where: { status: CatalogEntityStatus.ACTIVE },
          orderBy: [{ confidence: "desc" }, { usageCount: "desc" }, { updatedAt: "desc" }],
          take: 20,
          select: { aliasRaw: true, axisHint: true, sideHint: true, subPositionHint: true },
        },
        categories: {
          select: { sortOrder: true, category: { select: { name: true, status: true } } },
        },
      },
    });

    for (const row of rows) {
      const aliases = row.aliases.map((alias) => alias.aliasRaw);
      const score = suggestionScore(normalizedQuery, tokens, row.name, row.code, aliases);
      if (score <= 0) continue;
      const matched = aliases.find((alias) => normalizePartTerminology(alias).includes(normalizedQuery)) || null;
      const hintedAlias = row.aliases.find((alias) => matched === alias.aliasRaw) || row.aliases[0];
      const category = row.categories
        .filter((item) => item.category.status === CatalogEntityStatus.ACTIVE)
        .sort((a, b) => a.sortOrder - b.sortOrder)[0]?.category.name || null;
      catalog.push({
        id: row.id,
        code: row.code,
        name: row.name,
        category,
        matchedAlias: matched && normalizePartTerminology(matched) !== normalizePartTerminology(row.name) ? matched : null,
        positionHint: hintedAlias ? suggestionPosition(hintedAlias.axisHint, hintedAlias.sideHint, hintedAlias.subPositionHint) : null,
        source: "CRM_CATALOG",
        score,
      });
    }
  } catch (error) {
    console.warn("Parts autocomplete catalog unavailable; using static fallback", error instanceof Error ? error.message : "unknown error");
  }

  const merged = new Map<string, PartNameSuggestion & { score: number }>();
  for (const item of fallback) merged.set(item.code, item);
  for (const item of catalog) merged.set(item.code, item);
  return [...merged.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "uk"))
    .slice(0, safeLimit)
    .map(({ score: _score, ...item }) => item);
}

function identityKey(...values: string[]) {
  return createHash("sha256").update(values.join("\u001f")).digest("hex");
}

function confidenceLabel(value: number) {
  if (value >= 90) return "HIGH" as const;
  if (value >= 60) return "MEDIUM" as const;
  return "LOW" as const;
}

function hintValue(value: string | null | undefined, allowed: string[]) {
  const normalized = text(value, 20).toUpperCase();
  return allowed.includes(normalized) ? normalized : null;
}

function attributesFromAlias(
  alias: {
    axisHint?: string | null;
    sideHint?: string | null;
    subPositionHint?: string | null;
  },
  fallback: KnowledgeAttributes,
): KnowledgeAttributes {
  return {
    axis: hintValue(alias.axisHint, ["FRONT", "REAR"]) as KnowledgeAttributes["axis"] || fallback.axis,
    side: hintValue(alias.sideHint, ["LEFT", "RIGHT"]) as KnowledgeAttributes["side"] || fallback.side,
    subPosition: hintValue(alias.subPositionHint, ["FRONT", "REAR", "UPPER", "LOWER"]) as KnowledgeAttributes["subPosition"] || fallback.subPosition,
  };
}

function staticKnowledge(input: PartKnowledgeInput, candidates: string[]): PartKnowledgeResolution {
  const fallback = resolvePartTerminology(input);
  return {
    ...fallback,
    source: "STATIC_FALLBACK",
    aliasId: null,
    matchedAlias: null,
    genericArticleId: null,
    candidates,
  };
}

function inputCandidates(input: PartKnowledgeInput) {
  const definition = resolvePartTerminology(input).definition;
  return unique([
    text(input.query, 240),
    text(input.partName, 240),
    ...(definition?.aliases || []),
  ].map(normalizePartTerminology).filter(Boolean));
}

export async function resolvePartKnowledge(input: PartKnowledgeInput): Promise<PartKnowledgeResolution> {
  const candidates = inputCandidates(input);
  const fallback = resolvePartTerminology(input);
  let requestedArticleId = text(input.genericArticleId, 160) || null;

  try {
    const prisma = getPrisma();
    if (!requestedArticleId && text(input.canonicalCode, 80)) {
      const articleByCode = await prisma.genericArticle.findFirst({
        where: { code: text(input.canonicalCode, 80), status: CatalogEntityStatus.ACTIVE },
        select: { id: true },
      });
      requestedArticleId = articleByCode?.id || null;
    }

    const aliases = await prisma.genericArticleAlias.findMany({
      where: {
        status: CatalogEntityStatus.ACTIVE,
        genericArticle: { status: CatalogEntityStatus.ACTIVE },
        ...(requestedArticleId ? { genericArticleId: requestedArticleId } : {}),
        ...(input.provider ? { provider: { in: ["", input.provider] } } : {}),
        ...(!requestedArticleId && candidates.length ? { aliasNormalized: { in: candidates } } : {}),
      },
      orderBy: [{ confidence: "desc" }, { usageCount: "desc" }, { updatedAt: "desc" }],
      take: 50,
      select: {
        id: true,
        genericArticleId: true,
        aliasRaw: true,
        aliasType: true,
        axisHint: true,
        sideHint: true,
        subPositionHint: true,
        confidence: true,
        genericArticle: {
          select: {
            id: true,
            code: true,
            name: true,
            slug: true,
            status: true,
          },
        },
      },
    });

    const best = aliases.find((alias) => !candidates.length || candidates.includes(normalizePartTerminology(alias.aliasRaw))) || aliases[0];
    if (best && best.genericArticle.status === CatalogEntityStatus.ACTIVE) {
      const score = Math.max(0, Math.min(100, best.confidence || 0));
      const definition = {
        slug: best.genericArticle.slug,
        code: best.genericArticle.code,
        canonicalName: best.genericArticle.name,
        aliases: [best.aliasRaw],
      };
      return {
        originalQuery: text(input.partName || input.query),
        definition,
        attributes: attributesFromAlias(best, fallback.attributes),
        matchType: best.aliasType === "CANONICAL_CODE" ? "CANONICAL_CODE" : "EXACT_ALIAS",
        confidence: confidenceLabel(score || 80),
        source: "CRM_KNOWLEDGE",
        aliasId: best.id,
        matchedAlias: best.aliasRaw,
        genericArticleId: best.genericArticleId,
        candidates,
      };
    }
  } catch (error) {
    console.warn("Parts knowledge lookup unavailable; using static terminology", error instanceof Error ? error.message : "unknown error");
  }

  return staticKnowledge(input, candidates);
}

export async function buildKnowledgeProviderPartQueryCandidates(
  input: PartKnowledgeInput & { provider: PartProvider },
) {
  const staticCandidates = buildProviderPartQueryCandidates(input);
  const resolution = await resolvePartKnowledge(input);
  let genericArticleId = resolution.genericArticleId || null;

  try {
    const prisma = getPrisma();
    if (!genericArticleId && text(input.canonicalCode, 80)) {
      const article = await prisma.genericArticle.findFirst({
        where: { code: text(input.canonicalCode, 80), status: CatalogEntityStatus.ACTIVE },
        select: { id: true },
      });
      genericArticleId = article?.id || null;
    }

    const aliases = await prisma.genericArticleAlias.findMany({
      where: {
        status: CatalogEntityStatus.ACTIVE,
        provider: { in: ["", input.provider] },
        ...(genericArticleId
          ? { genericArticleId }
          : { aliasNormalized: { in: unique(staticCandidates.map(normalizePartTerminology).filter(Boolean)) } }),
      },
      orderBy: [{ confidence: "desc" }, { usageCount: "desc" }, { updatedAt: "desc" }],
      take: 40,
      select: { aliasRaw: true },
    });
    return unique([...staticCandidates, ...aliases.map((alias) => alias.aliasRaw.trim()).filter(Boolean)]).slice(0, 8);
  } catch (error) {
    console.warn("Provider parts knowledge lookup unavailable; using static provider terms", error instanceof Error ? error.message : "unknown error");
    return staticCandidates;
  }
}

async function ensureCanonicalArticle(
  tx: any,
  definition: { code: string; slug: string; canonicalName: string },
) {
  const existing = await tx.genericArticle.findFirst({
    where: { OR: [{ code: definition.code }, { slug: definition.slug }] },
  });
  if (existing) {
    if (existing.status === CatalogEntityStatus.DRAFT) {
      return tx.genericArticle.update({
        where: { id: existing.id },
        data: { name: definition.canonicalName, status: CatalogEntityStatus.ACTIVE },
      });
    }
    return existing;
  }
  return tx.genericArticle.create({
    data: {
      code: definition.code,
      name: definition.canonicalName,
      slug: definition.slug,
      status: CatalogEntityStatus.ACTIVE,
    },
  });
}

export async function seedStaticPartKnowledge() {
  const prisma = getPrisma();
  const definitions = listPartTerminology();
  let articleCount = 0;
  let aliasCount = 0;

  await prisma.$transaction(async (tx) => {
    for (const definition of definitions) {
      const article = await ensureCanonicalArticle(tx, definition);
      articleCount += 1;

      const terms = unique([definition.canonicalName, ...definition.aliases]);
      for (const term of terms) {
        const normalized = normalizePartTerminology(term);
        if (!normalized) continue;
        await tx.genericArticleAlias.upsert({
          where: { identityKey: identityKey("STATIC", article.id, normalized, "uk", "") },
          create: {
            genericArticleId: article.id,
            aliasRaw: term,
            aliasNormalized: normalized,
            aliasType: "SYNONYM",
            language: "uk",
            provider: "",
            confidence: 100,
            status: CatalogEntityStatus.ACTIVE,
            isApproved: true,
            source: "STATIC_TERMINOLOGY",
            sourceVersion: "v1",
            lastSeenAt: new Date(),
            identityKey: identityKey("STATIC", article.id, normalized, "uk", ""),
          },
          update: { status: CatalogEntityStatus.ACTIVE, isApproved: true, lastSeenAt: new Date() },
        });
        aliasCount += 1;
      }

      for (const provider of ["BM_PARTS", "UNITRADE"] as const) {
        const providerTerms = unique(buildProviderPartQueryCandidates({
          query: definition.canonicalName,
          provider,
          canonicalCode: definition.code,
          canonicalSlug: definition.slug,
        }));
        for (const term of providerTerms) {
          const normalized = normalizePartTerminology(term);
          if (!normalized) continue;
          const key = identityKey("STATIC_PROVIDER", article.id, normalized, provider, "");
          await tx.genericArticleAlias.upsert({
            where: { identityKey: key },
            create: {
              genericArticleId: article.id,
              aliasRaw: term,
              aliasNormalized: normalized,
              aliasType: "PROVIDER_TERM",
              language: provider === "BM_PARTS" ? "ru" : "uk",
              provider,
              confidence: 90,
              status: CatalogEntityStatus.ACTIVE,
              isApproved: true,
              source: "STATIC_TERMINOLOGY",
              sourceVersion: "v1",
              lastSeenAt: new Date(),
              identityKey: key,
            },
            update: { status: CatalogEntityStatus.ACTIVE, isApproved: true, lastSeenAt: new Date() },
          });
          aliasCount += 1;
        }
      }
    }
  });

  return { articleCount, aliasCount };
}
