import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { createIntake, IntakeConflictError, IntakeValidationError, type IntakeInput } from "@/src/services/intake.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const access = await authorize(PERMISSIONS.LEADS_WRITE, request, { minimumScope: "TEAM" });
  if (!access.ok) return access.response;

  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new IntakeValidationError("Тіло запиту повинно бути JSON-об'єктом.");
    }

    const result = await createIntake(body as IntakeInput);
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "Некоректний JSON у запиті." }, { status: 400 });
    }
    if (error instanceof IntakeValidationError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 422 });
    }
    if (error instanceof IntakeConflictError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    }
    console.error("POST /api/intake failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося створити заявку в CRM." }, { status: 500 });
  }
}
