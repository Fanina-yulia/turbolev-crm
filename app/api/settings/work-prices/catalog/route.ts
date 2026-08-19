import { NextRequest, NextResponse } from "next/server";
import {
  ServiceCatalogItemType,
  ServiceCatalogReviewStatus,
  ServiceCatalogSource,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { buildServiceDisplayName, buildServiceSearchAliases } from "@/src/services/service-catalog-name-builder.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SOURCES = new Set(Object.values(ServiceCatalogSource));
const STATUSES = new Set(Object.values(ServiceCatalogReviewStatus));
const TYPES = new Set(Object.values(ServiceCatalogItemType));
const NAME_FIELDS = ["namePart", "namePosition", "nameSide", "nameOperation"] as const;

function text(value: unknown, max = 2000) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function numberOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function integerOrNull(value: unknown) { const n = numberOrNull(value); return n == null ? null : Math.max(0, Math.round(n)); }
function booleanParam(value: string | null) { return value === "true" ? true : value === "false" ? false : null; }
function pageInt(value: string | null, fallback: number, max: number) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(1, Math.floor(n))) : fallback; }
function has(body: Record<string, unknown>, field: string) { return Object.prototype.hasOwnProperty.call(body, field); }
function optionalText(body: Record<string, unknown>, field: string, current: string | null, max: number) {
  return has(body, field) ? text(body[field], max) || null : current;
}

export async function GET(request: NextRequest) {
  const prisma = getPrisma();
  const params = request.nextUrl.searchParams;
  const q = text(params.get("q"), 120);
  const sourceRaw = params.get("source") || "";
  const statusRaw = params.get("status") || "";
  const typeRaw = params.get("itemType") || "";
  const categoryId = text(params.get("categoryId"), 80);
  const active = booleanParam(params.get("active"));
  const page = pageInt(params.get("page"), 1, 100000);
  const limit = pageInt(params.get("limit"), 50, 100);
  const source = SOURCES.has(sourceRaw as ServiceCatalogSource) ? sourceRaw as ServiceCatalogSource : null;
  const reviewStatus = STATUSES.has(statusRaw as ServiceCatalogReviewStatus) ? statusRaw as ServiceCatalogReviewStatus : null;
  const itemType = TYPES.has(typeRaw as ServiceCatalogItemType) ? typeRaw as ServiceCatalogItemType : null;

  const where = {
    ...(source ? { source } : {}),
    ...(reviewStatus ? { reviewStatus } : {}),
    ...(itemType ? { itemType } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(active != null ? { isActive: active } : {}),
    ...(q ? {
      OR: [
        { code: { contains: q, mode: "insensitive" as const } },
        { externalServiceId: { contains: q, mode: "insensitive" as const } },
        { internalName: { contains: q, mode: "insensitive" as const } },
        { displayName: { contains: q, mode: "insensitive" as const } },
        { searchAliases: { has: q } },
        { namePart: { contains: q, mode: "insensitive" as const } },
        { namePosition: { contains: q, mode: "insensitive" as const } },
        { nameSide: { contains: q, mode: "insensitive" as const } },
        { nameOperation: { contains: q, mode: "insensitive" as const } },
        { sourceCategory: { contains: q, mode: "insensitive" as const } },
        { bodyPart: { contains: q, mode: "insensitive" as const } },
        { category: { is: { name: { contains: q, mode: "insensitive" as const } } } },
      ],
    } : {}),
  };

  try {
    const [items, count, categories, total, activeCount, readyCount, reviewCount, quarantineCount, msMasterCount, latestBatch] = await Promise.all([
      prisma.serviceCatalogItem.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { category: { sortOrder: "asc" } }, { displayName: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        include: { category: { select: { id: true, name: true, slug: true } } },
      }),
      prisma.serviceCatalogItem.count({ where }),
      prisma.serviceCatalogCategory.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, slug: true } }),
      prisma.serviceCatalogItem.count(),
      prisma.serviceCatalogItem.count({ where: { isActive: true } }),
      prisma.serviceCatalogItem.count({ where: { reviewStatus: ServiceCatalogReviewStatus.READY } }),
      prisma.serviceCatalogItem.count({ where: { reviewStatus: ServiceCatalogReviewStatus.NEEDS_REVIEW } }),
      prisma.serviceCatalogItem.count({ where: { reviewStatus: ServiceCatalogReviewStatus.QUARANTINED } }),
      prisma.serviceCatalogItem.count({ where: { source: ServiceCatalogSource.MS_MASTER } }),
      prisma.serviceCatalogImportBatch.findFirst({ orderBy: { createdAt: "desc" } }),
    ]);

    return NextResponse.json({
      ok: true,
      page,
      limit,
      count,
      pages: Math.max(1, Math.ceil(count / limit)),
      counts: { total, active: activeCount, ready: readyCount, review: reviewCount, quarantine: quarantineCount, msMaster: msMasterCount },
      categories,
      latestBatch,
      items: items.map((item) => ({
        ...item,
        basePrice: item.basePrice?.toString() ?? null,
        defaultQuantity: item.defaultQuantity.toString(),
        complexSurcharge: item.complexSurcharge?.toString() ?? null,
        mechanicPercent: item.mechanicPercent?.toString() ?? null,
        mechanicFixedAmount: item.mechanicFixedAmount?.toString() ?? null,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("service catalog GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити Price Catalog 2.0." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const prisma = getPrisma();
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = text(body.id, 128);
    if (!id) return NextResponse.json({ ok: false, error: "Не вказана позиція каталогу." }, { status: 400 });
    const before = await prisma.serviceCatalogItem.findUnique({ where: { id }, include: { category: true } });
    if (!before) return NextResponse.json({ ok: false, error: "Позицію каталогу не знайдено." }, { status: 404 });

    const nextTypeRaw = text(body.itemType, 40);
    const nextStatusRaw = text(body.reviewStatus, 40);
    const nextType = nextTypeRaw && TYPES.has(nextTypeRaw as ServiceCatalogItemType) ? nextTypeRaw as ServiceCatalogItemType : before.itemType;
    const nextStatus = nextStatusRaw && STATUSES.has(nextStatusRaw as ServiceCatalogReviewStatus) ? nextStatusRaw as ServiceCatalogReviewStatus : before.reviewStatus;
    const nextInternalName = has(body, "internalName") ? text(body.internalName, 1000) : before.internalName;
    const namePart = optionalText(body, "namePart", before.namePart, 180);
    const namePosition = optionalText(body, "namePosition", before.namePosition, 180);
    const nameSide = optionalText(body, "nameSide", before.nameSide, 40);
    const nameOperation = optionalText(body, "nameOperation", before.nameOperation, 180);
    const builderTouched = NAME_FIELDS.some((field) => has(body, field));
    const generatedDisplayName = buildServiceDisplayName({ part: namePart, position: namePosition, side: nameSide, operation: nameOperation });
    const explicitDisplayName = has(body, "displayName") ? text(body.displayName, 1000) : before.displayName;
    const nextDisplayName = builderTouched && generatedDisplayName ? generatedDisplayName : explicitDisplayName;
    const nextPrice = has(body, "basePrice") ? numberOrNull(body.basePrice) : before.basePrice == null ? null : Number(before.basePrice);
    const nextCategoryId = has(body, "categoryId") ? text(body.categoryId, 80) || null : before.categoryId;
    const wantsActive = has(body, "isActive") ? Boolean(body.isActive) : before.isActive;

    if (!nextDisplayName || !nextInternalName) return NextResponse.json({ ok: false, error: "Назва позиції не може бути порожньою." }, { status: 400 });
    if (wantsActive) {
      if (nextStatus !== ServiceCatalogReviewStatus.READY) return NextResponse.json({ ok: false, error: "Активувати можна лише позицію зі статусом READY." }, { status: 409 });
      if (!nextCategoryId) return NextResponse.json({ ok: false, error: "Перед активацією вкажіть категорію." }, { status: 409 });
      if (nextType !== ServiceCatalogItemType.INFORMATION && nextType !== ServiceCatalogItemType.CHECKLIST && nextPrice == null) return NextResponse.json({ ok: false, error: "Перед активацією вкажіть базову ціну." }, { status: 409 });
    }

    const namingChanged = builderTouched || has(body, "displayName") || has(body, "internalName");
    const searchAliases = namingChanged ? buildServiceSearchAliases({
      part: namePart,
      position: namePosition,
      side: nameSide,
      operation: nameOperation,
      displayName: nextDisplayName,
      internalName: nextInternalName,
      code: before.code,
      externalServiceId: before.externalServiceId,
      existing: before.searchAliases,
    }) : before.searchAliases;

    const data = {
      ...(namingChanged ? { displayName: nextDisplayName, internalName: nextInternalName, searchAliases } : {}),
      ...(builderTouched ? { namePart, namePosition, nameSide, nameOperation } : {}),
      ...(has(body, "basePrice") ? { basePrice: nextPrice } : {}),
      ...(has(body, "normMinutes") ? { normMinutes: integerOrNull(body.normMinutes) } : {}),
      ...(has(body, "categoryId") ? { categoryId: nextCategoryId } : {}),
      ...(has(body, "itemType") ? { itemType: nextType } : {}),
      ...(has(body, "warrantyKm") ? { warrantyKm: integerOrNull(body.warrantyKm) } : {}),
      ...(has(body, "warrantyDays") ? { warrantyDays: integerOrNull(body.warrantyDays) } : {}),
      ...(has(body, "reviewStatus") ? { reviewStatus: nextStatus } : {}),
      ...(has(body, "reviewReason") ? { reviewReason: text(body.reviewReason, 2000) || null } : {}),
      ...(has(body, "isActive") ? { isActive: wantsActive, showToOperator: wantsActive } : {}),
      ...(has(body, "showToClient") ? { showToClient: Boolean(body.showToClient) && wantsActive } : {}),
      ...(has(body, "vehicleCoefficientEnabled") ? { vehicleCoefficientEnabled: Boolean(body.vehicleCoefficientEnabled) } : {}),
    };

    const after = await prisma.serviceCatalogItem.update({ where: { id }, data, include: { category: true } });
    await prisma.auditEvent.create({ data: { actorName: "CRM / Налаштування прайсу", entityType: "ServiceCatalogItem", entityId: id, action: "CATALOG_ITEM_UPDATED", before: toPrismaJson(before), after: toPrismaJson(after) } });
    return NextResponse.json({ ok: true, item: { ...after, basePrice: after.basePrice?.toString() ?? null } });
  } catch (error) {
    console.error("service catalog PATCH failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося оновити позицію каталогу." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const prisma = getPrisma();
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = text(body.action, 40).toUpperCase();
    if (action === "ACTIVATE_READY") {
      const sourceRaw = text(body.source, 40);
      const source = SOURCES.has(sourceRaw as ServiceCatalogSource) ? sourceRaw as ServiceCatalogSource : null;
      const where = {
        reviewStatus: ServiceCatalogReviewStatus.READY,
        isActive: false,
        ...(source ? { source } : {}),
      };
      const result = await prisma.serviceCatalogItem.updateMany({ where, data: { isActive: true, showToOperator: true } });
      await prisma.auditEvent.create({ data: { actorName: "CRM / Налаштування прайсу", entityType: "ServiceCatalog", entityId: source || "ALL", action: "ACTIVATE_READY", after: toPrismaJson({ count: result.count, source }) } });
      return NextResponse.json({ ok: true, count: result.count, message: `Активовано ${result.count} перевірених позицій.` });
    }
    if (action === "SET_ACTIVE") {
      const ids = Array.isArray(body.ids) ? body.ids.map((id) => text(id, 128)).filter(Boolean).slice(0, 100) : [];
      const active = Boolean(body.active);
      if (!ids.length) return NextResponse.json({ ok: false, error: "Не вибрано позиції." }, { status: 400 });
      if (active) {
        const invalid = await prisma.serviceCatalogItem.count({ where: { id: { in: ids }, reviewStatus: { not: ServiceCatalogReviewStatus.READY } } });
        if (invalid) return NextResponse.json({ ok: false, error: "Серед вибраних позицій є неперевірені. Спочатку переведіть їх у READY." }, { status: 409 });
      }
      const result = await prisma.serviceCatalogItem.updateMany({ where: { id: { in: ids } }, data: { isActive: active, showToOperator: active, ...(active ? {} : { showToClient: false, showOnLanding: false }) } });
      return NextResponse.json({ ok: true, count: result.count });
    }
    return NextResponse.json({ ok: false, error: "Невідома дія каталогу." }, { status: 400 });
  } catch (error) {
    console.error("service catalog POST failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося виконати дію з каталогом." }, { status: 500 });
  }
}
