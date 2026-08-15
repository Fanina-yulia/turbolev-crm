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

function minuteToClock(value: number) {
  const safe = Math.max(0, Math.min(1439, Math.round(value)));
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

function parseClock(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function normalizeSchedule(
  value: unknown,
  fallbackOpenMinute: number,
  fallbackCloseMinute: number,
): PlannerScheduleDay[] {
  const fallbackOpen = minuteToClock(fallbackOpenMinute);
  const fallbackClose = minuteToClock(fallbackCloseMinute);
  const rows = Array.isArray(value) ? value : [];

  return DAY_LABELS.map((label, index) => {
    const expectedDay = index + 1;
    const raw = rows.find((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const day = Number((entry as Record<string, unknown>).day);
      return day === expectedDay;
    }) ?? rows[index];

    const record = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const openMinute = parseClock(record.open) ?? fallbackOpenMinute;
    const closeMinute = parseClock(record.close) ?? fallbackCloseMinute;
    const validRange = closeMinute > openMinute;

    return {
      day: expectedDay,
      label: typeof record.label === "string" && record.label.trim()
        ? record.label.trim().slice(0, 4)
        : label,
      enabled: typeof record.enabled === "boolean" ? record.enabled : true,
      open: validRange ? minuteToClock(openMinute) : fallbackOpen,
      close: validRange ? minuteToClock(closeMinute) : fallbackClose,
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
  const weekday = WEEKDAY_NUMBER[values.weekday] ?? 1;
  const hour = Number(values.hour);
  const minute = Number(values.minute);

  return {
    weekday,
    dateKey: `${values.year}-${values.month}-${values.day}`,
    minuteOfDay: hour * 60 + minute,
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

  return {
    locationId: location.id,
    timezone: location.timezone || "Europe/Kyiv",
    schedule: normalizeSchedule(setting?.value, location.openMinute, location.closeMinute),
  };
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
