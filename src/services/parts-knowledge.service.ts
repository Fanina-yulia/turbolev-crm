import "server-only";

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

function text(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
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
            source: "STATIC_TERMINOLOGY",
            sourceVersion: "v1",
            lastSeenAt: new Date(),
            identityKey: identityKey("STATIC", article.id, normalized, "uk", ""),
          },
          update: { lastSeenAt: new Date() },
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
              source: "STATIC_TERMINOLOGY",
              sourceVersion: "v1",
              lastSeenAt: new Date(),
              identityKey: key,
            },
            update: { lastSeenAt: new Date() },
          });
          aliasCount += 1;
        }
      }
    }
  });

  return { articleCount, aliasCount };
}
