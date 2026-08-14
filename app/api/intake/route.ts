import { NextResponse } from "next/server";
import { createIntake, IntakeConflictError, IntakeValidationError, type IntakeInput } from "@/src/services/intake.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = await request.json() as IntakeInput;
    const result = await createIntake(body);
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof IntakeValidationError) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (error instanceof IntakeConflictError) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    console.error("POST /api/intake failed", { message: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ ok: false, error: "Не вдалося створити заявку в CRM." }, { status: 500 });
  }
}
