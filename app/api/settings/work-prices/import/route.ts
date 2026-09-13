import { NextResponse } from "next/server";
import {
  ServiceCatalogBodySide,
  ServiceCatalogCalculatorOperation,
  ServiceCatalogItemType,
  ServiceCatalogPayrollType,
  ServiceCatalogReviewStatus,
  ServiceCatalogServiceType,
  ServiceCatalogSource,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { applyDuplicateNameReview } from "@/src/services/service-catalog-duplicate-review.service";
import { parseServiceCatalogWorkbook, type ParsedCatalogRow } from "@/src/services/service-catalog-import.service";
import { bodySideLabel, buildServiceSearchAliases, calculatorOperationLabel, normalizeServiceCatalogName } from "@/src/services/service-catalog-name-builder.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sourceEnum(value: "MS_MASTER" | "MANUAL") {
  return value === "MS_MASTER" ? ServiceCatalogSource.MS_MASTER : ServiceCatalogSource.MANUAL;
}
function itemTypeEnum(value: ParsedCatalogRow["itemType"]) { return ServiceCatalogItemType[value]; }
function serviceTypeEnum(value: ParsedCatalogRow["serviceType"]) { return ServiceCatalogServiceType[value]; }
function reviewEnum(value: ParsedCatalogRow["reviewStatus"]) { return ServiceCatalogReviewStatus[value]; }
function payrollEnum(value: ParsedCatalogRow["payrollType"]) { return ServiceCatalogPayrollType[value]; }
function sideEnum(value: ParsedCatalogRow["bodySide"]) { return value ? ServiceCatalogBodySide[value] : null; }
function operationEnum(value: ParsedCatalogRow["calculatorOperation"]) { return value ? ServiceCatalogCalculatorOperation[value] : null; }
function chunks<T>(rows: T[], size = 100) { const result: T[][] = []; for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size)); return result; }

async function serviceCatalogIntegrity(prisma: ReturnType<typeof getPrisma>) {
  const [catalogItems, operationCount, operationLinks, workOrderLinks] = await Promise.all([
    prisma.serviceCatalogItem.findMany({
      select: { id: true, externalServiceId: true },
    }),
    prisma.genericArticleOperation.count(),
    prisma.genericArticleOperation.findMany({
      where: { serviceCatalogItemId: { not: null } },
      select: { id: true, serviceCatalogItemId: true },
    }),
    prisma.workOrderLine.findMany({
      where: { catalogItemId: { not: null } },
      select: { id: true, catalogItemId: true },
    }),
  ]);
  const catalogIds = new Set(catalogItems.map((item) => item.id));
  const codeCounts = new Map<string, number>();
  for (const item of catalogItems) {
    if (item.externalServiceId) codeCounts.set(item.externalServiceId, (codeCounts.get(item.externalServiceId) || 0) + 1);
  }
  const duplicateStableCodes = [...codeCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([externalServiceId, count]) => ({ externalServiceId, count }))
    .sort((left, right) => right.count - left.count || left.externalServiceId.localeCompare(right.externalServiceId))
    .slice(0, 20);
  const brokenOperationLinks = operationLinks.filter((item) => item.serviceCatalogItemId && !catalogIds.has(item.serviceCatalogItemId));
  const brokenWorkOrderLinks = workOrderLinks.filter((item) => item.catalogItemId && !catalogIds.has(item.catalogItemId));
  return {
    catalogItems: catalogItems.length,
    duplicateStableCodes,
    genericArticleOperations: {
      linked: operationLinks.length - brokenOperationLinks.length,
      broken: brokenOperationLinks.length,
      unlinked: Math.max(0, operationCount - operationLinks.length),
    },
    workOrderLines: {
      linked: workOrderLinks.length - brokenWorkOrderLinks.length,
      broken: brokenWorkOrderLinks.length,
    },
  };
}

function naming(row: ParsedCatalogRow, existingAliases: string[] = []) {
  const normalized = normalizeServiceCatalogName({
    sourceName: row.displayName || row.internalName,
    part: row.namePart || row.bodyPart,
    position: row.namePosition,
    side: row.nameSide || bodySideLabel(row.bodySide) || null,
    operation: row.nameOperation || calculatorOperationLabel(row.calculatorOperation) || null,
  });
  const displayName = normalized.displayName || row.displayName || row.internalName;
  const namePart = normalized.part || row.namePart || row.bodyPart || null;
  const namePosition = normalized.position || row.namePosition || null;
  const nameSide = normalized.side || row.nameSide || bodySideLabel(row.bodySide) || null;
  const nameOperation = normalized.operation || row.nameOperation || calculatorOperationLabel(row.calculatorOperation) || null;
  const searchAliases = buildServiceSearchAliases({
    part: namePart,
    position: namePosition,
    side: nameSide,
    operation: nameOperation,
    canonicalCode: normalized.canonicalPartCode || row.canonicalPartCode,
    displayName,
    internalName: row.internalName,
    code: row.code,
    externalServiceId: row.externalServiceId,
    existing: [displayName, row.displayName, ...row.searchAliases, ...existingAliases],
  });
  return { displayName, namePart, namePosition, nameSide, nameOperation, searchAliases };
}

function sampleRow(row: ParsedCatalogRow) {
  return {
    externalServiceId: row.externalServiceId,
    code: row.code,
    internalName: row.internalName,
    displayName: row.displayName,
    namePart: row.namePart,
    namePosition: row.namePosition,
    nameSide: row.nameSide,
    nameOperation: row.nameOperation,
    canonicalPartCode: row.canonicalPartCode,
    category: row.normalizedCategory,
    sourceCategory: row.sourceCategory,
    itemType: row.itemType,
    serviceType: row.serviceType,
    basePrice: row.basePrice,
    normMinutes: row.normMinutes,
    warrantyKm: row.warrantyKm,
    warrantyDays: row.warrantyDays,
    payrollType: row.payrollType,
    bodyPart: row.bodyPart,
    bodySide: row.bodySide,
    calculatorOperation: row.calculatorOperation,
    reviewStatus: row.reviewStatus,
    reviewReason: row.reviewReason,
    sourceRow: row.sourceRow,
  };
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const mode = String(form.get("mode") || "preview");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Оберіть XLSX-файл прайсу." }, { status: 400 });
    if (file.size > 12 * 1024 * 1024) return NextResponse.json({ ok: false, error: "Файл завеликий. Максимум 12 МБ." }, { status: 413 });
    if (!file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ ok: false, error: "Підтримується формат .xlsx." }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = applyDuplicateNameReview(parseServiceCatalogWorkbook(buffer, file.name));
    const prisma = getPrisma();
    const source = sourceEnum(parsed.source);
    const ids = parsed.rows.map((row) => row.externalServiceId);
    // The current production catalog was originally seeded from the legacy
    // Turbo LEV price directory. Match those rows by their stable code too,
    // otherwise an MS Master import would create duplicates and orphan all
    // existing work-order / parts-knowledge links.
    const lookupSources = [...new Set([
      source,
      ServiceCatalogSource.TURBO_LEV_LEGACY,
      ServiceCatalogSource.MANUAL,
    ])];
    const existing = await prisma.serviceCatalogItem.findMany({
      where: { source: { in: lookupSources }, externalServiceId: { in: ids } },
      select: {
        id: true,
        source: true,
        externalServiceId: true,
        isActive: true,
        reviewStatus: true,
        searchAliases: true,
        internalName: true,
        displayName: true,
      },
    });
    const sourcePriority = (item: (typeof existing)[number]) => {
      // Prefer an active legacy row because it is the identity already used
      // by work orders and GenericArticleOperation links.
      if (item.source === ServiceCatalogSource.TURBO_LEV_LEGACY) return 0;
      if (item.source === source) return 1;
      return 2;
    };
    const orderedExisting = [...existing].sort((left, right) =>
      Number(right.isActive) - Number(left.isActive)
      || sourcePriority(left) - sourcePriority(right)
      || left.id.localeCompare(right.id),
    );
    const byExternalId = new Map(orderedExisting.filter((row) => row.externalServiceId).map((row) => [row.externalServiceId as string, row]));
    const legacyMatched = [...byExternalId.values()].filter((row) => row.source === ServiceCatalogSource.TURBO_LEV_LEGACY).length;
    const duplicateCandidates = Math.max(0, existing.length - byExternalId.size);
    const warnings = [...parsed.warnings];
    if (legacyMatched) {
      warnings.push(`Зіставлено ${legacyMatched} чинних позицій Turbo LEV за стабільним кодом; їхні ID та зв’язки будуть збережені.`);
    }
    if (duplicateCandidates) {
      warnings.push(`Для ${duplicateCandidates} кодів знайдено додаткові записи в інших джерелах; вибрано один канонічний запис без видалення дублікатів.`);
    }
    const createCount = parsed.rows.filter((row) => !byExternalId.has(row.externalServiceId)).length;
    const updateCount = parsed.rows.length - createCount;
    const preview = {
      ok: true,
      mode: "preview",
      format: parsed.format,
      source: parsed.source,
      fileName: parsed.fileName,
      sheetName: parsed.sheetName,
      sha256: parsed.sha256,
      stats: { ...parsed.stats, create: createCount, update: updateCount, legacyMatched, duplicateCandidates, autoActivate: 0 },
      warnings,
      rows: parsed.rows.slice(0, 40).map(sampleRow),
    };
    if (mode !== "import") return NextResponse.json(preview);

    const now = new Date();
    const sourceVersion = `${file.name}:${parsed.sha256.slice(0, 12)}`;
    const batch = await prisma.serviceCatalogImportBatch.create({
      data: {
        source,
        fileName: file.name,
        fileSha256: parsed.sha256,
        sourceVersion,
        totalRows: parsed.stats.total,
        readyRows: parsed.stats.ready,
        reviewRows: parsed.stats.needsReview,
        quarantinedRows: parsed.stats.quarantined,
        metadata: toPrismaJson({
          format: parsed.format,
          sheetName: parsed.sheetName,
          warnings,
          stats: parsed.stats,
          reconciliation: { legacyMatched, duplicateCandidates },
        }),
      },
    });

    const newRows = parsed.rows.filter((row) => !byExternalId.has(row.externalServiceId));
    if (newRows.length) {
      await prisma.serviceCatalogItem.createMany({
        data: newRows.map((row) => {
          const name = naming(row);
          return {
            source,
            externalServiceId: row.externalServiceId,
            code: row.code,
            internalName: row.internalName,
            displayName: name.displayName,
            searchAliases: name.searchAliases,
            namePart: name.namePart,
            namePosition: name.namePosition,
            nameSide: name.nameSide,
            nameOperation: name.nameOperation,
            categoryId: row.categoryId,
            sourceCategory: row.sourceCategory || null,
            itemType: itemTypeEnum(row.itemType),
            serviceType: serviceTypeEnum(row.serviceType),
            basePrice: row.basePrice,
            currency: "UAH",
            unit: row.unit,
            defaultQuantity: row.defaultQuantity,
            normMinutes: row.normMinutes,
            complexSurcharge: row.complexSurcharge,
            vehicleCoefficientEnabled: row.vehicleCoefficientEnabled,
            warrantyKm: row.warrantyKm,
            warrantyDays: row.warrantyDays,
            payrollCategory: row.payrollCategory,
            payrollType: payrollEnum(row.payrollType),
            mechanicPercent: row.mechanicPercent,
            mechanicFixedAmount: row.mechanicFixedAmount,
            bodyPart: row.bodyPart,
            bodySide: sideEnum(row.bodySide),
            calculatorOperation: operationEnum(row.calculatorOperation),
            isActive: false,
            showToOperator: false,
            showToClient: false,
            showOnLanding: false,
            reviewStatus: reviewEnum(row.reviewStatus),
            reviewReason: row.reviewReason,
            sourceRow: row.sourceRow,
            sourceVersion,
            originalData: toPrismaJson(row.originalData),
            importBatchId: batch.id,
            importedAt: now,
          };
        }),
      });
    }

    const updateRows = parsed.rows.filter((row) => byExternalId.has(row.externalServiceId));
    for (const group of chunks(updateRows)) {
      await prisma.$transaction(group.map((row) => {
        const current = byExternalId.get(row.externalServiceId)!;
        const unsafe = row.reviewStatus !== "READY";
        const name = naming(row, [
          ...current.searchAliases,
          current.displayName,
          current.internalName,
        ]);
        return prisma.serviceCatalogItem.update({
          where: { id: current.id },
          data: {
            code: row.code,
            internalName: row.internalName,
            displayName: name.displayName,
            searchAliases: name.searchAliases,
            namePart: name.namePart,
            namePosition: name.namePosition,
            nameSide: name.nameSide,
            nameOperation: name.nameOperation,
            categoryId: row.categoryId,
            sourceCategory: row.sourceCategory || null,
            itemType: itemTypeEnum(row.itemType),
            serviceType: serviceTypeEnum(row.serviceType),
            basePrice: row.basePrice,
            unit: row.unit,
            defaultQuantity: row.defaultQuantity,
            normMinutes: row.normMinutes,
            complexSurcharge: row.complexSurcharge,
            vehicleCoefficientEnabled: row.vehicleCoefficientEnabled,
            warrantyKm: row.warrantyKm,
            warrantyDays: row.warrantyDays,
            payrollCategory: row.payrollCategory,
            payrollType: payrollEnum(row.payrollType),
            mechanicPercent: row.mechanicPercent,
            mechanicFixedAmount: row.mechanicFixedAmount,
            bodyPart: row.bodyPart,
            bodySide: sideEnum(row.bodySide),
            calculatorOperation: operationEnum(row.calculatorOperation),
            ...(unsafe ? { isActive: false, showToOperator: false, showToClient: false, showOnLanding: false } : {}),
            reviewStatus: reviewEnum(row.reviewStatus),
            reviewReason: row.reviewReason,
            sourceRow: row.sourceRow,
            sourceVersion,
            originalData: toPrismaJson(row.originalData),
            importBatchId: batch.id,
            importedAt: now,
          },
        });
      }));
    }

    const preservedActive = updateRows.filter((row) => row.reviewStatus === "READY" && byExternalId.get(row.externalServiceId)?.isActive).length;
    await prisma.serviceCatalogImportBatch.update({
      where: { id: batch.id },
      data: { createdRows: createCount, updatedRows: updateCount, activatedRows: preservedActive },
    });

    const integrity = await serviceCatalogIntegrity(prisma);

    return NextResponse.json({
      ...preview,
      mode: "import",
      batchId: batch.id,
      stats: { ...preview.stats, preservedActive, reconciledInPlace: legacyMatched },
      integrity,
      message: `Імпортовано у staging ${parsed.stats.total} позицій: нових ${createCount}, оновлено ${updateCount}; ${legacyMatched} чинних позицій оновлено зі збереженням ID та зв’язків. Нові позиції автоматично не активовано.`,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const message = code === "INVALID_XLSX" ? "Файл не схожий на коректний XLSX."
      : code === "PRICE_SHEET_NOT_FOUND" ? "У XLSX не знайдено аркушів із даними."
      : code === "PRICE_HEADER_NOT_FOUND" ? "Не знайдено структуру МС Мастер або Turbo LEV прайсу."
      : code === "PRICE_EMPTY" ? "У файлі не знайдено позицій прайсу."
      : "Не вдалося імпортувати прайс у Price Catalog 2.0.";
    console.error("service catalog import failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
