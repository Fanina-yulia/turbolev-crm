import { NextResponse } from "next/server";
import { authorizeScopedLocation } from "@/src/security/scoped-location-access";
import { PERMISSIONS } from "@/src/security/permissions";
import { AvailabilityInputError, getPlannerAvailability } from "@/src/services/availability.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || "";
    const requestedLocationId = searchParams.get("locationId");
    // Fail closed: session + PLANNER.READ; LOCATION scope may only read its own stations.
    const access = await authorizeScopedLocation(PERMISSIONS.PLANNER_READ, request, requestedLocationId);
    if (!access.ok) return access.response;
    // Without an explicit station a location-scoped user gets their own first station, never the global default.
    const locationId = requestedLocationId ?? access.allowedLocationIds?.[0] ?? null;
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
