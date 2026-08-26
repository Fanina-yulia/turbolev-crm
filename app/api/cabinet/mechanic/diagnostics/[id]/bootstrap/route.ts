import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getCompletionFromMechanicView } from "@/src/services/diagnostic-completion-view.service";
import { getStructuredDiagnosticForMechanicReadOnly } from "@/src/services/mechanic-diagnostics-read.service";
import { startMechanicDiagnosticByType } from "@/src/services/mechanic-diagnostic-matrix.service";
import { StructuredDiagnosticError } from "@/src/services/structured-diagnostics.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasChassisIntent(problem: string | null | undefined) {
  return /(ходов|підвіск|рульов|сайлент|кульов|стабіліз|амортиз|привід|шрус)/u.test((problem || "").toLocaleLowerCase("uk-UA"));
}

function timingHeader(parts: Record<string, number>) {
  return Object.entries(parts).map(([name, duration]) => `${name};dur=${Math.round(duration)}`).join(", ");
}

function diagnosticMode(data: Awaited<ReturnType<typeof getStructuredDiagnosticForMechanicReadOnly>>) {
  const templateNames = data.inspections.map((inspection) => inspection.templateName).filter(Boolean);
  const mode = templateNames.length > 0
    ? (templateNames.some((name) => /матриця ходової/iu.test(name)) ? "MATRIX" : "LEGACY")
    : (hasChassisIntent(data.diagnostic.problem) ? "MATRIX" : "LEGACY");
  return { mode, templateNames } as const;
}

function responseBody(data: Awaited<ReturnType<typeof getStructuredDiagnosticForMechanicReadOnly>>) {
  const completion = getCompletionFromMechanicView(data.inspections);
  return Promise.resolve(completion).then((resolvedCompletion) => {
    const { mode, templateNames } = diagnosticMode(data);
    return {
      ok: true,
      mode,
      templateNames,
      detail: {
        ok: true,
        ...data,
        canSubmit: resolvedCompletion.canSubmit,
        completion: resolvedCompletion,
      },
    };
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const totalStartedAt = Date.now();
  const timings: Record<string, number> = {};
  const { id } = await context.params;
  try {
    const authStartedAt = Date.now();
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_READ, { request, minimumScope: "SELF" });
    timings.auth = Date.now() - authStartedAt;
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED" }, { status: 403 });
    }

    const detailStartedAt = Date.now();
    const data = await getStructuredDiagnosticForMechanicReadOnly(access.context.user.id, id);
    timings.detail = Date.now() - detailStartedAt;

    const completionStartedAt = Date.now();
    const body = await responseBody(data);
    timings.completion = Date.now() - completionStartedAt;
    timings.total = Date.now() - totalStartedAt;

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Server-Timing": timingHeader(timings),
      },
    });
  } catch (error) {
    if (error instanceof StructuredDiagnosticError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("GET mechanic diagnostic bootstrap failed", error);
    return NextResponse.json({ ok: false, error: "MECHANIC_DIAGNOSTIC_BOOTSTRAP_FAILED", message: "Не вдалося відкрити діагностику." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_WRITE, { request, minimumScope: "ASSIGNED" });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED" }, { status: 403 });
    }

    // This mutation intentionally bypasses the client read cache. It is the canonical
    // bootstrap for active mechanic diagnostics and guarantees chassis + fluids exist
    // before the matrix UI is rendered.
    await startMechanicDiagnosticByType(access.context.user.id, id);
    const data = await getStructuredDiagnosticForMechanicReadOnly(access.context.user.id, id);
    return NextResponse.json(await responseBody(data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StructuredDiagnosticError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("POST mechanic diagnostic bootstrap failed", error);
    return NextResponse.json({ ok: false, error: "MECHANIC_DIAGNOSTIC_BOOTSTRAP_FAILED", message: "Не вдалося підготувати діагностику." }, { status: 500 });
  }
}
