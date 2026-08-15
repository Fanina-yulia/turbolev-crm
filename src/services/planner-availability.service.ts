import { getPrisma } from "@/src/lib/prisma";

export type PlannerScheduleDay = {
  day: number;
  label: string;
  enabled: boolean;
  open: string;
  close: string;
  openMinute: number;
  closeMinute: number;
};

export type PlannerAvailability = {
  locationId: string;
  timezone: string;
  schedule: PlannerScheduleDay[];
};

export type PlannerScheduleConflict = {
  resourceType: "SCHEDULE";
  resource: string;
  start: Date;
  end: Date;
  message: string;
  day: number;
  dayLabel: string;
  enabled: boolean;
  open: string;
  close: string;
};

const DAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const WEEKDAY_NUMBER: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function minuteToPlannerClock(value: number) {
  const safe = Math.max(0, Math.min(1439, Math.round(value)));
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

export function plannerClockToMinute(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function normalizePlannerSchedule(
  value: unknown,
  fallbackOpenMinute: number,
  fallbackCloseMinute: number,
): PlannerScheduleDay[] {
  const fallbackOpen = minuteToPlannerClock(fallbackOpenMinute);
  const fallbackClose = minuteToPlannerClock(fallbackCloseMinute);
  const rows = Array.isArray(value) ? value : [];

  return DAY_LABELS.map((label, index) => {
    const expectedDay = index + 1;
    const raw = rows.find((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      return Number((entry as Record<string, unknown>).day) === expectedDay;
    }) ?? rows[index];
    const record = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const openMinute = plannerClockToMinute(record.open) ?? fallbackOpenMinute;
    const closeMinute = plannerClockToMinute(record.close) ?? fallbackCloseMinute;
    const validRange = closeMinute > openMinute;

    return {
      day: expectedDay,
      label: typeof record.label === "string" && record.label.trim()
        ? record.label.trim().slice(0, 4)
        : label,
      enabled: typeof record.enabled === "boolean" ? record.enabled : true,
      open: validRange ? minuteToPlannerClock(openMinute) : fallbackOpen,
      close: validRange ? minuteToPlannerClock(closeMinute) : fallbackClose,
      openMinute: validRange ? openMinute : fallbackOpenMinute,
      closeMinute: validRange ? closeMinute : fallbackCloseMinute,
    };
  });
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: WEEKDAY_NUMBER[values.weekday] ?? 1,
    dateKey: `${values.year}-${values.month}-${values.day}`,
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute),
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const wallClockAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return wallClockAsUtc - date.getTime();
}

export function plannerLocalDateTimeToUtc(day: string, time: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const minute = plannerClockToMinute(time);
  if (minute == null) return null;
  const [year, month, date] = day.split("-").map(Number);
  const wallClockAsUtc = new Date(Date.UTC(
    year,
    month - 1,
    date,
    Math.floor(minute / 60),
    minute % 60,
    0,
  ));
  const firstOffset = timeZoneOffsetMs(wallClockAsUtc, timeZone);
  const firstPass = new Date(wallClockAsUtc.getTime() - firstOffset);
  const refinedOffset = timeZoneOffsetMs(firstPass, timeZone);
  const result = new Date(wallClockAsUtc.getTime() - refinedOffset);
  return Number.isFinite(result.getTime()) ? result : null;
}

export function buildPlannerAvailability(input: {
  locationId: string;
  timezone?: string | null;
  openMinute: number;
  closeMinute: number;
  scheduleValue: unknown;
}): PlannerAvailability {
  return {
    locationId: input.locationId,
    timezone: input.timezone || "Europe/Kyiv",
    schedule: normalizePlannerSchedule(input.scheduleValue, input.openMinute, input.closeMinute),
  };
}

export async function getPlannerAvailability(locationId: string): Promise<PlannerAvailability | null> {
  const prisma = getPrisma();
  const [location, setting] = await Promise.all([
    prisma.serviceLocation.findUnique({
      where: { id: locationId },
      select: {
        id: true,
        timezone: true,
        openMinute: true,
        closeMinute: true,
        isActive: true,
      },
    }),
    prisma.crmSetting.findUnique({
      where: { key: "work_schedule" },
      select: { value: true },
    }),
  ]);

  if (!location || !location.isActive) return null;
  return buildPlannerAvailability({
    locationId: location.id,
    timezone: location.timezone,
    openMinute: location.openMinute,
    closeMinute: location.closeMinute,
    scheduleValue: setting?.value,
  });
}

export function validateAppointmentAgainstSchedule(
  availability: PlannerAvailability,
  start: Date,
  end: Date,
): { ok: true } | { ok: false; conflict: PlannerScheduleConflict } {
  const startLocal = localParts(start, availability.timezone);
  const endLocal = localParts(end, availability.timezone);
  const scheduleDay = availability.schedule.find((day) => day.day === startLocal.weekday)
    ?? availability.schedule[0];

  const outsideDay = startLocal.dateKey !== endLocal.dateKey;
  const outsideHours = startLocal.minuteOfDay < scheduleDay.openMinute
    || endLocal.minuteOfDay > scheduleDay.closeMinute;

  if (scheduleDay.enabled && !outsideDay && !outsideHours) return { ok: true };

  const message = !scheduleDay.enabled
    ? `${scheduleDay.label} — неробочий день. Перенесіть запис на робочий день.`
    : outsideDay
      ? `Один виробничий слот має завершуватися в той самий робочий день (${scheduleDay.open}–${scheduleDay.close}).`
      : `Запис виходить за графік СТО: ${scheduleDay.label} ${scheduleDay.open}–${scheduleDay.close}.`;

  return {
    ok: false,
    conflict: {
      resourceType: "SCHEDULE",
      resource: "Графік СТО",
      start,
      end,
      message,
      day: scheduleDay.day,
      dayLabel: scheduleDay.label,
      enabled: scheduleDay.enabled,
      open: scheduleDay.open,
      close: scheduleDay.close,
    },
  };
}
