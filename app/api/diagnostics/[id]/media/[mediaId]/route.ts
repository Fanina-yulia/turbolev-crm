import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getStructuredDiagnostic, getStructuredDiagnosticForMechanic, StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function mediaBelongsToDiagnostic(mediaId: string, diagnosticRequestId: string) {
  const prisma = getPrisma();
  const media = await prisma.diagnosticMedia.findUnique({ where: { id: mediaId } });
  if (!media) return null;
  const finding = await prisma.diagnosticFinding.findUnique({ where: { id: media.findingId } });
  if (!finding) return null;
  const check = await prisma.diagnosticCheck.findUnique({ where: { id: finding.checkId } });
  if (!check) return null;
  const inspection = await prisma.diagnosticInspection.findUnique({ where: { id: check.inspectionId } });
  if (!inspection || inspection.diagnosticRequestId !== diagnosticRequestId) return null;
  return media;
}

export async function GET(request: Request, context: { params: Promise<{ id: string; mediaId: string }> }) {
  const { id, mediaId } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_READ, { request, minimumScope: "SELF" });
    if (!access.allowed) return access.response!;
    if (!access.context.user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    const mechanic = access.context.roles.some((role) => role.code === "MECHANIC");
    const view = mechanic
      ? await getStructuredDiagnosticForMechanic(access.context.user.id, id)
      : await getStructuredDiagnostic(id);
    if (!mechanic && !access.shadowBypass && access.grantedScope !== "ALL") {
      const locationId = view.diagnostic.assignment?.locationId || null;
      if (!locationId || !access.context.locationIds.includes(locationId)) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    }
    const media = await mediaBelongsToDiagnostic(mediaId, id);
    if (!media) return NextResponse.json({ ok: false, error: "MEDIA_NOT_FOUND" }, { status: 404 });
    return new Response(media.fileData, {
      status: 200,
      headers: {
        "Content-Type": media.mimeType,
        "Content-Length": String(media.fileSize),
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `inline; filename="${media.fileName.replace(/[\r\n\"]/g, "_")}"`,
      },
    });
  } catch (error) {
    if (error instanceof StructuredDiagnosticError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("GET diagnostic media failed", error);
    return NextResponse.json({ ok: false, error: "DIAGNOSTIC_MEDIA_LOAD_FAILED" }, { status: 500 });
  }
}
