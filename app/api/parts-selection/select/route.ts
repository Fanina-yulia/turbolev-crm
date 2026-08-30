import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { selectDiagnosticPartOffer, PartsSelectionError } from "@/src/services/parts-selection.service";
import { getStructuredDiagnostic, StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

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
      findingId?: string;
      supplierId?: string;
      externalProductId?: string | null;
      article?: string | null;
      quantity?: number | null;
      searchMode?: "VIN" | "PART_NUMBER" | "TEXT";
      vehicleVin?: string | null;
      manualConfirmation?: boolean;
      customerProvidedPart?: boolean;
    } | null;
    const diagnosticId = body?.diagnosticId?.trim() || "";
    if (!diagnosticId) return NextResponse.json({ ok: false, error: "DIAGNOSTIC_REQUIRED", message: "Не передано Діагностичну карту." }, { status: 400 });

    const view = await getStructuredDiagnostic(diagnosticId);
    if (!access.shadowBypass && access.grantedScope !== "ALL") {
      const locationId = view.diagnostic.assignment?.locationId || null;
      if (!locationId || !access.context.locationIds.includes(locationId)) {
        return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
      }
    }

    const result = await selectDiagnosticPartOffer({
      diagnosticRequestId: diagnosticId,
      findingId: body?.findingId || "",
      supplierId: body?.supplierId || "",
      externalProductId: body?.externalProductId || null,
      article: body?.article || null,
      quantity: body?.quantity ?? 1,
      actorId: access.context.user.id,
      actorName: access.context.user.employeeName || access.context.user.name || "CRM / Підбір запчастин",
      searchMode: body?.searchMode,
      vehicleVin: body?.vehicleVin || null,
      manualConfirmation: body?.manualConfirmation === true,
      customerProvidedPart: body?.customerProvidedPart === true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof PartsSelectionError || error instanceof StructuredDiagnosticError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("POST /api/parts-selection/select failed", error);
    return NextResponse.json({ ok: false, error: "PART_SELECTION_FAILED", message: "Не вдалося зберегти вибрану деталь." }, { status: 500 });
  }
}
