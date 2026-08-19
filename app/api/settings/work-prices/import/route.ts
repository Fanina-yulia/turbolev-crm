import { NextResponse } from "next/server";
import {
  ServiceCatalogBodySide,
  ServiceCatalogCalculatorOperation,
  ServiceCatalogItemType,
  ServiceCatalogPayrollType,
  ServiceCatalogReviewStatus,
  ServiceCatalogSource,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { parseServiceCatalogWorkbook, type ParsedCatalogRow } from "@/src/services/service-catalog-import.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sourceEnum(value: "MS_MASTER" | "MANUAL") {
  return value === "MS_MASTER" ? ServiceCatalogSource.MS_MASTER : ServiceCatalogSource.MANUAL;
}
function itemTypeEnum(value: ParsedCatalogRow["itemType"]) { return ServiceCatalogItemType[value]; }
function reviewEnum(value: ParsedCatalogRow["reviewStatus"]) { return ServiceCatalogReviewStatus[value]; }
function payrollEnum(value: ParsedCatalogRow["payrollType"]) { return ServiceCatalogPayrollType[value]; }
function sideEnum(value: ParsedCatalogRow["bodySide"]) { return value ? ServiceCatalogBodySide[value] : null; }
function operationEnum(value: ParsedCatalogRow["calculatorOperation"]) { return value ? ServiceCatalogCalculatorOperation[value] : null; }
function chunks<T>(rows: T[], size = 100) { const result: T[][] = []; for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size)); return result; }

function sampleRow(row: ParsedCatalogRow) {
  return {
    externalServiceId: row.externalServiceId,
    code: row.code,
    internalName: row.internalName,
    displayName: row.displayName,
    category: row.normalizedCategory,
    sourceCategory: row.sourceCategory,
    itemType: row.itemType,
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
    const parsed = parseServiceCatalogWorkbook(buffer, file.name);
    const prisma = getPrisma();
    const source = sourceEnum(parsed.source);
    const ids = parsed.rows.map((row) => row.externalServiceId);
    const existing = await prisma.serviceCatalogItem.findMany({
      where: { source, externalServiceId: { in: ids } },
      select: { id: true, externalServiceId: true, isActive: true, reviewStatus: true },
    });
    const byExternalId = new Map(existing.filter((row) => row.externalServiceId).map((row) => [row.externalServiceId as string, row]));
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
      stats: { ...parsed.stats, create: createCount, update: updateCount, autoActivate: 0 },
      warnings: parsed.warnings,
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
        metadata: toPrismaJson({ format: parsed.format, sheetName: parsed.sheetName, warnings: parsed.warnings, stats: parsed.stats }),
      },
    });

    const newRows = parsed.rows.filter((row) => !byExternalId.has(row.externalServiceId));
    if (newRows.length) {
      await prisma.serviceCatalogItem.createMany({
        data: newRows.map((row) => ({
          source,
          externalServiceId: row.externalServiceId,
          code: row.code,
          internalName: row.internalName,
          displayName: row.displayName,
          searchAliases: row.searchAliases,
          categoryId: row.categoryId,
          sourceCategory: row.sourceCategory || null,
          itemType: itemTypeEnum(row.itemType),
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
        })),
      });
    }

    const updateRows = parsed.rows.filter((row) => byExternalId.has(row.externalServiceId));
    for (const group of chunks(updateRows)) {
      await prisma.$transaction(group.map((row) => {
        const current = byExternalId.get(row.externalServiceId)!;
        const unsafe = row.reviewStatus !== "READY";
        return prisma.serviceCatalogItem.update({
          where: { id: current.id },
          data: {
            code: row.code,
            internalName: row.internalName,
            displayName: row.displayName,
            searchAliases: row.searchAliases,
            categoryId: row.categoryId,
            sourceCategory: row.sourceCategory || null,
            itemType: itemTypeEnum(row.itemType),
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

    return NextResponse.json({
      ...preview,
      mode: "import",
      batchId: batch.id,
      stats: { ...preview.stats, preservedActive },
      message: `Імпортовано у staging ${parsed.stats.total} позицій: нових ${createCount}, оновлено ${updateCount}. Автоматично не активовано жодної нової позиції.`,
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
