import { NextResponse } from "next/server";
import {
  createPlannerAppointment,
  getPlannerBoard,
  normalizeAppointmentPayload,
} from "@/src/services/planner.service";

export const runtime = "nodejs";
export const maxDuration = 30;

function invalidDate(message: string) {
  return NextResponse.json({ status: "INVALID_RANGE", message }, { status: 400 });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = new Date(searchParams.get("from") ?? "");
  const to = new Date(searchParams.get("to") ?? "");
  const locationId = searchParams.get("locationId");

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
    return invalidDate("Передайте коректний часовий діапазон планувальника.");
  }

  const board = await getPlannerBoard(from, to, locationId);
  return NextResponse.json({ status: "OK", ...board }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const input = normalizeAppointmentPayload(body);
    const result = await createPlannerAppointment(input);
    if (!result.ok) {
      return NextResponse.json({
        status: "CONFLICT",
        message: `Конфлікт ресурсу: ${result.conflict.resource} вже зайнятий у цей час.`,
        conflict: result.conflict,
      }, { status: 409 });
    }
    return NextResponse.json({ status: "CREATED", appointment: result.appointment }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const message = code === "INVALID_TIME_RANGE"
      ? "Час завершення має бути пізніше часу початку."
      : code === "APPOINTMENT_TOO_LONG"
        ? "Один запис не може тривати більше 24 годин."
        : code === "LOCATION_REQUIRED"
          ? "Оберіть локацію СТО."
          : code === "INVALID_AMOUNT"
            ? "Некоректна попередня сума."
            : "Не вдалося створити запис.";
    return NextResponse.json({ status: "INVALID_DATA", message }, { status: 400 });
  }
}
