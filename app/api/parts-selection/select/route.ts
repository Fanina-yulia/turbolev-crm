import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { selectDiagnosticPartOffer, PartsSelectionError } from "@/src/services/parts-selection.service";
import type { PartFitmentStatus } from "@/src/services/parts-fitment.service";
import { getStructuredDiagnostic, StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";
import { validatePartSelection } from "@/src/services/part-catalog-intelligence.service";
import { recordPartSelectionKnowledge } from "@/src/services/parts-selection-knowledge.service";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const access = await authorize(PERMISSIONS.PARTS_WRITE, { request, minimumScope: "LOCATION", strict: true });
  if (!access.allowed) return access.response!;
  if (!access.context.user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });

  try {
    const body = await request.json().catch(() => null) as {
      diagnosticId?: string;
      findingId?: string | null;
      manualPartId?: string | null;
      supplierId?: string;
      externalProductId?: string | null;
      article?: string | null;
      quantity?: number | null;
      searchMode?: "VIN" | "PART_NUMBER" | "TEXT";
      vehicleVin?: string | null;
      vehicleId?: string | null;
      partName?: string | null;
      canonicalCode?: string | null;
      axis?: string | null;
      side?: string | null;
      subPosition?: string | null;
      genericArticleId?: string | null;
      position?: string | null;
      fitmentStatus?: PartFitmentStatus | null;
      fitmentExact?: boolean | null;
      fitmentProductId?: string | null;
      fitmentSource?: string | null;
      manualConfirmation?: boolean;
      customerProvidedPart?: boolean;
      resultType?: "ORIGINAL" | "OEM_REPLACEMENT" | "ANALOG" | "ASSEMBLY" | "UNKNOWN" | null;
      compatibilityTier?: "CONFIRMED" | "PARTIAL" | "REVIEW_REQUIRED" | "UNCONFIRMED" | null;
      sourceKind?: "DIRECT" | "OEM" | "ANALOG" | "NAME" | "ASSEMBLY" | null;
      offerReason?: string | null;
      matchReasons?: string[] | null;
      requiresManualConfirmation?: boolean;
    } | null;
    const diagnosticId = body?.diagnosticId?.trim() || "";
    if (!diagnosticId) return NextResponse.json({ ok: false, error: "DIAGNOSTIC_REQUIRED", message: "Не передано Діагностичну карту." }, { status: 400 });

    if (body?.genericArticleId) {
      const article = await getPrisma().genericArticle.findUnique({ where: { id: body.genericArticleId }, select: { axis: true, side: true, position: true, subPosition: true, soldAs: true } });
      const validation = validatePartSelection({ expected: { axis: body.axis, side: body.side, position: body.position, subPosition: body.subPosition }, selected: article || {}, quantity: body.quantity ?? 1 });
      if (!validation.ok) return NextResponse.json({ ok: false, error: "PART_LOGIC_MISMATCH", message: validation.errors.join(" "), warnings: validation.warnings }, { status: 400 });
    }

    const view = await getStructuredDiagnostic(diagnosticId);
    if (!access.shadowBypass && access.grantedScope !== "ALL") {
      const locationId = view.diagnostic.assignment?.locationId || null;
      if (!locationId || !access.context.locationIds.includes(locationId)) {
        return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
      }
    }

    const result = await selectDiagnosticPartOffer({
      diagnosticRequestId: diagnosticId,
      findingId: body?.findingId || null,
      manualPartId: body?.manualPartId || null,
      supplierId: body?.supplierId || "",
      externalProductId: body?.externalProductId || null,
      article: body?.article || null,
      quantity: body?.quantity ?? 1,
      actorId: access.context.user.id,
      actorName: access.context.user.employeeName || access.context.user.name || "CRM / Підбір запчастин",
      searchMode: body?.searchMode,
      vehicleVin: body?.vehicleVin || null,
      vehicleId: body?.vehicleId || null,
      partName: body?.partName || null,
      canonicalCode: body?.canonicalCode || null,
      axis: body?.axis || null,
      side: body?.side || null,
      subPosition: body?.subPosition || null,
      genericArticleId: body?.genericArticleId || null,
      position: body?.position || null,
      fitmentStatus: body?.fitmentStatus || null,
      fitmentExact: body?.fitmentExact ?? null,
      fitmentProductId: body?.fitmentProductId || null,
      fitmentSource: body?.fitmentSource || null,
      manualConfirmation: body?.manualConfirmation === true,
      customerProvidedPart: body?.customerProvidedPart === true,
    });

    let knowledge: { feedbackId?: string; stagedChangeId?: string | null; staged?: boolean; recorded: boolean } = { recorded: false };
    try {
      const recorded = await recordPartSelectionKnowledge({
        genericArticleId: body?.genericArticleId || null,
        vehicleId: body?.vehicleId || null,
        diagnosticId,
        query: body?.partName || body?.canonicalCode || result.selected.article || body?.article || "",
        provider: result.selected.supplierId || body?.supplierId || null,
        selectedArticle: result.selected.article,
        selectedBrand: result.selected.brand,
        resultType: body?.resultType || null,
        compatibilityTier: body?.compatibilityTier || null,
        sourceKind: body?.sourceKind || null,
        offerReason: body?.offerReason || null,
        matchReasons: Array.isArray(body?.matchReasons) ? body.matchReasons : [],
        manualConfirmation: body?.manualConfirmation === true || body?.requiresManualConfirmation === true,
        fitmentStatus: result.fitmentStatus || body?.fitmentStatus || null,
        fitmentExact: result.fitmentExact ?? body?.fitmentExact ?? null,
        createdByUserId: access.context.user.id,
        createdByName: access.context.user.employeeName || access.context.user.name || undefined,
      });
      knowledge = { ...recorded, recorded: true };
    } catch (knowledgeError) {
      console.error("Part selection knowledge persistence failed", knowledgeError);
    }

    return NextResponse.json({ ok: true, warnings: [], knowledge, ...result });
  } catch (error) {
    if (error instanceof PartsSelectionError || error instanceof StructuredDiagnosticError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("POST /api/parts-selection/select failed", error);
    return NextResponse.json({ ok: false, error: "PART_SELECTION_FAILED", message: "Не вдалося зберегти вибрану деталь." }, { status: 500 });
  }
}
