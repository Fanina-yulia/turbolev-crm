import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getRequiredDiagnosticCompletion } from "@/src/services/diagnostic-completeness.service";
import { getStructuredDiagnosticForMechanicReadOnly } from "@/src/services/mechanic-diagnostics-read.service";
import { StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasChassisIntent(problem: string | null | undefined) {
  return /(ходов|підвіск|рульов|сайлент|кульов|стабіліз|амортиз|привід|шрус)/u.test((problem || "").toLocaleLowerCase("uk-UA"));
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_READ, { request, minimumScope: "SELF" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED" }, { status: 403 });
    }

    const [data, completion] = await Promise.all([
      getStructuredDiagnosticForMechanicReadOnly(access.context.user.id, id),
      getRequiredDiagnosticCompletion(id),
    ]);
    const templateNames = data.inspections.map((inspection) => inspection.templateName).filter(Boolean);
    const mode = templateNames.length > 0
      ? (templateNames.some((name) => /матриця ходової/iu.test(name)) ? "MATRIX" : "LEGACY")
      : (hasChassisIntent(data.diagnostic.problem) ? "MATRIX" : "LEGACY");

    return NextResponse.json({
      ok: true,
      mode,
      detail: {
        ok: true,
        ...data,
        canSubmit: completion.canSubmit,
        completion,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StructuredDiagnosticError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("GET mechanic diagnostic bootstrap failed", error);
    return NextResponse.json({ ok: false, error: "MECHANIC_DIAGNOSTIC_BOOTSTRAP_FAILED", message: "Не вдалося відкрити діагностику." }, { status: 500 });
  }
}
