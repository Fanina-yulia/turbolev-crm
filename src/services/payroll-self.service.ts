import { getPrisma } from "@/src/lib/prisma";

const DEFAULT_TIMEZONE = "Europe/Kyiv";

type LocalDateParts = { year: number; month: number; day: number };

function localParts(date: Date, timeZone = DEFAULT_TIMEZONE): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function zoneOffsetMs(date: Date, timeZone: string) {
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
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const representedAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return representedAsUtc - date.getTime();
}

function localMidnightUtc(parts: LocalDateParts, timeZone = DEFAULT_TIMEZONE) {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
  let result = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  // Re-evaluate once in case the first approximation crosses a DST boundary.
  result = new Date(naive - zoneOffsetMs(result, timeZone));
  return result;
}

function addLocalDays(parts: LocalDateParts, days: number): LocalDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function monthStart(parts: LocalDateParts): LocalDateParts {
  return { year: parts.year, month: parts.month, day: 1 };
}

function nextMonth(parts: LocalDateParts): LocalDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: 1 };
}

function mondayStart(parts: LocalDateParts): LocalDateParts {
  const localCalendarDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = localCalendarDate.getUTCDay();
  const distance = day === 0 ? 6 : day - 1;
  return addLocalDays(parts, -distance);
}

function money(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

async function aggregateRange(employeeId: string, start: Date, end: Date) {
  const prisma = getPrisma();
  const [accrual, payment] = await Promise.all([
    prisma.salaryAccrual.aggregate({
      where: {
        employeeId,
        status: "POSTED",
        occurredAt: { gte: start, lt: end },
      },
      _sum: { amount: true },
    }),
    prisma.salaryPayment.aggregate({
      where: {
        employeeId,
        paidAt: { gte: start, lt: end },
      },
      _sum: { amount: true },
    }),
  ]);

  const accrued = money(accrual._sum.amount);
  const paid = money(payment._sum.amount);
  return { accrued, paid, due: money(accrued - paid) };
}

/**
 * Server-only projection for the authenticated employee's own salary screen.
 * The caller must resolve employeeId from the authenticated session; never accept
 * arbitrary employeeId from a public client route without PAYROLL_VIEW_ALL.
 */
export async function getOwnSalaryOverview(args: {
  employeeId: string;
  now?: Date;
  timeZone?: string;
  historyMonths?: number;
}) {
  const prisma = getPrisma();
  const now = args.now ?? new Date();
  const timeZone = args.timeZone ?? DEFAULT_TIMEZONE;
  const todayParts = localParts(now, timeZone);
  const todayStart = localMidnightUtc(todayParts, timeZone);
  const tomorrowStart = localMidnightUtc(addLocalDays(todayParts, 1), timeZone);
  const weekParts = mondayStart(todayParts);
  const weekStart = localMidnightUtc(weekParts, timeZone);
  const weekEnd = localMidnightUtc(addLocalDays(weekParts, 7), timeZone);
  const currentMonthParts = monthStart(todayParts);
  const currentMonthStart = localMidnightUtc(currentMonthParts, timeZone);
  const currentMonthEnd = localMidnightUtc(nextMonth(currentMonthParts), timeZone);

  const [employee, today, week, month, monthDetails] = await Promise.all([
    prisma.employeeProfile.findUnique({
      where: { id: args.employeeId },
      select: { id: true, firstName: true, lastName: true, position: true, isActive: true },
    }),
    aggregateRange(args.employeeId, todayStart, tomorrowStart),
    aggregateRange(args.employeeId, weekStart, weekEnd),
    aggregateRange(args.employeeId, currentMonthStart, currentMonthEnd),
    prisma.salaryAccrual.findMany({
      where: {
        employeeId: args.employeeId,
        status: "POSTED",
        occurredAt: { gte: currentMonthStart, lt: currentMonthEnd },
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        category: true,
        amount: true,
        currency: true,
        occurredAt: true,
        sourceType: true,
        sourceId: true,
        description: true,
      },
    }),
  ]);

  if (!employee) throw new Error("Employee profile not found for authenticated user.");

  const categoryTotals = new Map<string, number>();
  for (const row of monthDetails) {
    categoryTotals.set(row.category, money((categoryTotals.get(row.category) ?? 0) + Number(row.amount)));
  }

  const historyMonths = Math.max(1, Math.min(args.historyMonths ?? 12, 36));
  const history: Array<{ key: string; start: Date; end: Date; accrued: number; paid: number; due: number }> = [];
  for (let index = historyMonths - 1; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(currentMonthParts.year, currentMonthParts.month - 1 - index, 1));
    const parts = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: 1 };
    const start = localMidnightUtc(parts, timeZone);
    const end = localMidnightUtc(nextMonth(parts), timeZone);
    const totals = await aggregateRange(args.employeeId, start, end);
    history.push({
      key: `${parts.year}-${String(parts.month).padStart(2, "0")}`,
      start,
      end,
      ...totals,
    });
  }

  return {
    employee,
    timeZone,
    today: { start: todayStart, end: tomorrowStart, ...today },
    week: { start: weekStart, end: weekEnd, ...week },
    month: {
      start: currentMonthStart,
      end: currentMonthEnd,
      ...month,
      byCategory: Object.fromEntries(categoryTotals),
      details: monthDetails.map((row) => ({ ...row, amount: money(row.amount) })),
    },
    history,
  };
}
