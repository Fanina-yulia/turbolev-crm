import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { zonedDateKey, zonedDayRange } from "@/src/lib/zoned-time";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
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

async function resolvePlannerReadScope(access: Awaited<ReturnType<typeof authorize>>) {
  if (access.grantedScope === "ALL") {
    return { allowedLocationIds: null as string[] | null, mechanicIds: null as string[] | null };
  }
  if (access.grantedScope === "LOCATION") {
    return { allowedLocationIds: access.context.locationIds, mechanicIds: null as string[] | null };
  }
  if (access.grantedScope === "ASSIGNED") {
    const userId = access.context.user?.id;
    if (!userId) return { allowedLocationIds: [] as string[], mechanicIds: [] as string[] };
    const mechanics = await getPrisma().serviceMechanic.findMany({
      where: {
        userId,
        isActive: true,
        ...(access.context.locationIds.length ? { locationId: { in: access.context.locationIds } } : {}),
      },
      select: { id: true, locationId: true },
    });
    return {
      allowedLocationIds: [...new Set(mechanics.map((row) => row.locationId))],
      mechanicIds: mechanics.map((row) => row.id),
    };
  }
  return { allowedLocationIds: [] as string[], mechanicIds: [] as string[] };
}

function allowedWriteLocations(access: Awaited<ReturnType<typeof authorize>>) {
  return access.grantedScope === "ALL" ? null : access.context.locationIds;
}

function scopeDenied(message = "Ця локація не входить до Вашого доступу.") {
  return NextResponse.json({ status: "FORBIDDEN", message }, { status: 403 });
}

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.PLANNER_READ, { strict: true, request, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;

  const { searchParams } = new URL(request.url);
  let from = new Date(searchParams.get("from") ?? "");
  let to = new Date(searchParams.get("to") ?? "");
  const requestedLocationId = searchParams.get("locationId")?.trim() || null;
  const requestedAppointmentId = searchParams.get("appointmentId")?.trim() || null;

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
    return invalidDate("Передайте коректний часовий діапазон планувальника.");
  }

  const scope = await resolvePlannerReadScope(access);
  if (scope.allowedLocationIds !== null && !scope.allowedLocationIds.length) {
    return NextResponse.json({ status: "OK", locations: [], activeLocationId: null, appointments: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  let selectedLocationId = requestedLocationId ?? scope.allowedLocationIds?.[0] ?? null;
  if (requestedAppointmentId) {
    const focusedAppointment = await getPrisma().serviceAppointment.findUnique({
      where: { id: requestedAppointmentId },
      select: {
        locationId: true,
        mechanicId: true,
        plannedStartAt: true,
        location: { select: { timezone: true } },
      },
    });
    if (!focusedAppointment) {
      return NextResponse.json({ status: "NOT_FOUND", message: "Запис планувальника не знайдено." }, { status: 404 });
    }
    if (scope.allowedLocationIds !== null && !scope.allowedLocationIds.includes(focusedAppointment.locationId)) {
      return scopeDenied();
    }
    if (scope.mechanicIds !== null && (!focusedAppointment.mechanicId || !scope.mechanicIds.includes(focusedAppointment.mechanicId))) {
      return scopeDenied("Цей запис не належить до Ваших призначених робіт.");
    }

    const timeZone = focusedAppointment.location.timezone || "Europe/Kyiv";
    const focusedDay = zonedDateKey(focusedAppointment.plannedStartAt, timeZone);
    const focusedRange = zonedDayRange(focusedDay, timeZone);
    from = focusedRange.from;
    to = focusedRange.to;
    selectedLocationId = focusedAppointment.locationId;
  } else if (requestedLocationId && scope.allowedLocationIds !== null && !scope.allowedLocationIds.includes(requestedLocationId)) {
    return scopeDenied();
  }

  const board = await getPlannerBoard(from, to, selectedLocationId);
  const allowedSet = scope.allowedLocationIds === null ? null : new Set(scope.allowedLocationIds);
  const mechanicSet = scope.mechanicIds === null ? null : new Set(scope.mechanicIds);
  const locations = board.locations
    .filter((location) => !allowedSet || allowedSet.has(location.id))
    .map((location) => mechanicSet
      ? { ...location, mechanics: location.mechanics.filter((mechanic) => mechanicSet.has(mechanic.id)) }
      : location);
  const appointments = mechanicSet
    ? board.appointments.filter((appointment) => Boolean(appointment.mechanicId && mechanicSet.has(appointment.mechanicId)))
    : board.appointments;
  const activeLocationId = board.activeLocationId && (!allowedSet || allowedSet.has(board.activeLocationId)) ? board.activeLocationId : null;

  return NextResponse.json({ status: "OK", locations, activeLocationId, appointments }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const access = await authorize(PERMISSIONS.PLANNER_WRITE, { strict: true, request, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const input = normalizeAppointmentPayload(body);
    const locations = allowedWriteLocations(access);

    if (locations !== null && !locations.includes(input.locationId)) {
      return scopeDenied();
    }

    if (access.grantedScope === "ASSIGNED" && input.leadId) {
      const lead = await getPrisma().lead.findUnique({ where: { id: input.leadId }, select: { assignedUserId: true } });
      if (!lead || lead.assignedUserId !== access.context.user?.id) {
        return scopeDenied("Цей запис не належить до Ваших призначених звернень.");
      }
    }

    input.createdById = access.context.user?.id ?? null;
    const result = await createPlannerAppointment(input);
    if (!result.ok) {
      return NextResponse.json({
        status: "CONFLICT",
        message: result.conflict.resourceType === "MECHANIC"
          ? `Механік ${result.conflict.resource} уже веде 2 автомобілі одночасно. Третє паралельне авто заборонено.`
          : `Конфлікт ресурсу: ${result.conflict.resource} уже зайнятий у цей час.`,
        conflict: result.conflict,
      }, { status: 409 });
    }
    return NextResponse.json({ status: "CREATED", appointment: result.appointment, warning: result.warning ?? null }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const message = code === "MECHANIC_REQUIRED"
      ? "Оберіть механіка, якого потрібно закріпити за активним записом."
      : code === "MECHANIC_UNAVAILABLE"
        ? "Обраний механік неактивний або не належить до цієї локації."
        : code === "POST_UNAVAILABLE"
          ? "Обраний пост неактивний або не належить до цієї локації."
      : code === "INVALID_TIME_RANGE"
      ? "Час завершення має бути пізніше часу початку."
      : code === "APPOINTMENT_TOO_LONG"
        ? "Один запис не може тривати більше 24 годин."
        : code === "LOCATION_REQUIRED"
          ? "Оберіть локацію СТО."
          : code === "INVALID_AMOUNT"
            ? "Некоректна попередня сума."
            : "Не вдалося створити запис.";
    return NextResponse.json({ status: "INVALID_DATA", code, message }, { status: ["MECHANIC_REQUIRED", "MECHANIC_UNAVAILABLE", "POST_UNAVAILABLE"].includes(code) ? 422 : 400 });
  }
}
