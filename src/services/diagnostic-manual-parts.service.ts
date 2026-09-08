import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

const ACTIVE_STATUS = "DRAFT";
const CANCELLED_STATUS = "CANCELLED";
const SOURCE = "MANUAL_CRM";
const LINE_SOURCE = "DIAGNOSTIC_MANUAL_PART";

export class DiagnosticManualPartError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "DiagnosticManualPartError";
    this.code = code;
    this.status = status;
  }
}

export type DiagnosticManualPartInput = {
  name?: unknown;
  article?: unknown;
  brand?: unknown;
  position?: unknown;
  genericArticleId?: unknown;
  catalogCode?: unknown;
  quantity?: unknown;
  note?: unknown;
  findingId?: unknown;
};

function clean(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase("uk-UA")
    .replace(/[‐‑‒–—-]/g, " ")
    .replace(/[^a-zа-яіїє0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeKey(input: { name: string; article: string | null; brand: string | null; position: string | null; findingId: string | null }) {
  return createHash("sha256")
    // A recommendation is an explicit row, even when another row has the
    // same name. The random component keeps the technical legacy unique key
    // from deduplicating user intent.
    .update([input.name, input.article || "", input.brand || "", input.position || "", input.findingId || "", randomUUID()].map(normalize).join("|"))
    .digest("hex");
}

function quantity(value: unknown, fallback = 1) {
  const raw = value == null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 100) {
    throw new DiagnosticManualPartError("QUANTITY_INVALID", "Кількість деталі має бути від 1 до 100.");
  }
  return new Prisma.Decimal(raw);
}

function inputValues(input: DiagnosticManualPartInput, fallback?: { name: string; article: string | null; brand: string | null; position: string | null; genericArticleId: string | null; catalogCode: string | null; quantity: Prisma.Decimal; note: string | null; findingId: string | null }) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const name = clean(source.name, 500) || fallback?.name || "";
  if (!name) throw new DiagnosticManualPartError("NAME_REQUIRED", "Вкажіть назву деталі.");
  const article = source.article === undefined ? fallback?.article || null : clean(source.article, 120) || null;
  const brand = source.brand === undefined ? fallback?.brand || null : clean(source.brand, 120) || null;
  const position = source.position === undefined ? fallback?.position || null : clean(source.position, 120) || null;
  const genericArticleId = source.genericArticleId === undefined ? fallback?.genericArticleId || null : clean(source.genericArticleId, 160) || null;
  const catalogCode = source.catalogCode === undefined ? fallback?.catalogCode || null : clean(source.catalogCode, 80) || null;
  const note = source.note === undefined ? fallback?.note || null : clean(source.note, 4000) || null;
  const findingId = source.findingId === undefined ? fallback?.findingId || null : clean(source.findingId, 160) || null;
  const parsedQuantity = source.quantity === undefined ? fallback?.quantity || new Prisma.Decimal(1) : quantity(source.quantity);
  return { name, article, brand, position, genericArticleId, catalogCode, quantity: parsedQuantity, note, findingId };
}

function serialize(row: {
  id: string;
  diagnosticRequestId: string;
  findingId: string | null;
  name: string;
  article: string | null;
  brand: string | null;
  position: string | null;
  genericArticleId: string | null;
  catalogCode: string | null;
  quantity: Prisma.Decimal;
  note: string | null;
  source: string;
  status: string;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...row, quantity: row.quantity.toString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

async function ensureFindingScope(tx: Prisma.TransactionClient, diagnosticRequestId: string, findingId: string | null) {
  if (!findingId) return;
  const finding = await tx.diagnosticFinding.findUnique({ where: { id: findingId }, select: { id: true, checkId: true } });
  if (!finding) throw new DiagnosticManualPartError("FINDING_NOT_FOUND", "Вибрану несправність не знайдено.", 404);
  const check = await tx.diagnosticCheck.findUnique({ where: { id: finding.checkId }, select: { inspectionId: true } });
  const inspection = check ? await tx.diagnosticInspection.findUnique({ where: { id: check.inspectionId }, select: { diagnosticRequestId: true } }) : null;
  if (!inspection || inspection.diagnosticRequestId !== diagnosticRequestId) {
    throw new DiagnosticManualPartError("FINDING_SCOPE_MISMATCH", "Несправність не належить цій діагностичній карті.", 403);
  }
}

async function ensureGenericArticle(tx: Prisma.TransactionClient, genericArticleId: string | null) {
  if (!genericArticleId) return null;
  const article = await tx.genericArticle.findFirst({
    where: { id: genericArticleId, status: "ACTIVE" },
    select: { id: true, code: true, name: true },
  });
  if (!article) throw new DiagnosticManualPartError("CATALOG_ARTICLE_NOT_FOUND", "Обрану деталь не знайдено в активному каталозі CRM.", 409);
  return article;
}

async function ensureDiagnostic(tx: Prisma.TransactionClient, diagnosticRequestId: string) {
  const diagnostic = await tx.diagnosticRequest.findUnique({
    where: { id: diagnosticRequestId },
    select: { id: true, status: true, workOrder: { select: { id: true } } },
  });
  if (!diagnostic) throw new DiagnosticManualPartError("DIAGNOSTIC_NOT_FOUND", "Діагностичну карту не знайдено.", 404);
  if (diagnostic.status === "CANCELLED") throw new DiagnosticManualPartError("DIAGNOSTIC_LOCKED", "Скасовану діагностичну карту не можна змінювати.", 409);
  return diagnostic;
}

async function linkedLine(tx: Prisma.TransactionClient, recommendationId: string, workOrderId: string | null) {
  if (!workOrderId) return null;
  return tx.workOrderLine.findFirst({
    where: { workOrderId, sourceEntity: LINE_SOURCE, sourceEntityId: recommendationId, status: { not: "CANCELLED" } },
    select: { id: true, status: true, supplierId: true, supplierQuoteId: true, plannedUnitPrice: true },
  });
}

function lineIsLocked(line: { status: string; supplierId: string | null; supplierQuoteId: string | null; plannedUnitPrice: Prisma.Decimal }) {
  return line.status !== "DRAFT" || Boolean(line.supplierId || line.supplierQuoteId) || Number(line.plannedUnitPrice) > 0;
}

async function createDraftLine(tx: Prisma.TransactionClient, workOrderId: string, recommendation: { id: string; diagnosticRequestId: string; name: string; article: string | null; brand: string | null; position: string | null; genericArticleId: string | null; catalogCode: string | null; quantity: Prisma.Decimal; note: string | null }, actorName: string) {
  const current = await linkedLine(tx, recommendation.id, workOrderId);
  if (current) return current;
  const max = await tx.workOrderLine.aggregate({ where: { workOrderId }, _max: { sortOrder: true } });
  const line = await tx.workOrderLine.create({
    data: {
      workOrderId,
      type: "PART",
      status: "DRAFT",
      description: recommendation.name,
      code: recommendation.catalogCode,
      article: recommendation.article,
      brand: recommendation.brand,
      unit: "шт",
      currency: "UAH",
      requiredForRepair: true,
      plannedQuantity: recommendation.quantity,
      plannedUnitPrice: 0,
      plannedUnitCost: 0,
      sortOrder: (max._max.sortOrder || 0) + 10,
      sourceEntity: LINE_SOURCE,
      sourceEntityId: recommendation.id,
      metadata: toPrismaJson({
        source: SOURCE,
        diagnosticRequestId: recommendation.diagnosticRequestId,
        recommendationId: recommendation.id,
        genericArticleId: recommendation.genericArticleId,
        catalogCode: recommendation.catalogCode,
        position: recommendation.position,
        note: recommendation.note,
      }),
    },
    select: { id: true, status: true },
  });
  await tx.auditEvent.create({
    data: {
      actorName,
      entityType: "WorkOrderLine",
      entityId: line.id,
      action: "DIAGNOSTIC_MANUAL_PART_LINE_CREATED",
      metadata: toPrismaJson({ workOrderId, recommendationId: recommendation.id }),
    },
  });
  return line;
}

export async function listDiagnosticManualParts(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const rows = await prisma.diagnosticPartRecommendation.findMany({
    where: { diagnosticRequestId, status: { not: CANCELLED_STATUS } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(serialize);
}

export async function createDiagnosticManualPart(
  diagnosticRequestId: string,
  input: DiagnosticManualPartInput,
  actor: { id: string; name: string },
) {
  const prisma = getPrisma();
  try {
    return await prisma.$transaction(async (tx) => {
      const diagnostic = await ensureDiagnostic(tx, diagnosticRequestId);
      const draftValues = inputValues(input);
      const catalogArticle = await ensureGenericArticle(tx, draftValues.genericArticleId);
      const values = catalogArticle ? { ...draftValues, name: catalogArticle.name, catalogCode: catalogArticle.code } : draftValues;
      await ensureFindingScope(tx, diagnosticRequestId, values.findingId);
      const key = dedupeKey(values);
      const recommendation = await tx.diagnosticPartRecommendation.create({ data: { diagnosticRequestId, ...values, dedupeKey: key, source: SOURCE, status: ACTIVE_STATUS, createdByUserId: actor.id, createdByName: actor.name } });
      if (diagnostic.workOrder) await createDraftLine(tx, diagnostic.workOrder.id, recommendation, actor.name);
      await tx.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "DiagnosticPartRecommendation", entityId: recommendation.id, action: "DIAGNOSTIC_MANUAL_PART_CREATED", after: toPrismaJson(recommendation), metadata: toPrismaJson({ diagnosticRequestId, workOrderId: diagnostic.workOrder?.id || null, catalogArticleId: recommendation.genericArticleId }) } });
      return serialize(recommendation);
    });
  } catch (error) {
    if (error instanceof DiagnosticManualPartError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new DiagnosticManualPartError("DUPLICATE_PART", "Така деталь уже додана до цієї діагностичної карти.", 409);
    throw error;
  }
}

export async function updateDiagnosticManualPart(
  diagnosticRequestId: string,
  recommendationId: string,
  input: DiagnosticManualPartInput,
  actor: { id: string; name: string },
) {
  const prisma = getPrisma();
  try {
    return await prisma.$transaction(async (tx) => {
      const diagnostic = await ensureDiagnostic(tx, diagnosticRequestId);
      const current = await tx.diagnosticPartRecommendation.findFirst({ where: { id: recommendationId, diagnosticRequestId, status: { not: CANCELLED_STATUS } } });
      if (!current) throw new DiagnosticManualPartError("PART_NOT_FOUND", "Ручну деталь не знайдено.", 404);
      const line = await linkedLine(tx, recommendationId, diagnostic.workOrder?.id || null);
      if (line && lineIsLocked(line)) throw new DiagnosticManualPartError("PART_LOCKED", "Підібрану або погоджену деталь не можна редагувати з Діагностичної карти.", 409);
      const draftValues = inputValues(input, current);
      const catalogArticle = await ensureGenericArticle(tx, draftValues.genericArticleId);
      const values = catalogArticle ? { ...draftValues, name: catalogArticle.name, catalogCode: catalogArticle.code } : draftValues;
      await ensureFindingScope(tx, diagnosticRequestId, values.findingId);
      const recommendation = await tx.diagnosticPartRecommendation.update({ where: { id: recommendationId }, data: { ...values, createdByUserId: actor.id, createdByName: actor.name } });
      if (line && diagnostic.workOrder) {
        await tx.workOrderLine.update({ where: { id: line.id }, data: { description: recommendation.name, code: recommendation.catalogCode, article: recommendation.article, brand: recommendation.brand, plannedQuantity: recommendation.quantity, metadata: toPrismaJson({ source: SOURCE, diagnosticRequestId, recommendationId: recommendation.id, genericArticleId: recommendation.genericArticleId, catalogCode: recommendation.catalogCode, position: recommendation.position, note: recommendation.note }) } });
      }
      await tx.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "DiagnosticPartRecommendation", entityId: recommendation.id, action: "DIAGNOSTIC_MANUAL_PART_UPDATED", before: toPrismaJson(current), after: toPrismaJson(recommendation), metadata: toPrismaJson({ diagnosticRequestId }) } });
      return serialize(recommendation);
    });
  } catch (error) {
    if (error instanceof DiagnosticManualPartError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new DiagnosticManualPartError("DUPLICATE_PART", "Така деталь уже додана до цієї діагностичної карти.", 409);
    throw error;
  }
}

export async function cancelDiagnosticManualPart(
  diagnosticRequestId: string,
  recommendationId: string,
  actor: { id: string; name: string },
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const diagnostic = await ensureDiagnostic(tx, diagnosticRequestId);
    const current = await tx.diagnosticPartRecommendation.findFirst({ where: { id: recommendationId, diagnosticRequestId, status: { not: CANCELLED_STATUS } } });
    if (!current) throw new DiagnosticManualPartError("PART_NOT_FOUND", "Ручну деталь не знайдено.", 404);
    const line = await linkedLine(tx, recommendationId, diagnostic.workOrder?.id || null);
    if (line && lineIsLocked(line)) throw new DiagnosticManualPartError("PART_LOCKED", "Підібрану або погоджену деталь не можна видалити з Діагностичної карти.", 409);
    if (line) await tx.workOrderLine.update({ where: { id: line.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    const recommendation = await tx.diagnosticPartRecommendation.update({ where: { id: recommendationId }, data: { status: CANCELLED_STATUS } });
    await tx.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "DiagnosticPartRecommendation", entityId: recommendation.id, action: "DIAGNOSTIC_MANUAL_PART_CANCELLED", before: toPrismaJson(current), after: toPrismaJson(recommendation), metadata: toPrismaJson({ diagnosticRequestId, workOrderLineId: line?.id || null }) } });
    return { id: recommendation.id };
  });
}
