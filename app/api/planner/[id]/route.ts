import { NextResponse } from "next/server";
import { updatePlannerAppointment } from "@/src/services/planner.service";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const result = await updatePlannerAppointment(id, body);
    if (!result.ok && "notFound" in result) {
      return NextResponse.json({ status: "NOT_FOUND", message: "Запис не знайдено." }, { status: 404 });
    }
    if (!result.ok && "conflict" in result) {
      return NextResponse.json({
        status: "CONFLICT",
        message: result.conflict.resourceType === "MECHANIC"
          ? `Перенесення неможливе: ${result.conflict.resource} уже веде 2 автомобілі одночасно. Третє паралельне авто заборонено.`
          : `Перенесення неможливе: ${result.conflict.resource} уже зайнятий у цей час.`,
        conflict: result.conflict,
      }, { status: 409 });
    }
    return NextResponse.json({ status: "OK", appointment: result.appointment, warning: result.warning ?? null });
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
            : "Не вдалося змінити запис.";
    return NextResponse.json({ status: "INVALID_DATA", message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await updatePlannerAppointment(id, { status: "CANCELLED" });
  if (!result.ok && "notFound" in result) {
    return NextResponse.json({ status: "NOT_FOUND", message: "Запис не знайдено." }, { status: 404 });
  }
  return NextResponse.json({ status: "CANCELLED", appointment: result.ok ? result.appointment : null });
}
