import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { createIntake, IntakeConflictError, IntakeValidationError, type IntakeInput } from "@/src/services/intake.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DURATION_COOKIE = "turbolev_booking_duration_minutes";

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}
function clearDurationCookie(response: NextResponse) {
  response.cookies.set(DURATION_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
  return response;
}

export async function POST(request: Request) {
  const access = await authorize(PERMISSIONS.LEADS_WRITE, { request, minimumScope: "TEAM" });
  if (!access.allowed) return access.response!;

  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new IntakeValidationError("Тіло запиту повинно бути JSON-об'єктом.");
    }

    const input = { ...(body as IntakeInput) };
    if (input.appointmentDurationMinutes === undefined || input.appointmentDurationMinutes === null || input.appointmentDurationMinutes === "") {
      const durationFromScheduler = Number(cookieValue(request, DURATION_COOKIE));
      if (Number.isFinite(durationFromScheduler) && durationFromScheduler >= 30) {
        input.appointmentDurationMinutes = durationFromScheduler;
      }
    }

    const result = await createIntake(input);
    return clearDurationCookie(NextResponse.json({ ok: true, ...result }, { status: 201 }));
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
