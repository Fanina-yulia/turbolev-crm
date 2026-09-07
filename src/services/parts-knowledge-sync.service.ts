import "server-only";

import { createHash } from "node:crypto";
import {
  CatalogEntityStatus,
  CatalogImportRecordState,
  CatalogImportStatus,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { normalizePartTerminology } from "@/src/services/parts-terminology.service";
import {
  getGoogleSheetsKnowledgeConfig,
  readPartsKnowledgeSheets,
  type PartsKnowledgeSheetRow,
} from "@/src/services/parts-knowledge-google-sheets.service";

type ImportCounts = {
  received: number;
  valid: number;
  published: number;
  conflicts: number;
  parts: number;
  aliases: number;
  relations: number;
  operations: number;
  media: number;
  observations: number;
  errors: Array<{ tab: string; row: number; message: string }>;
};

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function rowValue(row: PartsKnowledgeSheetRow, ...keys: string[]) {
  for (const key of keys) {
    const value = text(row[key]);
    if (value) return value;
  }
  return "";
}

function integer(value: string, fallback = 0) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function decimal(value: string, fallback = 1) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function catalogStatus(value: string, fallback = CatalogEntityStatus.DRAFT) {
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

function identityKey(...values: string[]) {
  return createHash("sha256").update(values.join("\u001f")).digest("hex");
}

function jsonValue(value: string) {
  if (!value) return undefined;
  try {
    return toPrismaJson(JSON.parse(value));
  } catch {
    return toPrismaJson({ raw: value });
  }
}

async function articleIdFor(
  tx: Awaited<ReturnType<typeof getPrisma>> extends never ? never : any,
  code: string,
  cache: Map<string, string>,
) {
  const normalizedCode = text(code, 80);
  if (!normalizedCode) throw new Error("Не вказано generic_code.");
  const cached = cache.get(normalizedCode);
  if (cached) return cached;
  const article = await tx.genericArticle.findUnique({
    where: { code: normalizedCode },
    select: { id: true },
  });
  if (!article) throw new Error("Канонічну групу з кодом «" + normalizedCode + "» не знайдено у вкладці Parts.");
  cache.set(normalizedCode, article.id);
  return article.id;
}

export async function syncPartsKnowledgeFromGoogleSheets() {
  const config = getGoogleSheetsKnowledgeConfig();
  if (!config.configured || !config.spreadsheetId) {
    return {
      ok: false as const,
      status: "NOT_CONFIGURED" as const,
      message: config.reason || "Google Sheets не налаштований.",
    };
  }

  const workbook = await readPartsKnowledgeSheets();
  const partRows = workbook.tables.Parts || [];
  if (!partRows.length) {
    return {
      ok: false as const,
      status: "INVALID_TEMPLATE" as const,
      message: "У вкладці Parts немає рядків даних. Потрібен заголовок і хоча б одна канонічна група.",
      spreadsheetId: workbook.spreadsheetId,
      missingTabs: workbook.missingTabs,
      errors: workbook.errors,
    };
  }

  const sourcePayload = JSON.stringify(workbook.tables);
  const checksum = createHash("sha256").update(sourcePayload).digest("hex");
  const prisma = getPrisma();
  const counts: ImportCounts = {
    received: 0,
    valid: 0,
    published: 0,
    conflicts: 0,
    parts: 0,
    aliases: 0,
    relations: 0,
    operations: 0,
    media: 0,
    observations: 0,
    errors: [],
  };

  const batch = await prisma.catalogImportBatch.create({
    data: {
      provider: "GOOGLE_SHEETS",
      scope: "parts-knowledge",
      sourceVersion: workbook.spreadsheetId,
      mode: "UPSERT",
      adapterVersion: "google-sheets-v1",
      schemaVersion: "parts-knowledge-v1",
      checksum,
      status: CatalogImportStatus.RUNNING,
      metadata: toPrismaJson({
        spreadsheetId: workbook.spreadsheetId,
        missingTabs: workbook.missingTabs,
        sourceErrors: workbook.errors,
      }),
    },
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.catalogImportBatch.update({
        where: { id: batch.id },
        data: { status: CatalogImportStatus.VALIDATING },
      });

      const articleIds = new Map<string, string>();

      async function recordRow(
        tab: string,
        rowNumber: number,
        row: PartsKnowledgeSheetRow,
        handler: () => Promise<{ normalized: unknown; state?: CatalogImportRecordState }>,
      ) {
        counts.received += 1;
        const providerRecordKey = tab + ":" + rowNumber;
        try {
          const processed = await handler();
          counts.valid += 1;
          counts.published += processed.state === CatalogImportRecordState.PUBLISHED ? 1 : 0;
          await tx.catalogImportRecord.create({
            data: {
              batchId: batch.id,
              providerRecordKey,
              rawChecksum: identityKey(tab, String(rowNumber), JSON.stringify(row)),
              rawPayload: toPrismaJson({ tab, rowNumber, row }),
              normalizedPayload: toPrismaJson(processed.normalized),
              state: processed.state || CatalogImportRecordState.PUBLISHED,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Невідома помилка імпорту.";
          counts.conflicts += 1;
          counts.errors.push({ tab, row: rowNumber, message });
          await tx.catalogImportRecord.create({
            data: {
              batchId: batch.id,
              providerRecordKey,
              rawChecksum: identityKey(tab, String(rowNumber), JSON.stringify(row)),
              rawPayload: toPrismaJson({ tab, rowNumber, row }),
              state: CatalogImportRecordState.REJECTED,
              errorCodes: toPrismaJson([message]),
            },
          });
        }
      }

      for (let index = 0; index < partRows.length; index += 1) {
        const row = partRows[index];
        await recordRow("Parts", index + 2, row, async () => {
          const code = rowValue(row, "code", "generic_code");
          const name = rowValue(row, "name", "canonical_name");
          if (!code || !name) throw new Error("Parts потребує code і name.");
          const slug = safeSlug(rowValue(row, "slug"), code);
          const status = catalogStatus(rowValue(row, "status"), CatalogEntityStatus.DRAFT);
          const existing = await tx.genericArticle.findFirst({
            where: { OR: [{ code }, { slug }] },
          });
          const article = existing
            ? await tx.genericArticle.update({
                where: { id: existing.id },
                data: {
                  name,
                  ...(existing.code === code ? { slug } : {}),
                  status,
                },
              })
            : await tx.genericArticle.create({
                data: { code, name, slug, status },
              });
          articleIds.set(code, article.id);
          counts.parts += 1;
          return { normalized: { id: article.id, code, name, slug, status } };
        });
      }

      async function importAliasRows(tab: string, rows: PartsKnowledgeSheetRow[], forcedProvider = "") {
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          await recordRow(tab, index + 2, row, async () => {
            const code = rowValue(row, "generic_code", "code");
            const aliasRaw = rowValue(row, "alias", "term", "provider_term");
            if (!aliasRaw) throw new Error("Не вказано alias/term.");
            const genericArticleId = await articleIdFor(tx, code, articleIds);
            const aliasNormalized = normalizePartTerminology(rowValue(row, "alias_normalized") || aliasRaw);
            if (!aliasNormalized) throw new Error("Порожній нормалізований alias.");
            const language = rowValue(row, "language", "lang") || "uk";
            const provider = forcedProvider || rowValue(row, "provider");
            const axisHint = rowValue(row, "axis", "axis_hint") || null;
            const sideHint = rowValue(row, "side", "side_hint") || null;
            const subPositionHint = rowValue(row, "sub_position", "sub_position_hint") || null;
            const key = identityKey("GOOGLE_SHEETS", "ALIAS", genericArticleId, aliasNormalized, language, provider, axisHint || "", sideHint || "", subPositionHint || "");
            const aliasType = forcedProvider ? "PROVIDER_TERM" : rowValue(row, "alias_type", "type") || "SYNONYM";
            const status = catalogStatus(rowValue(row, "status"), CatalogEntityStatus.DRAFT);
            await tx.genericArticleAlias.upsert({
              where: { identityKey: key },
              create: {
                genericArticleId,
                aliasRaw,
                aliasNormalized,
                aliasType,
                language,
                provider,
                axisHint,
                sideHint,
                subPositionHint,
                confidence: Math.min(100, Math.max(0, integer(rowValue(row, "confidence"), forcedProvider ? 90 : 80))),
                status,
                isApproved: status === CatalogEntityStatus.ACTIVE,
                source: rowValue(row, "source") || "GOOGLE_SHEETS",
                sourceVersion: rowValue(row, "source_version", "sourceVersion") || null,
                lastSeenAt: new Date(),
                identityKey: key,
              },
              update: {
                aliasRaw,
                aliasNormalized,
                aliasType,
                language,
                provider,
                axisHint,
                sideHint,
                subPositionHint,
                confidence: Math.min(100, Math.max(0, integer(rowValue(row, "confidence"), forcedProvider ? 90 : 80))),
                sourceVersion: rowValue(row, "source_version", "sourceVersion") || null,
                lastSeenAt: new Date(),
              },
            });
            counts.aliases += 1;
            return { normalized: { genericArticleId, aliasRaw, aliasNormalized, provider, aliasType } };
          });
        }
      }

      await importAliasRows("Aliases", workbook.tables.Aliases || []);
      await importAliasRows("Provider Terms", workbook.tables["Provider Terms"] || [], rowValue({ provider: "" }, "provider"));

      const relationRows = workbook.tables.Relations || [];
      for (let index = 0; index < relationRows.length; index += 1) {
        const row = relationRows[index];
        await recordRow("Relations", index + 2, row, async () => {
          const fromCode = rowValue(row, "from_code", "from_generic_code");
          const toCode = rowValue(row, "to_code", "to_generic_code");
          const relationType = rowValue(row, "relation_type", "type");
          if (!fromCode || !toCode || !relationType) throw new Error("Relations потребує from_code, to_code і relation_type.");
          const fromId = await articleIdFor(tx, fromCode, articleIds);
          const toId = await articleIdFor(tx, toCode, articleIds);
          const source = rowValue(row, "source") || "GOOGLE_SHEETS";
          const key = identityKey("GOOGLE_SHEETS", "RELATION", fromId, toId, relationType, source);
          const status = catalogStatus(rowValue(row, "status"), CatalogEntityStatus.DRAFT);
          await tx.genericArticleRelation.upsert({
            where: { identityKey: key },
            create: {
              fromGenericArticleId: fromId,
              toGenericArticleId: toId,
              relationType,
              confidence: Math.min(100, Math.max(0, integer(rowValue(row, "confidence"), 80))),
              status,
              source,
              sourceVersion: rowValue(row, "source_version", "sourceVersion") || null,
              notes: rowValue(row, "notes") || null,
              identityKey: key,
            },
            update: {
              relationType,
              confidence: Math.min(100, Math.max(0, integer(rowValue(row, "confidence"), 80))),
              status,
              notes: rowValue(row, "notes") || null,
              sourceVersion: rowValue(row, "source_version", "sourceVersion") || null,
            },
          });
          counts.relations += 1;
          return { normalized: { fromId, toId, relationType, source } };
        });
      }

      const operationRows = workbook.tables.Operations || [];
      for (let index = 0; index < operationRows.length; index += 1) {
        const row = operationRows[index];
        await recordRow("Operations", index + 2, row, async () => {
          const code = rowValue(row, "generic_code", "code");
          const operationCode = rowValue(row, "operation_code", "service_code");
          const operationName = rowValue(row, "operation_name", "name");
          if (!code || !operationCode || !operationName) throw new Error("Operations потребує generic_code, operation_code і operation_name.");
          const genericArticleId = await articleIdFor(tx, code, articleIds);
          const serviceCode = rowValue(row, "service_code");
          let serviceCatalogItemId: string | null = null;
          if (serviceCode) {
            const service = await tx.serviceCatalogItem.findFirst({
              where: { OR: [{ code: serviceCode }, { externalServiceId: serviceCode }] },
              select: { id: true },
            });
            serviceCatalogItemId = service?.id || null;
          }
          const source = rowValue(row, "source") || "GOOGLE_SHEETS";
          const key = identityKey("GOOGLE_SHEETS", "OPERATION", genericArticleId, operationCode, serviceCode);
          const status = catalogStatus(rowValue(row, "status"), CatalogEntityStatus.DRAFT);
          await tx.genericArticleOperation.upsert({
            where: { identityKey: key },
            create: {
              genericArticleId,
              operationCode,
              operationName,
              serviceCatalogItemId,
              positionRule: rowValue(row, "position_rule", "position") || null,
              normMinutesOverride: rowValue(row, "norm_minutes", "normMinutes") ? Math.max(0, integer(rowValue(row, "norm_minutes", "normMinutes"))) : null,
              defaultQuantity: decimal(rowValue(row, "default_quantity", "quantity"), 1),
              status,
              source,
              sourceVersion: rowValue(row, "source_version", "sourceVersion") || null,
              notes: rowValue(row, "notes") || null,
              identityKey: key,
            },
            update: {
              operationCode,
              operationName,
              serviceCatalogItemId,
              positionRule: rowValue(row, "position_rule", "position") || null,
              normMinutesOverride: rowValue(row, "norm_minutes", "normMinutes") ? Math.max(0, integer(rowValue(row, "norm_minutes", "normMinutes"))) : null,
              defaultQuantity: decimal(rowValue(row, "default_quantity", "quantity"), 1),
              status,
              sourceVersion: rowValue(row, "source_version", "sourceVersion") || null,
              notes: rowValue(row, "notes") || null,
            },
          });
          counts.operations += 1;
          return { normalized: { genericArticleId, operationCode, serviceCatalogItemId } };
        });
      }

      const mediaRows = workbook.tables.Photos || [];
      for (let index = 0; index < mediaRows.length; index += 1) {
        const row = mediaRows[index];
        await recordRow("Photos", index + 2, row, async () => {
          const code = rowValue(row, "generic_code", "code");
          const mediaType = rowValue(row, "media_type", "type") || "IMAGE";
          const sourceUrl = rowValue(row, "url", "source_url");
          const storageKey = rowValue(row, "storage_key");
          if (!code || (!sourceUrl && !storageKey)) throw new Error("Photos потребує generic_code і url або storage_key.");
          const genericArticleId = await articleIdFor(tx, code, articleIds);
          const source = rowValue(row, "source") || "GOOGLE_SHEETS";
          const contentHash = rowValue(row, "content_hash", "hash") || null;
          const key = identityKey("GOOGLE_SHEETS", "MEDIA", genericArticleId, mediaType, sourceUrl, storageKey, contentHash || "");
          const status = catalogStatus(rowValue(row, "status"), CatalogEntityStatus.DRAFT);
          await tx.genericArticleMedia.upsert({
            where: { identityKey: key },
            create: {
              genericArticleId,
              mediaType,
              status,
              source,
              sourceUrl: sourceUrl || null,
              storageKey: storageKey || null,
              rights: rowValue(row, "rights") || null,
              provenance: toPrismaJson({ spreadsheetId: workbook.spreadsheetId, sourceRow: index + 2 }),
              contentHash,
              altText: rowValue(row, "alt_text", "alt") || null,
              sortOrder: integer(rowValue(row, "sort_order"), 100),
              identityKey: key,
            },
            update: {
              mediaType,
              status,
              sourceUrl: sourceUrl || null,
              storageKey: storageKey || null,
              rights: rowValue(row, "rights") || null,
              contentHash,
              altText: rowValue(row, "alt_text", "alt") || null,
              sortOrder: integer(rowValue(row, "sort_order"), 100),
            },
          });
          counts.media += 1;
          return { normalized: { genericArticleId, mediaType, sourceUrl, storageKey } };
        });
      }

      const observationRows = workbook.tables["Unrecognized Terms"] || [];
      for (let index = 0; index < observationRows.length; index += 1) {
        const row = observationRows[index];
        await recordRow("Unrecognized Terms", index + 2, row, async () => {
          const rawTerm = rowValue(row, "raw_term", "term");
          const normalizedTerm = normalizePartTerminology(rowValue(row, "normalized_term") || rawTerm);
          if (!rawTerm || !normalizedTerm) throw new Error("Unrecognized Terms потребує raw_term.");
          const suggestedCode = rowValue(row, "suggested_code", "generic_code");
          const suggestedGenericArticleId = suggestedCode ? await articleIdFor(tx, suggestedCode, articleIds) : null;
          const source = rowValue(row, "source") || "GOOGLE_SHEETS";
          const key = identityKey("GOOGLE_SHEETS", "OBSERVATION", normalizedTerm, source);
          await tx.partTermObservation.upsert({
            where: { identityKey: key },
            create: {
              rawTerm,
              normalizedTerm,
              suggestedGenericArticleId,
              status: rowValue(row, "status") || "NEW",
              source,
              metadata: jsonValue(rowValue(row, "metadata_json", "metadata")),
              lastSeenAt: new Date(),
              identityKey: key,
            },
            update: {
              rawTerm,
              normalizedTerm,
              suggestedGenericArticleId,
              status: rowValue(row, "status") || "NEW",
              metadata: jsonValue(rowValue(row, "metadata_json", "metadata")),
              lastSeenAt: new Date(),
            },
          });
          counts.observations += 1;
          return { normalized: { rawTerm, normalizedTerm, suggestedGenericArticleId } };
        });
      }

      await tx.catalogImportBatch.update({
        where: { id: batch.id },
        data: {
          status: counts.errors.length ? CatalogImportStatus.PUBLISHED : CatalogImportStatus.PUBLISHED,
          finishedAt: new Date(),
          recordsReceived: counts.received,
          recordsValid: counts.valid,
          recordsPublished: counts.published,
          recordsConflict: counts.conflicts,
          errorSummary: counts.errors.length ? counts.errors.slice(0, 20).map((item) => item.tab + "!" + item.row + ": " + item.message).join("\n") : null,
          metadata: toPrismaJson({
            spreadsheetId: workbook.spreadsheetId,
            missingTabs: workbook.missingTabs,
            sourceErrors: workbook.errors,
            counts,
          }),
        },
      });

      return { ...counts };
    });

    return {
      ok: true as const,
      status: "PUBLISHED" as const,
      batchId: batch.id,
      spreadsheetId: workbook.spreadsheetId,
      missingTabs: workbook.missingTabs,
      sourceErrors: workbook.errors,
      counts: result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Імпорт каталогу завершився помилкою.";
    await prisma.catalogImportBatch.update({
      where: { id: batch.id },
      data: {
        status: CatalogImportStatus.FAILED,
        finishedAt: new Date(),
        errorSummary: message,
        recordsReceived: counts.received,
        recordsValid: counts.valid,
        recordsPublished: counts.published,
        recordsConflict: counts.conflicts,
      },
    }).catch(() => undefined);
    return {
      ok: false as const,
      status: "FAILED" as const,
      batchId: batch.id,
      message,
      counts,
    };
  }
}

export async function getPartsKnowledgeStats() {
  const prisma = getPrisma();
  const [
    articles,
    activeArticles,
    aliases,
    activeAliases,
    providerTerms,
    relations,
    operations,
    media,
    newObservations,
    latestBatch,
  ] = await Promise.all([
    prisma.genericArticle.count(),
    prisma.genericArticle.count({ where: { status: CatalogEntityStatus.ACTIVE } }),
    prisma.genericArticleAlias.count(),
    prisma.genericArticleAlias.count({ where: { status: CatalogEntityStatus.ACTIVE } }),
    prisma.genericArticleAlias.count({ where: { aliasType: "PROVIDER_TERM", status: CatalogEntityStatus.ACTIVE } }),
    prisma.genericArticleRelation.count({ where: { status: CatalogEntityStatus.ACTIVE } }),
    prisma.genericArticleOperation.count({ where: { status: CatalogEntityStatus.ACTIVE } }),
    prisma.genericArticleMedia.count({ where: { status: CatalogEntityStatus.ACTIVE } }),
    prisma.partTermObservation.count({ where: { status: "NEW" } }),
    prisma.catalogImportBatch.findFirst({ where: { provider: "GOOGLE_SHEETS" }, orderBy: { createdAt: "desc" } }),
  ]);
  return {
    articles,
    activeArticles,
    aliases,
    activeAliases,
    providerTerms,
    relations,
    operations,
    media,
    newObservations,
    latestBatch,
  };
}
