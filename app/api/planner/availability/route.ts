import { NextResponse } from "next/server";
import { AvailabilityInputError, getPlannerAvailability } from "@/src/services/availability.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || "";
    const locationId = searchParams.get("locationId");
    const excludeAppointmentId = searchParams.get("excludeAppointmentId");
    const durationRaw = searchParams.get("durationMinutes");
    const durationMinutes = durationRaw ? Number(durationRaw) : 60;
    const availability = await getPlannerAvailability({ date, locationId, durationMinutes, excludeAppointmentId });
    return NextResponse.json({ status: "OK", ...availability }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не вдалося розрахувати доступність.";
    return NextResponse.json(
      { status: error instanceof AvailabilityInputError ? "INVALID_DATA" : "ERROR", message },
      { status: error instanceof AvailabilityInputError ? 400 : 500 },
    );
  }
}
