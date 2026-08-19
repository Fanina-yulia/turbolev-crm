import { getPrisma } from "@/src/lib/prisma";
import { minuteLabel, zonedDateTimeToDate, zonedDayRange } from "@/src/lib/zoned-time";
import { PLANNER_BLOCKING_STATUSES } from "@/src/services/planner.service";

export class AvailabilityInputError extends Error {}

export type AvailabilityQuery = {
  date: string;
  locationId?: string | null;
  durationMinutes?: number;
  excludeAppointmentId?: string | null;
};

export type AvailabilityResourceState = {
  id: string;
  name: string;
  available: boolean;
  parallelCount?: number;
};

export type AvailabilitySlot = {
  time: string;
  startAt: string;
  endAt: string;
  available: boolean;
  posts: AvailabilityResourceState[];
  mechanics: AvailabilityResourceState[];
};

function validDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function overlap(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

export async function getPlannerAvailability(query: AvailabilityQuery) {
  if (!validDateKey(query.date)) throw new AvailabilityInputError("Передайте дату у форматі YYYY-MM-DD.");
  const durationMinutes = Number(query.durationMinutes ?? 60);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 24 * 60 || durationMinutes % 30 !== 0) {
    throw new AvailabilityInputError("Тривалість має бути кратною 30 хвилинам.");
  }

  const prisma = getPrisma();
  const locations = await prisma.serviceLocation.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      posts: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      mechanics: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
    },
  });
  const location = (query.locationId ? locations.find((item) => item.id === query.locationId) : null) ?? locations[0] ?? null;
  if (!location) throw new AvailabilityInputError("У CRM немає активної локації СТО.");
  if (query.locationId && location.id !== query.locationId) throw new AvailabilityInputError("Обрана локація СТО недоступна.");

  const timeZone = location.timezone || "Europe/Kyiv";
  const { from, to } = zonedDayRange(query.date, timeZone);
  const appointments = await prisma.serviceAppointment.findMany({
    where: {
      id: query.excludeAppointmentId ? { not: query.excludeAppointmentId } : undefined,
      locationId: location.id,
      status: { in: [...PLANNER_BLOCKING_STATUSES] },
      plannedStartAt: { lt: to },
      plannedEndAt: { gt: from },
    },
    select: {
      id: true,
      postId: true,
      mechanicId: true,
      plannedStartAt: true,
      plannedEndAt: true,
      plateNumber: true,
      vehicleLabel: true,
    },
  });

  const openMinute = Number.isFinite(location.openMinute) ? location.openMinute : 9 * 60;
  const closeMinute = Number.isFinite(location.closeMinute) ? location.closeMinute : 21 * 60;
  const slots: AvailabilitySlot[] = [];

  for (let minute = openMinute; minute + durationMinutes <= closeMinute; minute += 30) {
    const time = minuteLabel(minute);
    const start = zonedDateTimeToDate(query.date, time, timeZone);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    const startMs = start.getTime();
    const endMs = end.getTime();
    const overlapping = appointments.filter((appointment) => overlap(
      startMs,
      endMs,
      appointment.plannedStartAt.getTime(),
      appointment.plannedEndAt.getTime(),
    ));

    const posts = location.posts.map((post) => ({
      id: post.id,
      name: post.name,
      available: !overlapping.some((appointment) => appointment.postId === post.id),
    }));
    const mechanics = location.mechanics.map((mechanic) => {
      const parallelCount = overlapping.filter((appointment) => appointment.mechanicId === mechanic.id).length;
      return { id: mechanic.id, name: mechanic.name, available: parallelCount < 2, parallelCount };
    });
    const postAvailable = posts.some((post) => post.available);
    const mechanicAvailable = mechanics.length === 0 || mechanics.some((mechanic) => mechanic.available);

    slots.push({
      time,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      available: postAvailable && mechanicAvailable,
      posts,
      mechanics,
    });
  }

  return {
    date: query.date,
    durationMinutes,
    slotMinutes: 30,
    location: {
      id: location.id,
      name: location.name,
      timezone: timeZone,
      openMinute,
      closeMinute,
    },
    locations: locations.map((item) => ({ id: item.id, name: item.name, timezone: item.timezone || "Europe/Kyiv" })),
    slots,
  };
}
