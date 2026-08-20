import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  getRequiredDiagnosticCompletion,
  submitStructuredDiagnosticRespectingOptional,
} from "@/src/services/diagnostic-completeness.service";
import {
  getMechanicDiagnosticMode,
  getStructuredDiagnosticForMechanicReadOnly,
} from "@/src/services/mechanic-diagnostics-read.service";
import {
  addTemplateForMechanic,
  getStructuredDiagnostic,
  returnStructuredDiagnostic,
  setDiagnosticSectionAllOk,
  startStructuredDiagnostic,
  StructuredDiagnosticError,
} from "@/src/services/structured-diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMechanic(access: Awaited<ReturnType<typeof authorize>>) {
  return Boolean(access.context.roles.some((role) => role.code === "MECHANIC"));
}

async function managerLocationAllowed(access: Awaited<ReturnType<typeof authorize>>, diagnosticRequestId: string) {
  if (access.shadowBypass || access.grantedScope === "ALL") return true;
  const view = await getStructuredDiagnostic(diagnosticRequestId);
  const locationId = view.diagnostic.assignment?.locationId || null;
  return Boolean(locationId && access.context.locationIds.includes(locationId));
}

async function withCompletion<T extends Awaited<ReturnType<typeof getStructuredDiagnostic>>>(diagnosticRequestId: string, data: T) {
  const completion = await getRequiredDiagnosticCompletion(diagnosticRequestId);
  return { ...data, canSubmit: completion.canSubmit, completion };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_READ, { request, minimumScope: "SELF" });
    if (!access.allowed) return access.response!;
    if (!access.context.user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });

    const mechanic = isMechanic(access);
    const modeOnly = new URL(request.url).searchParams.get("mode") === "1";
    if (mechanic && modeOnly) {
      const mode = await getMechanicDiagnosticMode(access.context.user.id, id);
      return NextResponse.json({ ok: true, ...mode }, { headers: { "Cache-Control": "private, max-age=15" } });
    }

    const data = mechanic
      ? await getStructuredDiagnosticForMechanicReadOnly(access.context.user.id, id)
      : await getStructuredDiagnostic(id);
    if (!mechanic && !(await managerLocationAllowed(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
    return NextResponse.json({ ok: true, ...(await withCompletion(id, data)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StructuredDiagnosticError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("GET structured diagnostic failed", error);
    return NextResponse.json({ ok: false, error: "STRUCTURED_DIAGNOSTIC_LOAD_FAILED" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || "").trim().toUpperCase();
  try {
    if (action === "RETURN") {
      const access = await authorize(PERMISSIONS.DIAGNOSTICS_CONFIRM, { request, minimumScope: "LOCATION" });
      if (!access.allowed) return access.response!;
      if (!access.context.user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
      if (!(await managerLocationAllowed(access, id))) return NextResponse.json({ ok: false, error: "LOCATION_FORBIDDEN" }, { status: 403 });
      const data = await returnStructuredDiagnostic(id, access.context.user.id, typeof body.managerComment === "string" ? body.managerComment : null);
      return NextResponse.json({ ok: true, ...(await withCompletion(id, data)) });
    }

    const access = await authorize(PERMISSIONS.DIAGNOSTICS_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !isMechanic(access)) return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED" }, { status: 403 });

    if (action === "START") {
      const data = await startStructuredDiagnostic(access.context.user.id, id);
      return NextResponse.json({ ok: true, ...(await withCompletion(id, data)) });
    }
    if (action === "ADD_TEMPLATE") {
      const templateId = String(body.templateId || "");
      if (!templateId) return NextResponse.json({ ok: false, error: "TEMPLATE_REQUIRED" }, { status: 400 });
      const data = await addTemplateForMechanic(access.context.user.id, id, templateId);
      return NextResponse.json({ ok: true, ...(await withCompletion(id, data)) });
    }
    if (action === "SECTION_ALL_OK") {
      const inspectionId = String(body.inspectionId || "");
      const sectionId = String(body.sectionId || "");
      if (!inspectionId || !sectionId) return NextResponse.json({ ok: false, error: "SECTION_REQUIRED" }, { status: 400 });
      const data = await setDiagnosticSectionAllOk(access.context.user.id, id, inspectionId, sectionId);
      return NextResponse.json({ ok: true, ...(await withCompletion(id, data)) });
    }
    if (action === "SUBMIT") {
      const data = await submitStructuredDiagnosticRespectingOptional(access.context.user.id, id, typeof body.mechanicComment === "string" ? body.mechanicComment : null);
      return NextResponse.json({ ok: true, ...(await withCompletion(id, data)) });
    }
    return NextResponse.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });
  } catch (error) {
    if (error instanceof StructuredDiagnosticError) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("PATCH structured diagnostic failed", error);
    return NextResponse.json({ ok: false, error: "STRUCTURED_DIAGNOSTIC_UPDATE_FAILED" }, { status: 500 });
  }
}
