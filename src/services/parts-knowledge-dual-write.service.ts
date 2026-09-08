import "server-only";

import { createHash } from "node:crypto";
import { CatalogEntityStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { normalizePartTerminology } from "@/src/services/parts-terminology.service";
import { listMechanicDiagnosticMappings } from "@/src/services/mechanic-part-catalog";
import { listPartTerminology } from "@/src/services/parts-terminology.service";
import {
  writePartsKnowledgeToGoogleSheets,
  type PartsKnowledgeSheetWrite,
} from "@/src/services/parts-knowledge-google-sheets-write.service";

type JsonRecord = Record<string, unknown>;

export type PartsKnowledgeAliasInput = {
  alias?: unknown;
  term?: unknown;
  aliasType?: unknown;
  language?: unknown;
  provider?: unknown;
  axis?: unknown;
  side?: unknown;
  subPosition?: unknown;
  confidence?: unknown;
  status?: unknown;
  source?: unknown;
  sourceVersion?: unknown;
};

export type PartsKnowledgeDualWriteInput = {
  part?: {
    code?: unknown;
    name?: unknown;
    slug?: unknown;
    status?: unknown;
    category?: unknown;
    source?: unknown;
    sourceVersion?: unknown;
  } | null;
  aliases?: unknown;
  providerTerms?: unknown;
  diagnosticMappings?: unknown;
};

type NormalizedPart = {
  code: string;
  name: string;
  slug: string;
  status: CatalogEntityStatus;
  category: string;
  source: string;
  sourceVersion: string;
};

type NormalizedAlias = {
  alias: string;
  aliasType: string;
  language: string;
  provider: "" | "BM_PARTS" | "UNITRADE";
  axis: string;
  side: string;
  subPosition: string;
  confidence: number;
  status: CatalogEntityStatus;
  source: string;
  sourceVersion: string;
};

type NormalizedDiagnosticMapping = {
  itemCode: string;
  sectionCode: string;
  itemName: string;
  canonicalCode: string;
  canonicalName: string;
  displayName: string;
  axis: string;
  side: string;
  subPosition: string;
  position: string;
  category: string;
  bmPartsTerms: string;
  unitradeTerms: string;
  synonyms: string;
  searchEnabled: boolean;
  source: string;
  sourceVersion: string;
};

type NormalizedInput = {
  part: NormalizedPart;
  aliases: NormalizedAlias[];
  providerTerms: NormalizedAlias[];
  diagnosticMappings: NormalizedDiagnosticMapping[];
};

type CrmWriteResult = {
  articleId: string;
  articleCreated: boolean;
  aliasesWritten: number;
  providerTermsWritten: number;
};

export class PartsKnowledgeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartsKnowledgeValidationError";
  }
}

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function catalogStatus(value: unknown, fallback = CatalogEntityStatus.ACTIVE) {
  const normalized = text(value, 32).toUpperCase();
  return Object.values(CatalogEntityStatus).includes(normalized as CatalogEntityStatus)
    ? normalized as CatalogEntityStatus
    : fallback;
}

function safeSlug(value: string, fallback: string) {
  const normalized = normalizePartTerminology(value || fallback);
  return (normalized || fallback.toLowerCase())
    .replace(/\s+/g, "-")
    .replace(/[^a-zа-яіїєґ0-9-]+/giu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 200);
}

function integer(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : fallback;
}

function provider(value: unknown): "" | "BM_PARTS" | "UNITRADE" {
  const normalized = text(value, 40).toUpperCase().replace(/[\s-]+/g, "_");
  if (normalized === "BM_PARTS" || normalized === "UNITRADE") return normalized;
  return "";
}

function hint(value: unknown, allowed: string[]) {
  const normalized = text(value, 24).toUpperCase();
  return allowed.includes(normalized) ? normalized : "";
}

function identityKey(...values: string[]) {
  return createHash("sha256").update(values.join("\u001f")).digest("hex");
}

function operationKeyFor(input: NormalizedInput, explicit?: unknown) {
  const requested = text(explicit, 128);
  if (requested) return requested;
  return identityKey("PARTS_KNOWLEDGE_DUAL_WRITE", JSON.stringify(input));
}

function aliasFromUnknown(value: unknown, defaultType: string): NormalizedAlias | null {
  const source = typeof value === "string" ? { alias: value } : record(value);
  const alias = text(source.alias ?? source.term, 240);
  if (!alias) return null;

  const selectedProvider = provider(source.provider);
  const selectedAliasType = text(source.aliasType, 40).toUpperCase()
    || (selectedProvider ? "PROVIDER_TERM" : defaultType);
  const defaultLanguage = selectedProvider === "BM_PARTS" ? "ru" : "uk";
  const status = catalogStatus(source.status);
  return {
    alias,
    aliasType: selectedAliasType,
    language: text(source.language, 8) || defaultLanguage,
    provider: selectedProvider,
    axis: hint(source.axis, ["FRONT", "REAR"]),
    side: hint(source.side, ["LEFT", "RIGHT"]),
    subPosition: hint(source.subPosition, ["FRONT", "REAR", "UPPER", "LOWER"]),
    confidence: integer(source.confidence, selectedProvider ? 90 : 100),
    status,
    source: text(source.source, 64) || "CRM_DUAL_WRITE",
    sourceVersion: text(source.sourceVersion, 160) || "v1",
  };
}

function dedupeAliases(values: NormalizedAlias[]) {
  const result: NormalizedAlias[] = [];
  const keys = new Set<string>();
  for (const value of values) {
    const normalized = normalizePartTerminology(value.alias);
    if (!normalized) continue;
    const key = normalized + "\u001f" + value.provider;
    if (keys.has(key)) continue;
    keys.add(key);
    result.push(value);
  }
  return result;
}

function stringList(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((item) => text(item, 240)).filter(Boolean))].join(" | ");
}

function diagnosticMappingFromUnknown(value: unknown, fallback: { source: string; sourceVersion: string }): NormalizedDiagnosticMapping | null {
  const source = record(value);
  const itemCode = text(source.itemCode ?? source.item_code, 80).toUpperCase();
  const canonicalCode = text(source.canonicalCode ?? source.canonical_code, 80).toUpperCase();
  if (!itemCode || !canonicalCode) return null;
  return {
    itemCode,
    sectionCode: text(source.sectionCode ?? source.section_code, 100),
    itemName: text(source.itemName ?? source.item_name, 240),
    canonicalCode,
    canonicalName: text(source.canonicalName ?? source.canonical_name, 240),
    displayName: text(source.displayName ?? source.display_name, 280),
    axis: hint(source.axis, ["FRONT", "REAR"]),
    side: hint(source.side, ["LEFT", "RIGHT"]),
    subPosition: hint(source.subPosition ?? source.sub_position, ["FRONT", "REAR", "UPPER", "LOWER"]),
    position: text(source.position, 160),
    category: text(source.category, 120),
    bmPartsTerms: stringList(source.bmPartsTerms ?? source.bm_parts_terms),
    unitradeTerms: stringList(source.unitradeTerms ?? source.unitrade_terms),
    synonyms: stringList(source.synonyms),
    searchEnabled: source.searchEnabled === false || source.search_enabled === false ? false : true,
    source: text(source.source, 64) || fallback.source,
    sourceVersion: text(source.sourceVersion ?? source.source_version, 160) || fallback.sourceVersion,
  };
}

function normalizeInput(input: unknown): NormalizedInput {
  const root = record(input);
  const rawPart = record(root.part);
  const code = text(rawPart.code, 80).toUpperCase();
  const name = text(rawPart.name, 180);
  if (!code) throw new PartsKnowledgeValidationError("Для каталогу потрібно вказати part.code.");
  if (!name) throw new PartsKnowledgeValidationError("Для каталогу потрібно вказати part.name.");

  const part: NormalizedPart = {
    code,
    name,
    slug: safeSlug(text(rawPart.slug, 200), code),
    status: catalogStatus(rawPart.status),
    category: text(rawPart.category, 120),
    source: text(rawPart.source, 64) || "CRM_DUAL_WRITE",
    sourceVersion: text(rawPart.sourceVersion, 160) || "v1",
  };

  const rawAliases = Array.isArray(root.aliases) ? root.aliases : [];
  const rawProviderTerms = Array.isArray(root.providerTerms) ? root.providerTerms : [];
  const rawDiagnosticMappings = Array.isArray(root.diagnosticMappings) ? root.diagnosticMappings : [];
  const aliases = dedupeAliases([
    {
      alias: name,
      aliasType: "CANONICAL_NAME",
      language: "uk",
      provider: "",
      axis: "",
      side: "",
      subPosition: "",
      confidence: 100,
      status: part.status,
      source: part.source,
      sourceVersion: part.sourceVersion,
    },
    ...rawAliases.map((value) => aliasFromUnknown(value, "SYNONYM")).filter(Boolean) as NormalizedAlias[],
  ]);

  const providerTerms = dedupeAliases([
    ...rawProviderTerms.map((value) => aliasFromUnknown(value, "PROVIDER_TERM")).filter(Boolean) as NormalizedAlias[],
    ...aliases.filter((value) => value.provider),
  ]).map((value) => ({
    ...value,
    aliasType: "PROVIDER_TERM",
  }));
  const diagnosticMappings = rawDiagnosticMappings
    .map((value) => diagnosticMappingFromUnknown(value, { source: part.source, sourceVersion: part.sourceVersion }))
    .filter(Boolean) as NormalizedDiagnosticMapping[];

  return {
    part,
    aliases: aliases.filter((value) => !value.provider),
    providerTerms,
    diagnosticMappings,
  };
}

function sheetRow(values: Record<string, string>) {
  return values;
}

function buildSheetWrites(input: NormalizedInput): PartsKnowledgeSheetWrite[] {
  const part = input.part;
  const writes: PartsKnowledgeSheetWrite[] = [
    {
      tab: "Parts",
      matchBy: ["code"],
      row: sheetRow({
        code: part.code,
        name: part.name,
        slug: part.slug,
        status: part.status,
        category: part.category,
        source: part.source,
        source_version: part.sourceVersion,
      }),
    },
  ];

  for (const alias of input.aliases) {
    writes.push({
      tab: "Aliases",
      matchBy: ["generic_code", "alias", "provider"],
      row: sheetRow({
        generic_code: part.code,
        alias: alias.alias,
        alias_type: alias.aliasType,
        language: alias.language,
        provider: alias.provider,
        axis: alias.axis,
        side: alias.side,
        sub_position: alias.subPosition,
        confidence: String(alias.confidence),
        status: alias.status,
        source: alias.source,
        source_version: alias.sourceVersion,
      }),
    });
  }

  for (const term of input.providerTerms) {
    writes.push({
      tab: "Provider Terms",
      matchBy: ["generic_code", "provider", "term"],
      row: sheetRow({
        generic_code: part.code,
        provider: term.provider,
        term: term.alias,
        language: term.language,
        axis: term.axis,
        side: term.side,
        sub_position: term.subPosition,
        confidence: String(term.confidence),
        status: term.status,
        source: term.source,
        source_version: term.sourceVersion,
      }),
    });
  }

  for (const mapping of input.diagnosticMappings) {
    writes.push({
      tab: "Diagnostic Mappings",
      matchBy: ["item_code"],
      row: sheetRow({
        item_code: mapping.itemCode,
        section_code: mapping.sectionCode,
        item_name: mapping.itemName,
        canonical_code: mapping.canonicalCode,
        canonical_name: mapping.canonicalName,
        display_name: mapping.displayName,
        axis: mapping.axis,
        side: mapping.side,
        sub_position: mapping.subPosition,
        position: mapping.position,
        category: mapping.category,
        bm_parts_terms: mapping.bmPartsTerms,
        unitrade_terms: mapping.unitradeTerms,
        synonyms: mapping.synonyms,
        search_enabled: String(mapping.searchEnabled),
        source: mapping.source,
        source_version: mapping.sourceVersion,
      }),
    });
  }

  return writes;
}

async function persistToCrm(input: NormalizedInput): Promise<CrmWriteResult> {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.genericArticle.findFirst({
      where: {
        OR: [
          { code: input.part.code },
          { slug: input.part.slug },
        ],
      },
    });

    const article = existing
      ? await tx.genericArticle.update({
        where: { id: existing.id },
        data: {
          code: input.part.code,
          name: input.part.name,
          slug: input.part.slug,
          status: input.part.status,
        },
      })
      : await tx.genericArticle.create({
        data: {
          code: input.part.code,
          name: input.part.name,
          slug: input.part.slug,
          status: input.part.status,
        },
      });

    const upsertAlias = async (alias: NormalizedAlias) => {
      const aliasNormalized = normalizePartTerminology(alias.alias);
      if (!aliasNormalized) return false;
      const current = await tx.genericArticleAlias.findFirst({
        where: {
          genericArticleId: article.id,
          aliasNormalized,
          provider: alias.provider,
        },
        select: { id: true },
      });
      const data = {
        aliasRaw: alias.alias,
        aliasNormalized,
        aliasType: alias.aliasType,
        language: alias.language,
        provider: alias.provider,
        axisHint: alias.axis || null,
        sideHint: alias.side || null,
        subPositionHint: alias.subPosition || null,
        source: alias.source,
        sourceVersion: alias.sourceVersion,
        confidence: alias.confidence,
        status: alias.status,
        isApproved: alias.status === CatalogEntityStatus.ACTIVE,
        lastSeenAt: new Date(),
      };
      if (current) {
        await tx.genericArticleAlias.update({ where: { id: current.id }, data });
      } else {
        await tx.genericArticleAlias.create({
          data: {
            genericArticleId: article.id,
            ...data,
            identityKey: identityKey("DUAL_WRITE", article.id, aliasNormalized, alias.provider),
          },
        });
      }
      return true;
    };

    let aliasesWritten = 0;
    for (const alias of input.aliases) {
      if (await upsertAlias(alias)) aliasesWritten += 1;
    }

    let providerTermsWritten = 0;
    for (const term of input.providerTerms) {
      if (await upsertAlias(term)) providerTermsWritten += 1;
    }

    return {
      articleId: article.id,
      articleCreated: !existing,
      aliasesWritten,
      providerTermsWritten,
    };
  });
}

type DualWriteStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function responseForOperation(
  operation: { id: string; operationKey: string; status: string },
  status: string,
  crm: unknown,
  googleSheets: unknown,
  message?: string,
) {
  return {
    ok: status === "SUCCEEDED" || status === "IN_PROGRESS",
    status,
    operationId: operation.id,
    operationKey: operation.operationKey,
    crm,
    googleSheets,
    ...(message ? { message } : {}),
  };
}

export async function dualWritePartsKnowledge(
  input: PartsKnowledgeDualWriteInput | unknown,
  options?: { operationKey?: unknown },
) {
  const normalized = normalizeInput(input);
  const prisma = getPrisma();
  const operationKey = operationKeyFor(normalized, options?.operationKey);

  let operation = await prisma.partsKnowledgeDualWrite.findUnique({
    where: { operationKey },
    select: { id: true, operationKey: true, status: true, payload: true },
  });

  if (!operation) {
    try {
      operation = await prisma.partsKnowledgeDualWrite.create({
        data: {
          operationKey,
          payload: toPrismaJson(normalized),
          status: "PENDING",
          crmStatus: "PENDING",
          googleSheetsStatus: "PENDING",
        },
        select: { id: true, operationKey: true, status: true, payload: true },
      });
    } catch {
      operation = await prisma.partsKnowledgeDualWrite.findUnique({
        where: { operationKey },
        select: { id: true, operationKey: true, status: true, payload: true },
      });
    }
  }

  if (!operation) throw new Error("Не вдалося створити журнал dual-write операції.");

  if (operation.status === "SUCCEEDED") {
    return responseForOperation(operation, "SUCCEEDED", null, null, "Операція вже виконана; повторний запис не потрібен.");
  }
  if (operation.status === "RUNNING") {
    return responseForOperation(operation, "IN_PROGRESS", null, null, "Операція вже виконується.");
  }

  let effectiveInput = normalized;
  if (operation.payload) {
    try {
      effectiveInput = normalizeInput(operation.payload);
    } catch {
      effectiveInput = normalized;
    }
  }

  await prisma.partsKnowledgeDualWrite.update({
    where: { id: operation.id },
    data: {
      status: "RUNNING",
      crmStatus: "RUNNING",
      googleSheetsStatus: "RUNNING",
      crmError: null,
      googleSheetsError: null,
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
      completedAt: null,
    },
  });

  const [crmResult, googleSheetsResult] = await Promise.allSettled([
    persistToCrm(effectiveInput),
    writePartsKnowledgeToGoogleSheets(buildSheetWrites(effectiveInput)),
  ]);

  const crm = crmResult.status === "fulfilled" ? crmResult.value : null;
  const googleSheets = googleSheetsResult.status === "fulfilled" ? googleSheetsResult.value : null;
  const crmError = crmResult.status === "rejected" ? errorMessage(crmResult.reason) : null;
  const googleSheetsError = googleSheetsResult.status === "rejected" ? errorMessage(googleSheetsResult.reason) : null;
  const finalStatus: DualWriteStatus = crm && googleSheets
    ? "SUCCEEDED"
    : crm || googleSheets
      ? "PARTIAL"
      : "FAILED";

  const updated = await prisma.partsKnowledgeDualWrite.update({
    where: { id: operation.id },
    data: {
      status: finalStatus,
      crmStatus: crm ? "SUCCEEDED" : "FAILED",
      googleSheetsStatus: googleSheets ? "SUCCEEDED" : "FAILED",
      crmError,
      googleSheetsError,
      completedAt: new Date(),
    },
    select: { id: true, operationKey: true, status: true },
  });

  return responseForOperation(
    updated,
    finalStatus,
    crm,
    googleSheets,
    finalStatus === "SUCCEEDED"
      ? "Запис додано до CRM і Google Sheets."
      : "Запис виконано не повністю. Повторіть операцію через RETRY_DUAL_WRITE після усунення помилки.",
  );
}

export async function retryPartsKnowledgeDualWrite(operationId: unknown) {
  const requested = text(operationId, 160);
  if (!requested) throw new PartsKnowledgeValidationError("Потрібно вказати operationId або operationKey.");

  const prisma = getPrisma();
  const operation = await prisma.partsKnowledgeDualWrite.findFirst({
    where: {
      OR: [
        { id: requested },
        { operationKey: requested },
      ],
    },
    select: { id: true, operationKey: true, payload: true },
  });
  if (!operation) throw new PartsKnowledgeValidationError("Dual-write операцію не знайдено.");

  return dualWritePartsKnowledge(operation.payload, { operationKey: operation.operationKey });
}

/**
 * Publishes the complete mechanic vocabulary to both stores. The CRM and the
 * spreadsheet are still written independently for every canonical part, so a
 * temporary outage in either destination is visible as a partial operation.
 */
export async function seedPartsKnowledgeDualWrite() {
  const definitions = listPartTerminology();
  const mappings = listMechanicDiagnosticMappings();
  const results: Array<{ code: string; status: string; operationId?: string }> = [];

  for (const definition of definitions) {
    const providerTerms = [
      ...definition.providerTerms.BM_PARTS.map((term) => ({ term, provider: "BM_PARTS", language: "ru" })),
      ...definition.providerTerms.UNITRADE.map((term) => ({ term, provider: "UNITRADE", language: "uk" })),
    ];
    const diagnosticMappings = mappings
      .filter((mapping) => mapping.code === definition.code)
      .map((mapping) => ({
        itemCode: mapping.itemCode,
        canonicalCode: mapping.code,
        canonicalName: mapping.canonicalName,
        displayName: mapping.displayName,
        axis: mapping.axis,
        side: mapping.side,
        subPosition: mapping.subPosition,
        position: mapping.position,
        category: mapping.category,
        bmPartsTerms: definition.providerTerms.BM_PARTS,
        unitradeTerms: definition.providerTerms.UNITRADE,
        synonyms: definition.aliases,
        searchEnabled: mapping.searchable,
        source: "MECHANIC_DIAGNOSTIC_CATALOG",
        sourceVersion: "v2",
      }));

    const result = await dualWritePartsKnowledge({
      part: {
        code: definition.code,
        name: definition.canonicalName,
        slug: definition.slug,
        category: definition.category,
        source: "MECHANIC_DIAGNOSTIC_CATALOG",
        sourceVersion: "v2",
      },
      aliases: definition.aliases,
      providerTerms,
      diagnosticMappings,
    }, { operationKey: `MECHANIC_DIAGNOSTIC_CATALOG:v2:${definition.code}` });
    results.push({ code: definition.code, status: result.status, operationId: result.operationId });
  }

  return {
    status: results.every((result) => result.status === "SUCCEEDED") ? "SUCCEEDED" : "PARTIAL",
    definitionCount: definitions.length,
    mappingCount: mappings.length,
    operations: results,
  };
}
