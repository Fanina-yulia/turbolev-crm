import { createHash } from "node:crypto";
import { CatalogEntityStatus, PartCatalogReviewStatus, PartSoldAs } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { normalizePartTerminology, resolvePartTerminology } from "@/src/services/parts-terminology.service";
import { getPartPackageRule } from "@/src/services/part-operation-catalog.service";

export type CatalogPartAttributes = {
  axis?: string | null;
  side?: string | null;
  position?: string | null;
  subPosition?: string | null;
  quantityPerVehicle?: number | null;
  soldAs?: string | null;
  requiresVin?: boolean | null;
};

export type CatalogQueryPlan = {
  canonicalCode: string | null;
  canonicalName: string;
  provider: "BM_PARTS" | "UNITRADE" | null;
  queries: string[];
  reason: string[];
  attributes: CatalogPartAttributes;
};

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function identity(...values: string[]) {
  return createHash("sha256").update(values.join("\u001f")).digest("hex");
}

function safeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = clean(value, 32).toUpperCase() as T;
  return allowed.includes(normalized) ? normalized : fallback;
}

const soldAsValues = ["PIECE", "PAIR", "SET", "KIT", "ASSEMBLY", "LITER", "UNKNOWN"] as const;

export function buildPartQueryPlan(input: {
  query?: string | null;
  partName?: string | null;
  canonicalCode?: string | null;
  provider?: "BM_PARTS" | "UNITRADE" | null;
  attributes?: CatalogPartAttributes;
}): CatalogQueryPlan {
  const terminology = resolvePartTerminology({
    query: input.query,
    partName: input.partName,
    canonicalCode: input.canonicalCode,
    axis: input.attributes?.axis,
    side: input.attributes?.side,
    position: input.attributes?.position,
    subPosition: input.attributes?.subPosition,
  });
  const definition = terminology.definition;
  const canonicalName = definition?.canonicalName || clean(input.partName) || clean(input.query) || "Деталь";
  const providerTerms = input.provider && definition?.providerTerms?.[input.provider]
    ? definition.providerTerms[input.provider]
    : [];
  const normalizedProviderTerms = providerTerms || [];
  const attributes = input.attributes || {};
  const positionTerms = [attributes.axis, attributes.side, attributes.position, attributes.subPosition]
    .map((value) => clean(value, 32))
    .filter(Boolean);
  const queries = unique([
    clean(input.query),
    clean(input.partName),
    canonicalName,
    ...normalizedProviderTerms,
    ...(definition?.aliases || []),
  ]).map((query) => positionTerms.length ? `${query} ${positionTerms.join(" ")}` : query);
  const reason = [
    definition ? `Канонічна деталь: ${definition.code}` : "Назву не знайдено в канонічному каталозі",
    input.provider ? `Терміни постачальника: ${input.provider}` : "Застосовано загальні терміни",
    attributes.axis ? `Вісь: ${attributes.axis}` : "Вісь не задана",
    attributes.side ? `Сторона: ${attributes.side}` : "Сторона не задана",
  ];
  return { canonicalCode: definition?.code || clean(input.canonicalCode) || null, canonicalName, provider: input.provider || null, queries: queries.slice(0, 24), reason, attributes };
}

export function validatePartSelection(input: {
  expected?: CatalogPartAttributes;
  selected?: CatalogPartAttributes;
  canonicalCode?: string | null;
  quantity?: number;
  available?: number | null;
}) {
  const expected = input.expected || {};
  const selected = input.selected || {};
  const warnings: string[] = [];
  const errors: string[] = [];
  for (const key of ["axis", "side", "position", "subPosition"] as const) {
    if (expected[key] && selected[key] && expected[key] !== selected[key]) {
      errors.push(`Невідповідність ${key}: очікується ${expected[key]}, вибрано ${selected[key]}.`);
    }
  }
  const quantity = Number(input.quantity || 1);
  if (!Number.isFinite(quantity) || quantity <= 0) errors.push("Кількість повинна бути більшою за нуль.");
  if (input.available != null && Number.isFinite(input.available) && quantity > input.available) {
    warnings.push(`Доступно лише ${input.available}, а вибрано ${quantity}.`);
  }
  if (selected.soldAs === "PAIR" && quantity === 1) warnings.push("Позиція продається парою. Перевірте кількість.");
  if (selected.soldAs === "SET" || selected.soldAs === "KIT") warnings.push("Позиція продається комплектом.");
  const packageRule = getPartPackageRule({ canonicalCode: input.canonicalCode, axis: expected.axis, side: expected.side, position: expected.position, subPosition: expected.subPosition, soldAs: selected.soldAs });
  if (packageRule.soldAs === "SET" && packageRule.coverage === "AXLE" && packageRule.priceBasis === "PER_WHEEL") {
    warnings.push("Це комплект на вісь: ціна постачальника за одне колесо буде помножена на 2.");
  }
  if (packageRule.soldAs === "LITER") warnings.push("Для рідини потрібно окремо підтвердити обсяг у літрах.");
  return { ok: errors.length === 0, errors, warnings };
}

export async function listCatalogParts(input: { query?: string; status?: string; limit?: number } = {}) {
  const prisma = getPrisma();
  const query = clean(input.query, 120);
  const statuses = input.status ? [safeEnum(input.status, Object.values(CatalogEntityStatus), CatalogEntityStatus.ACTIVE)] : [CatalogEntityStatus.ACTIVE, CatalogEntityStatus.DRAFT];
  const rows = await prisma.genericArticle.findMany({
    where: {
      status: { in: statuses },
      ...(query ? { OR: [{ code: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }, { aliases: { some: { aliasRaw: { contains: query, mode: "insensitive" } } } }] } : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    take: Math.min(100, Math.max(1, Number(input.limit || 50))),
    include: { aliases: { where: { status: CatalogEntityStatus.ACTIVE }, take: 30 }, relationsFrom: { where: { status: CatalogEntityStatus.ACTIVE }, take: 30 }, operations: { where: { status: CatalogEntityStatus.ACTIVE }, take: 20 }, kitItems: true },
  });
  return rows;
}

export async function createCatalogChange(input: { entityType: string; entityId: string; action: string; genericArticleId?: string | null; beforeData?: unknown; afterData?: unknown; reason?: string | null; requestedByUserId?: string | null; requestedByName?: string | null }) {
  const prisma = getPrisma();
  return prisma.partCatalogChange.create({ data: { entityType: clean(input.entityType, 64), entityId: clean(input.entityId, 128), action: clean(input.action, 64), genericArticleId: input.genericArticleId || null, beforeData: input.beforeData as never, afterData: input.afterData as never, reason: clean(input.reason, 1200) || null, requestedByUserId: clean(input.requestedByUserId, 128) || null, requestedByName: clean(input.requestedByName, 160) || null } });
}

export async function recordSearchFeedback(input: { genericArticleId?: string | null; vehicleId?: string | null; query: string; provider?: string | null; selectedArticle?: string | null; selectedBrand?: string | null; resultStatus: string; reason?: string | null; metadata?: unknown; createdByUserId?: string | null; createdByName?: string | null }) {
  const prisma = getPrisma();
  const row = await prisma.partSearchFeedback.create({ data: { genericArticleId: input.genericArticleId || null, vehicleId: input.vehicleId || null, query: clean(input.query), provider: clean(input.provider, 64) || null, selectedArticle: clean(input.selectedArticle, 180) || null, selectedBrand: clean(input.selectedBrand, 120) || null, resultStatus: clean(input.resultStatus, 40), reason: clean(input.reason, 1200) || null, metadata: input.metadata as never, createdByUserId: clean(input.createdByUserId, 128) || null, createdByName: clean(input.createdByName, 160) || null } });
  if (input.genericArticleId && input.resultStatus === "SELECTED") await prisma.genericArticle.update({ where: { id: input.genericArticleId }, data: { successfulMatchCount: { increment: 1 } } });
  return row;
}

export async function seedRepairKits() {
  const prisma = getPrisma();
  const kitDefinitions = [
    { code: "BRAKE_FRONT_SERVICE", name: "Комплект обслуговування передніх гальм", items: [{ code: "BRAKE_DISC", quantity: 2, required: true }, { code: "BRAKE_PAD", quantity: 1, required: true }, { code: "BRAKE_CALIPER", quantity: 1, required: false }] },
    { code: "TIMING_BELT_SERVICE", name: "Комплект заміни ременя ГРМ", items: [{ code: "TIMING_BELT", quantity: 1, required: true }, { code: "TIMING_TENSIONER", quantity: 1, required: true }, { code: "WATER_PUMP", quantity: 1, required: false }, { code: "COOLANT", quantity: 1, required: false }] },
    { code: "CLUTCH_SERVICE", name: "Комплект заміни зчеплення", items: [{ code: "CLUTCH_KIT", quantity: 1, required: true }, { code: "CLUTCH_RELEASE_BEARING", quantity: 1, required: false }] },
  ];
  let kits = 0;
  for (const definition of kitDefinitions) {
    const articles = await prisma.genericArticle.findMany({ where: { code: { in: definition.items.map((item) => item.code) } }, select: { id: true, code: true } });
    if (!articles.length) continue;
    const kit = await prisma.repairKit.upsert({ where: { code: definition.code }, update: { name: definition.name, status: CatalogEntityStatus.ACTIVE, reviewStatus: PartCatalogReviewStatus.APPROVED }, create: { code: definition.code, name: definition.name, status: CatalogEntityStatus.ACTIVE, reviewStatus: PartCatalogReviewStatus.APPROVED, source: "CATALOG_SEED" } });
    for (const item of definition.items) {
      const article = articles.find((row) => row.code === item.code);
      if (!article) continue;
      await prisma.repairKitItem.upsert({ where: { repairKitId_genericArticleId: { repairKitId: kit.id, genericArticleId: article.id } }, update: { quantity: item.quantity, required: item.required }, create: { repairKitId: kit.id, genericArticleId: article.id, quantity: item.quantity, required: item.required } });
    }
    kits += 1;
  }
  return { kits };
}

export function normalizeCatalogArticleInput(input: Record<string, unknown>) {
  const code = clean(input.code, 80).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const name = clean(input.name, 180);
  if (!code || !name) throw new Error("Потрібні code та name.");
  return { code, name, slug: clean(input.slug, 200) || normalizePartTerminology(name).replace(/\s+/g, "-"), categoryCode: clean(input.categoryCode, 80) || null, assembly: clean(input.assembly, 120) || null, partType: clean(input.partType, 120) || null, axis: clean(input.axis, 16) || null, side: clean(input.side, 16) || null, position: clean(input.position, 32) || null, subPosition: clean(input.subPosition, 32) || null, quantityPerVehicle: Number(input.quantityPerVehicle || 1), soldAs: safeEnum(input.soldAs, soldAsValues, PartSoldAs.UNKNOWN), requiresVin: input.requiresVin !== false, confidence: Math.max(0, Math.min(100, Number(input.confidence || 0))) };
}
