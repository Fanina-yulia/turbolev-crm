import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getPlannerAvailability } from "@/src/services/planner-availability.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function normalizePlate(value: unknown) {
  return String(value || "").toUpperCase().replace(/[^A-ZА-ЯІЇЄ0-9]/gi, "");
}

function localDateTime(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    day: `${values.year}-${values.month}-${values.day}`,
    clock: `${values.hour}:${values.minute}`,
  };
}

export async function GET(request: NextRequest) {
  const date = (request.nextUrl.searchParams.get("date") || "").trim();
  const start = (request.nextUrl.searchParams.get("start") || "").trim();
  const plate = normalizePlate(request.nextUrl.searchParams.get("plate"));
  const postId = (request.nextUrl.searchParams.get("postId") || "").trim();
  const mechanicId = (request.nextUrl.searchParams.get("mechanicId") || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start)) {
    return NextResponse.json({ ok: false, error: "Некоректна дата або час запису." }, { status: 400 });
  }

  try {
    const prisma = getPrisma();
    const dayAnchor = new Date(`${date}T00:00:00.000Z`);
    const from = new Date(dayAnchor.getTime() - 14 * 60 * 60_000);
    const to = new Date(dayAnchor.getTime() + 38 * 60 * 60_000);

    const candidates = await prisma.serviceAppointment.findMany({
      where: {
        plannedStartAt: { gte: from, lt: to },
      },
      include: {
        post: true,
        mechanic: true,
        location: {
          include: {
            posts: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
            mechanics: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
          },
        },
      },
      orderBy: { plannedStartAt: "asc" },
      take: 120,
    });

    const exact = candidates
      .filter((item) => {
        const local = localDateTime(item.plannedStartAt, item.location.timezone || "Europe/Kyiv");
        if (local.day !== date || local.clock !== start) return false;
        if (plate && normalizePlate(item.plateNumber) !== plate) return false;
        return true;
      })
      .sort((left, right) => {
        const leftScore = (postId && left.postId === postId ? 2 : 0) + (mechanicId && left.mechanicId === mechanicId ? 2 : 0);
        const rightScore = (postId && right.postId === postId ? 2 : 0) + (mechanicId && right.mechanicId === mechanicId ? 2 : 0);
        return rightScore - leftScore;
      });

    const appointment = exact[0];
    if (!appointment) {
      return NextResponse.json({ ok: false, error: "Не вдалося однозначно знайти запис у Планувальнику." }, { status: 404 });
    }

    const [vehicle, availability, dayAppointments] = await Promise.all([
      appointment.vehicleId
        ? prisma.vehicle.findUnique({
            where: { id: appointment.vehicleId },
            select: {
              id: true,
              clientId: true,
              plateNumber: true,
              vin: true,
              brand: true,
              model: true,
              year: true,
              client: { select: { id: true, name: true, phone: true } },
            },
          })
        : Promise.resolve(null),
      getPlannerAvailability(appointment.locationId),
      prisma.serviceAppointment.findMany({
        where: {
          locationId: appointment.locationId,
          plannedStartAt: { gte: from, lt: to },
        },
        select: {
          id: true,
          postId: true,
          mechanicId: true,
          status: true,
          vehicleLabel: true,
          plateNumber: true,
          plannedStartAt: true,
          plannedEndAt: true,
        },
        orderBy: { plannedStartAt: "asc" },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      appointment,
      vehicle,
      location: appointment.location,
      workSchedule: availability?.schedule ?? [],
      dayAppointments,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("planner edit context failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити дані запису." }, { status: 500 });
  }
}
