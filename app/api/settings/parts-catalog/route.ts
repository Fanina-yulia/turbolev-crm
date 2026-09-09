import { NextRequest, NextResponse } from "next/server";
import { CatalogEntityStatus, PartCatalogReviewStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { createCatalogChange, listCatalogParts, normalizeCatalogArticleInput, recordSearchFeedback, seedRepairKits } from "@/src/services/part-catalog-intelligence.service";
import { seedStaticPartKnowledge } from "@/src/services/parts-knowledge.service";
import { seedPartOperationCatalog } from "@/src/services/part-operation-catalog.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.PARTS_READ, { request, minimumScope: "ALL" });
  if (!access.allowed) return access.response!;
  const params = request.nextUrl.searchParams;
  try {
    const parts = await listCatalogParts({ query: params.get("q") || undefined, status: params.get("status") || undefined, limit: Number(params.get("limit") || 50) });
    const prisma = getPrisma();
    const [kits, pendingChanges, observations] = await Promise.all([
      prisma.repairKit.findMany({ where: { status: CatalogEntityStatus.ACTIVE }, include: { items: { include: { genericArticle: { select: { code: true, name: true } } } } }, orderBy: { name: "asc" } }),
      prisma.partCatalogChange.count({ where: { status: "PENDING" } }),
      prisma.partTermObservation.count({ where: { status: "NEW" } }),
    ]);
    return NextResponse.json({ ok: true, parts, kits, stats: { parts: parts.length, pendingChanges, unrecognizedTerms: observations } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/settings/parts-catalog failed", error);
    return NextResponse.json({ ok: false, error: "PART_CATALOG_READ_FAILED" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const access = await authorize(PERMISSIONS.PARTS_WRITE, { request, strict: true, minimumScope: "ALL" });
  if (!access.allowed) return access.response!;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action.toUpperCase() : "";
  const prisma = getPrisma();
  try {
    if (action === "UPSERT_PART") {
      const data = normalizeCatalogArticleInput(body);
      const current = await prisma.genericArticle.findUnique({ where: { code: data.code } });
      const part = await prisma.genericArticle.upsert({ where: { code: data.code }, update: { ...data, reviewStatus: PartCatalogReviewStatus.PENDING_REVIEW, status: CatalogEntityStatus.DRAFT }, create: { ...data, reviewStatus: PartCatalogReviewStatus.PENDING_REVIEW, status: CatalogEntityStatus.DRAFT } });
      await createCatalogChange({ entityType: "GenericArticle", entityId: part.id, genericArticleId: part.id, action: current ? "UPDATE" : "CREATE", beforeData: current, afterData: part, reason: "Зміна каталогу через CRM", requestedByUserId: access.context.user?.id, requestedByName: access.context.user?.name });
      return NextResponse.json({ ok: true, part }, { status: current ? 200 : 201 });
    }
    if (action === "ADD_ALIAS") {
      const genericArticleId = String(body.genericArticleId || "");
      const aliasRaw = String(body.aliasRaw || "").trim();
      if (!genericArticleId || !aliasRaw) return NextResponse.json({ ok: false, error: "Потрібні genericArticleId та aliasRaw." }, { status: 400 });
      const aliasNormalized = aliasRaw.toLocaleLowerCase("uk-UA").replace(/\s+/g, " ").trim();
      const alias = await prisma.genericArticleAlias.upsert({ where: { genericArticleId_aliasNormalized_provider: { genericArticleId, aliasNormalized, provider: String(body.provider || "") } }, update: { status: CatalogEntityStatus.DRAFT, isApproved: false, lastSeenAt: new Date() }, create: { genericArticleId, aliasRaw, aliasNormalized, provider: String(body.provider || ""), language: String(body.language || "uk"), aliasType: String(body.aliasType || "SYNONYM"), axisHint: String(body.axisHint || "") || null, sideHint: String(body.sideHint || "") || null, subPositionHint: String(body.subPositionHint || "") || null, source: "CRM", identityKey: `${genericArticleId}:${aliasNormalized}:${String(body.provider || "")}`.slice(0, 128), status: CatalogEntityStatus.DRAFT } });
      return NextResponse.json({ ok: true, alias }, { status: 201 });
    }
    if (action === "APPROVE_CHANGE") {
      const changeId = String(body.changeId || "");
      const change = await prisma.partCatalogChange.update({ where: { id: changeId }, data: { status: "APPROVED", reviewedByUserId: access.context.user?.id, reviewedAt: new Date() } });
      if (change.genericArticleId) await prisma.genericArticle.update({ where: { id: change.genericArticleId }, data: { status: CatalogEntityStatus.ACTIVE, reviewStatus: PartCatalogReviewStatus.APPROVED, lastVerifiedAt: new Date(), lastVerifiedByUserId: access.context.user?.id } });
      return NextResponse.json({ ok: true, change });
    }
    if (action === "REJECT_CHANGE") {
      const change = await prisma.partCatalogChange.update({ where: { id: String(body.changeId || "") }, data: { status: "REJECTED", reason: String(body.reason || "") } });
      return NextResponse.json({ ok: true, change });
    }
    if (action === "RECORD_FEEDBACK") {
      const feedback = await recordSearchFeedback({ ...body, query: String(body.query || ""), resultStatus: String(body.resultStatus || "REJECTED"), createdByUserId: access.context.user?.id, createdByName: access.context.user?.name });
      return NextResponse.json({ ok: true, feedback }, { status: 201 });
    }
    if (action === "REJECT_MATCH") {
      const match = await prisma.partRejectedMatch.create({ data: { genericArticleId: String(body.genericArticleId || "") || null, provider: String(body.provider || "") || null, article: String(body.article || "") || null, brand: String(body.brand || "") || null, name: String(body.name || "Невідома деталь"), reason: String(body.reason || "") || null, source: "CRM", createdByUserId: access.context.user?.id, createdByName: access.context.user?.name } });
      return NextResponse.json({ ok: true, match }, { status: 201 });
    }
    if (action === "SEED_REPAIR_KITS") return NextResponse.json({ ok: true, result: await seedRepairKits() });
    if (action === "SEED_PART_OPERATION_CATALOG") return NextResponse.json({ ok: true, result: await seedPartOperationCatalog() });
    if (action === "SEED_FULL_PART_CATALOG") {
      const terminology = await seedStaticPartKnowledge();
      const operations = await seedPartOperationCatalog();
      const kits = await seedRepairKits();
      return NextResponse.json({ ok: true, result: { terminology, operations, kits } });
    }
    return NextResponse.json({ ok: false, error: "UNKNOWN_PART_CATALOG_ACTION" }, { status: 400 });
  } catch (error) {
    console.error("POST /api/settings/parts-catalog failed", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "PART_CATALOG_WRITE_FAILED" }, { status: 500 });
  }
}
