import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { managementGrossFromSnapshot, roundMoney, weekKeys } from "@/src/domain/management-result";
import {
  DEFAULT_STAGE_PROBABILITIES,
  blendedHistoricalProbability,
  calculateStationManagerBonus,
  deriveManagementDeviations,
  gapClosingRecommendations,
  paceForecast,
  shiftAvailableMinutes,
  weightedPipelineForecast,
} from "@/src/domain/management-intelligence";

const TZ = "Europe/Kyiv";
const STATUS_RANK: Record<string, number> = {
  BOOKED: 1, ARRIVED: 2, DIAGNOSTICS: 3, WAITING_PARTS_SELECTION: 4, WAITING_CALCULATION: 5,
  WAITING_APPROVAL: 6, WAITING_PARTS: 7, READY_FOR_REPAIR: 8, IN_REPAIR: 9, WAITING_QC: 10,
  WAITING_PAYMENT: 11, READY_FOR_PICKUP: 12, COMPLETED: 13,
};
const PIPELINE_STATUSES = Object.keys(DEFAULT_STAGE_PROBABILITIES);
const ACTIVE_STATUSES = ["ARRIVED", "DIAGNOSTICS", "WAITING_PARTS_SELECTION", "WAITING_CALCULATION", "WAITING_APPROVAL", "WAITING_PARTS", "READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "WAITING_PAYMENT", "READY_FOR_PICKUP", "PAUSED"];

export type ManagementBaseResult = {
  range: { from: string; to: string; timezone: string; days: number };
  plan: null | { id: string; targetAmount: number | null; breakEvenAmount: number | null; status: string };
  result: {
    target: number | null;
    targetToNow: number | null;
    fact: number;
    cashIn: number;
    confirmedForecast: number;
    baseForecast: number;
    optimisticForecast: number;
    gap: number | null;
    remainingDays: number;
    activePosts: number;
  };
  breakdown: { workOrderFact: number; directServiceFact: number; confirmedPipeline: number; basePipeline: number; optimisticPipeline: number };
  locations: Array<{ id: string; name: string; target: number | null; fact: number; confirmedForecast: number; baseForecast: number; optimisticForecast: number; gap: number | null; progressPct: number | null; activePosts: number; capacityMinutes: number }>;
  dataQuality: { finalizedWorkOrders: number; closedWithoutFinalFinance: number; pipelineWithoutPlannedFinance: number; forecastCompleteness: string };
};

function numberOf(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function money(value: unknown) { return roundMoney(numberOf(value)); }
function pct(part: number, total: number) { return total > 0 ? Math.round(part / total * 1000) / 10 : null; }
function dateOnly(key: string) { return new Date(`${key}T00:00:00.000Z`); }
function dateKey(date = new Date(), timeZone = TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function offsetMinutes(date: Date, timeZone: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset", hour: "2-digit" }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
  const match = name?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === "+" ? minutes : -minutes;
}
function startUtc(key: string, timeZone = TZ) {
  const [year, month, day] = key.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  const offset = offsetMinutes(probe, timeZone);
  return new Date(Date.UTC(year, month - 1, day, 0, -offset));
}
function minutesBetween(a: Date | null | undefined, b: Date | null | undefined) {
  if (!a || !b) return 0;
  return Math.max(0, b.getTime() - a.getTime()) / 60_000;
}
function lineRevenue(row: { actualQuantity: unknown; plannedQuantity: unknown; actualUnitPrice: unknown; plannedUnitPrice: unknown; actualDiscount: unknown; plannedDiscount: unknown }) {
  const quantity = row.actualQuantity == null ? numberOf(row.plannedQuantity) : numberOf(row.actualQuantity);
  const price = row.actualUnitPrice == null ? numberOf(row.plannedUnitPrice) : numberOf(row.actualUnitPrice);
  const discount = row.actualDiscount == null ? numberOf(row.plannedDiscount) : numberOf(row.actualDiscount);
  return roundMoney(Math.max(0, quantity * price - discount));
}

function productiveMinutesForWeek(locations: Array<{ id: string; timezone: string; openMinute: number; closeMinute: number; posts: Array<{ id: string }> }>, weekDays: string[], now: Date) {
  let total = 0;
  let elapsed = 0;
  for (const location of locations) {
    const daily = Math.max(0, location.closeMinute - location.openMinute) * location.posts.length;
    total += daily * weekDays.length;
    const today = dateKey(now, location.timezone || TZ);
    for (const day of weekDays) {
      if (day < today) elapsed += daily;
      else if (day === today) {
        const parts = new Intl.DateTimeFormat("en-GB", { timeZone: location.timezone || TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
        const minute = Number(parts.find((part) => part.type === "hour")?.value || 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value || 0);
        const perPost = Math.min(Math.max(0, minute - location.openMinute), Math.max(0, location.closeMinute - location.openMinute));
        elapsed += perPost * location.posts.length;
      }
    }
  }
  return { total, elapsed: Math.min(total, elapsed) };
}

function schemeJson(row: {
  id?: string | null; basis: string; activationThresholdPct: unknown; basePercent: unknown; fixedAmount?: unknown; tier2ThresholdPct?: unknown; tier2Percent?: unknown; tier3ThresholdPct?: unknown; tier3Percent?: unknown; minMarginPct?: unknown; maxWarrantyRatePct?: unknown; maxOverdueReceivablePct?: unknown; minDataQualityPct?: unknown; capAmount?: unknown;
}) {
  return {
    id: row.id ?? null,
    basis: row.basis,
    activationThresholdPct: numberOf(row.activationThresholdPct),
    basePercent: numberOf(row.basePercent),
    fixedAmount: row.fixedAmount == null ? null : money(row.fixedAmount),
    tier2ThresholdPct: row.tier2ThresholdPct == null ? null : numberOf(row.tier2ThresholdPct),
    tier2Percent: row.tier2Percent == null ? null : numberOf(row.tier2Percent),
    tier3ThresholdPct: row.tier3ThresholdPct == null ? null : numberOf(row.tier3ThresholdPct),
    tier3Percent: row.tier3Percent == null ? null : numberOf(row.tier3Percent),
    minMarginPct: row.minMarginPct == null ? null : numberOf(row.minMarginPct),
    maxWarrantyRatePct: row.maxWarrantyRatePct == null ? null : numberOf(row.maxWarrantyRatePct),
    maxOverdueReceivablePct: row.maxOverdueReceivablePct == null ? null : numberOf(row.maxOverdueReceivablePct),
    minDataQualityPct: row.minDataQualityPct == null ? null : numberOf(row.minDataQualityPct),
    capAmount: row.capAmount == null ? null : money(row.capAmount),
  };
}

const DEFAULT_SCHEME = schemeJson({
  basis: "ABOVE_BREAK_EVEN",
  activationThresholdPct: 90,
  basePercent: 3,
  tier2ThresholdPct: 100,
  tier2Percent: 4,
  tier3ThresholdPct: 110,
  tier3Percent: 5,
  minMarginPct: 20,
  maxWarrantyRatePct: 10,
  maxOverdueReceivablePct: 20,
  minDataQualityPct: 85,
  capAmount: null,
});

export async function getManagementIntelligence(input: {
  anchor?: string | null;
  locationIds?: string[] | null;
  selectedLocationId?: string | null;
  base: ManagementBaseResult;
}) {
  const prisma = getPrisma();
  const week = weekKeys(input.anchor || input.base.range.from);
  const from = startUtc(week.start);
  const to = startUtc(week.endExclusive);
  const historicalFrom = new Date(from.getTime() - 90 * 86_400_000);
  const previousFrom = new Date(from.getTime() - 7 * 86_400_000);
  const now = new Date();
  const requested = input.selectedLocationId ? [input.selectedLocationId] : input.locationIds;
  const scopeIds = requested?.length ? [...new Set(requested)] : null;

  const locations = await prisma.serviceLocation.findMany({
    where: { isActive: true, ...(scopeIds ? { id: { in: scopeIds } } : {}) },
    select: {
      id: true, name: true, timezone: true, openMinute: true, closeMinute: true,
      posts: { where: { isActive: true }, select: { id: true, name: true, sortOrder: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
      mechanics: { where: { isActive: true }, select: { id: true, employeeId: true, userId: true, name: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const locationIds = locations.map((row) => row.id);
  const mechanicIds = locations.flatMap((row) => row.mechanics.map((item) => item.id));
  const employeeIds = locations.flatMap((row) => row.mechanics.map((item) => item.employeeId).filter((id): id is string => Boolean(id)));

  const plan = input.base.plan?.id ? await prisma.managementPlan.findUnique({
    where: { id: input.base.plan.id },
    include: { allocations: true },
  }) : null;

  const [appointments, historyAppointments, shifts, assignments, laborLines, economics, kpiRows, receivables, schemes] = await Promise.all([
    prisma.serviceAppointment.findMany({
      where: { plannedStartAt: { gte: from, lt: to }, status: { notIn: ["CANCELLED", "RESERVE"] }, NOT: { id: { startsWith: "demo_" } }, ...(locationIds.length ? { locationId: { in: locationIds } } : {}) },
      select: { id: true, locationId: true, postId: true, mechanicId: true, workOrderId: true, status: true, plannedStartAt: true, plannedEndAt: true, actualStartAt: true, actualEndAt: true, actualArrivalAt: true, estimatedAmount: true },
    }),
    prisma.serviceAppointment.findMany({
      where: { plannedStartAt: { gte: historicalFrom, lt: previousFrom }, status: { not: "RESERVE" }, NOT: { id: { startsWith: "demo_" } }, ...(locationIds.length ? { locationId: { in: locationIds } } : {}) },
      select: { status: true },
      take: 5000,
    }),
    prisma.employeeShift.findMany({
      where: { day: { gte: dateOnly(week.start), lte: dateOnly(week.end) }, ...(locationIds.length ? { locationId: { in: locationIds } } : {}) },
      orderBy: [{ day: "asc" }, { employeeId: "asc" }],
    }),
    prisma.employeeRoleAssignment.findMany({
      where: { startsAt: { lt: to }, OR: [{ endsAt: null }, { endsAt: { gt: from } }], ...(locationIds.length ? { locationId: { in: locationIds } } : {}) },
      include: { employee: true, role: true },
      orderBy: [{ isPrimary: "desc" }, { startsAt: "asc" }],
    }),
    mechanicIds.length ? prisma.workOrderLine.findMany({
      where: { mechanicId: { in: mechanicIds }, completedAt: { gte: from, lt: to }, status: "COMPLETED", NOT: { workOrderId: { startsWith: "demo_" } } },
      select: { id: true, workOrderId: true, mechanicId: true, type: true, laborHours: true, actualQuantity: true, plannedQuantity: true, actualUnitPrice: true, plannedUnitPrice: true, actualUnitCost: true, plannedUnitCost: true, actualDiscount: true, plannedDiscount: true },
    }) : Promise.resolve([]),
    employeeIds.length ? prisma.employeeEconomicsSnapshot.findMany({
      where: { employeeId: { in: employeeIds }, periodStart: { lte: dateOnly(week.end) }, periodEnd: { gte: dateOnly(week.start) } },
      orderBy: { computedAt: "desc" },
    }) : Promise.resolve([]),
    employeeIds.length ? prisma.employeeKpiResult.findMany({
      where: { employeeId: { in: employeeIds }, periodStart: { lte: dateOnly(week.end) }, periodEnd: { gte: dateOnly(week.start) } },
      select: { employeeId: true, score: true, targetValue: true, actualValue: true, kpi: { select: { code: true, name: true } } },
    }) : Promise.resolve([]),
    prisma.financialObligation.findMany({
      where: { direction: "RECEIVABLE", status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] }, ...(locationIds.length ? { locationId: { in: locationIds } } : {}) },
      select: { amount: true, settledAmount: true, status: true, dueAt: true, locationId: true },
    }),
    prisma.stationBonusScheme.findMany({
      where: { isActive: true, effectiveFrom: { lte: dateOnly(week.end) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: dateOnly(week.start) } }], ...(locationIds.length ? { OR: [{ locationId: null }, { locationId: { in: locationIds } }] } : {}) },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  const workOrderIds = [...new Set(appointments.map((row) => row.workOrderId).filter((id): id is string => Boolean(id)))];
  const closedOrderIds = workOrderIds.length ? (await prisma.workOrder.findMany({ where: { id: { in: workOrderIds }, status: "CLOSED", closedAt: { gte: from, lt: to } }, select: { id: true } })).map((row) => row.id) : [];
  const previousLinkedIds = locationIds.length ? (await prisma.serviceAppointment.findMany({ where: { locationId: { in: locationIds }, plannedStartAt: { gte: previousFrom, lt: from }, workOrderId: { not: null }, NOT: { id: { startsWith: "demo_" } } }, select: { workOrderId: true }, distinct: ["workOrderId"] })).map((row) => row.workOrderId).filter((id): id is string => Boolean(id)) : [];
  const currentActual = closedOrderIds.length ? await prisma.workOrderFinanceSnapshot.findMany({ where: { workOrderId: { in: closedOrderIds }, kind: "ACTUAL", lockedAt: { not: null } } }) : [];
  const previousActual = previousLinkedIds.length ? await prisma.workOrderFinanceSnapshot.findMany({ where: { workOrderId: { in: previousLinkedIds }, kind: "ACTUAL", lockedAt: { not: null } } }) : [];
  const pipelineIds = workOrderIds.filter((id) => !closedOrderIds.includes(id));
  const plannedSnapshots = pipelineIds.length ? await prisma.workOrderFinanceSnapshot.findMany({ where: { workOrderId: { in: pipelineIds }, kind: "PLANNED" } }) : [];
  const plannedByOrder = new Map(plannedSnapshots.map((row) => [row.workOrderId, managementGrossFromSnapshot(row)]));

  const workOrderLocation = new Map<string, string>();
  const workOrderPost = new Map<string, string>();
  const workOrderStatus = new Map<string, string>();
  for (const appointment of appointments) {
    if (!appointment.workOrderId) continue;
    const currentStatus = workOrderStatus.get(appointment.workOrderId);
    if (!currentStatus || (STATUS_RANK[appointment.status] || 0) > (STATUS_RANK[currentStatus] || 0)) {
      workOrderStatus.set(appointment.workOrderId, appointment.status);
      workOrderLocation.set(appointment.workOrderId, appointment.locationId);
      if (appointment.postId) workOrderPost.set(appointment.workOrderId, appointment.postId);
    }
  }

  const probabilityRows = PIPELINE_STATUSES.map((status) => {
    const rank = STATUS_RANK[status] || 0;
    const eligibleRows = historyAppointments.filter((row) => row.status === "COMPLETED" || (STATUS_RANK[row.status] || 0) >= rank || row.status === "NO_SHOW" || row.status === "CANCELLED");
    const completed = eligibleRows.filter((row) => row.status === "COMPLETED").length;
    const probability = blendedHistoricalProbability({ status, completed, eligible: eligibleRows.length });
    return { status, probability, sampleSize: eligibleRows.length, completed };
  });
  const probabilities = Object.fromEntries(probabilityRows.map((row) => [row.status, row.probability]));
  const weightedEntries = pipelineIds.flatMap((id) => {
    const amount = plannedByOrder.get(id);
    const status = workOrderStatus.get(id);
    return amount != null && status ? [{ status, amount }] : [];
  });
  const weightedForecast = weightedPipelineForecast(input.base.result.fact, weightedEntries, probabilities);
  const productive = productiveMinutesForWeek(locations, week.days, now);
  const pace = paceForecast(input.base.result.fact, productive.elapsed, productive.total);
  const conservativeForecast = input.base.result.confirmedForecast;

  const grossRevenue = currentActual.reduce((sum, row) => sum + numberOf(row.grossRevenue), 0);
  const grossProfit = currentActual.reduce((sum, row) => sum + numberOf(row.grossProfit), 0);
  const partsRevenue = currentActual.reduce((sum, row) => sum + numberOf(row.partsRevenue), 0);
  const partsCost = currentActual.reduce((sum, row) => sum + numberOf(row.partsCost), 0);
  const grossMarginPct = pct(grossProfit, grossRevenue);
  const partsMarginPct = partsRevenue > 0 ? Math.round((partsRevenue - partsCost) / partsRevenue * 1000) / 10 : null;
  const averageCheck = currentActual.length ? roundMoney(grossRevenue / currentActual.length) : null;
  const previousRevenue = previousActual.reduce((sum, row) => sum + numberOf(row.grossRevenue), 0);
  const previousAverageCheck = previousActual.length ? roundMoney(previousRevenue / previousActual.length) : null;

  const warrantyClaims = closedOrderIds.length ? await prisma.warrantyClaim.findMany({
    where: { createdAt: { gte: from, lt: to }, workOrderLine: { workOrderId: { in: closedOrderIds } } },
    select: { id: true, status: true, workOrderLineId: true },
  }) : [];
  const warrantyRatePct = closedOrderIds.length ? Math.round(warrantyClaims.length / closedOrderIds.length * 1000) / 10 : null;
  const receivableTotal = receivables.reduce((sum, row) => sum + Math.max(0, numberOf(row.amount) - numberOf(row.settledAmount)), 0);
  const overdueReceivable = receivables.filter((row) => row.status === "OVERDUE" || (row.dueAt && row.dueAt < now)).reduce((sum, row) => sum + Math.max(0, numberOf(row.amount) - numberOf(row.settledAmount)), 0);
  const overdueReceivablePct = receivableTotal > 0 ? Math.round(overdueReceivable / receivableTotal * 1000) / 10 : 0;
  const qualityDenominator = input.base.dataQuality.finalizedWorkOrders + input.base.dataQuality.closedWithoutFinalFinance + input.base.dataQuality.pipelineWithoutPlannedFinance;
  const qualityNumerator = input.base.dataQuality.finalizedWorkOrders + Math.max(0, weightedEntries.length);
  const dataQualityPct = qualityDenominator > 0 ? Math.max(0, Math.min(100, Math.round(qualityNumerator / qualityDenominator * 1000) / 10)) : 100;

  const actualByPost = new Map<string, number>();
  for (const row of currentActual) {
    const postId = workOrderPost.get(row.workOrderId);
    if (!postId) continue;
    actualByPost.set(postId, roundMoney((actualByPost.get(postId) || 0) + managementGrossFromSnapshot(row)));
  }
  const postTargets = new Map((plan?.allocations || []).filter((row) => row.level === "POST" && row.postId).map((row) => [row.postId!, money(row.targetAmount)]));
  const posts = locations.flatMap((location) => location.posts.map((post) => {
    const rows = appointments.filter((row) => row.postId === post.id);
    const usedMinutes = rows.reduce((sum, row) => sum + minutesBetween(row.plannedStartAt, row.plannedEndAt), 0);
    const productiveMinutes = rows.reduce((sum, row) => sum + minutesBetween(row.actualStartAt, row.actualEndAt), 0);
    const capacityMinutes = Math.max(0, location.closeMinute - location.openMinute) * week.days.length;
    const target = postTargets.get(post.id) ?? null;
    const fact = actualByPost.get(post.id) || 0;
    const openPipeline = rows.reduce((sum, row) => sum + (row.workOrderId ? (plannedByOrder.get(row.workOrderId) || 0) * (probabilities[row.status] ?? 0) : 0), 0);
    const freeMinutes = Math.max(0, capacityMinutes - usedMinutes);
    return {
      id: post.id,
      name: post.name,
      locationId: location.id,
      locationName: location.name,
      target,
      fact,
      weightedForecast: roundMoney(fact + openPipeline),
      capacityMinutes,
      bookedMinutes: Math.round(usedMinutes),
      productiveMinutes: Math.round(productiveMinutes),
      freeMinutes: Math.round(freeMinutes),
      utilizationPct: capacityMinutes > 0 ? Math.round(usedMinutes / capacityMinutes * 1000) / 10 : null,
      resultPerAvailableHour: capacityMinutes > 0 ? roundMoney(fact / (capacityMinutes / 60)) : null,
      currentVehicle: rows.find((row) => row.status === "IN_REPAIR")?.id || null,
    };
  }));

  const mechanicByEmployee = new Map<string, { id: string; name: string; locationId: string }>();
  for (const location of locations) for (const mechanic of location.mechanics) if (mechanic.employeeId) mechanicByEmployee.set(mechanic.employeeId, { id: mechanic.id, name: mechanic.name, locationId: location.id });
  const shiftByEmployee = new Map<string, typeof shifts>();
  for (const shift of shifts) {
    const bucket = shiftByEmployee.get(shift.employeeId) || [];
    bucket.push(shift);
    shiftByEmployee.set(shift.employeeId, bucket);
  }
  const economicsByEmployee = new Map<string, (typeof economics)[number]>();
  for (const row of economics) if (!economicsByEmployee.has(row.employeeId)) economicsByEmployee.set(row.employeeId, row);
  const kpisByEmployee = new Map<string, typeof kpiRows>();
  for (const row of kpiRows) {
    const bucket = kpisByEmployee.get(row.employeeId) || [];
    bucket.push(row);
    kpisByEmployee.set(row.employeeId, bucket);
  }
  const warrantyLineIds = new Set(warrantyClaims.map((row) => row.workOrderLineId));
  const todayKey = dateKey(now);

  const team = assignments.map((assignment) => {
    const employee = assignment.employee;
    const mechanic = mechanicByEmployee.get(employee.id);
    const location = locations.find((row) => row.id === assignment.locationId) || locations.find((row) => row.id === mechanic?.locationId);
    const employeeShifts = shiftByEmployee.get(employee.id) || [];
    const availableMinutes = location ? employeeShifts.reduce((sum, shift) => sum + shiftAvailableMinutes({ status: shift.status, startMinute: shift.startMinute, endMinute: shift.endMinute, locationOpenMinute: location.openMinute, locationCloseMinute: location.closeMinute }), 0) : 0;
    const mechanicAppointments = mechanic ? appointments.filter((row) => row.mechanicId === mechanic.id) : [];
    const productiveMinutes = mechanicAppointments.reduce((sum, row) => sum + minutesBetween(row.actualStartAt, row.actualEndAt), 0);
    const employeeLines = mechanic ? laborLines.filter((row) => row.mechanicId === mechanic.id) : [];
    const attributedResult = employeeLines.filter((row) => row.type === "LABOR").reduce((sum, row) => sum + lineRevenue(row), 0);
    const normHours = employeeLines.reduce((sum, row) => sum + numberOf(row.laborHours), 0);
    const openAssigned = mechanic ? appointments.filter((row) => row.mechanicId === mechanic.id && ACTIVE_STATUSES.includes(row.status)) : [];
    const openForecast = openAssigned.reduce((sum, row) => sum + (row.workOrderId ? (plannedByOrder.get(row.workOrderId) || 0) * (probabilities[row.status] ?? 0) : 0), 0);
    const locationTarget = input.base.locations.find((row) => row.id === assignment.locationId)?.target ?? null;
    const locationShiftMinutes = assignment.locationId ? shifts.filter((row) => row.locationId === assignment.locationId).reduce((sum, row) => {
      const loc = locations.find((item) => item.id === row.locationId);
      return sum + (loc ? shiftAvailableMinutes({ status: row.status, startMinute: row.startMinute, endMinute: row.endMinute, locationOpenMinute: loc.openMinute, locationCloseMinute: loc.closeMinute }) : 0);
    }, 0) : 0;
    const personalTarget = locationTarget != null && availableMinutes > 0 && locationShiftMinutes > 0 ? roundMoney(locationTarget * availableMinutes / locationShiftMinutes) : null;
    const economicsRow = economicsByEmployee.get(employee.id);
    const employeeKpis = kpisByEmployee.get(employee.id) || [];
    const kpiScoreValues = employeeKpis.map((row) => row.score == null ? null : numberOf(row.score)).filter((value): value is number => value != null);
    const kpiScore = kpiScoreValues.length ? Math.round(kpiScoreValues.reduce((a, b) => a + b, 0) / kpiScoreValues.length * 10) / 10 : economicsRow?.kpiScore == null ? null : numberOf(economicsRow.kpiScore);
    const todayShift = employeeShifts.find((row) => row.day.toISOString().slice(0, 10) === todayKey) || null;
    const currentTask = mechanicAppointments.find((row) => row.status === "IN_REPAIR" || row.status === "DIAGNOSTICS") || null;
    return {
      employeeId: employee.id,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      roleCode: assignment.role.code,
      roleName: assignment.role.name,
      locationId: assignment.locationId,
      shift: todayShift ? { id: todayShift.id, status: todayShift.status, startMinute: todayShift.startMinute, endMinute: todayShift.endMinute, note: todayShift.note } : null,
      scheduleCoverageDays: employeeShifts.length,
      availableMinutes: employeeShifts.length ? availableMinutes : null,
      productiveMinutes: Math.round(productiveMinutes),
      utilizationPct: employeeShifts.length && availableMinutes > 0 ? Math.round(productiveMinutes / availableMinutes * 1000) / 10 : null,
      normHours: Math.round(normHours * 10) / 10,
      target: personalTarget,
      actual: roundMoney(attributedResult),
      forecast: roundMoney(attributedResult + openForecast),
      fullCost: economicsRow ? money(economicsRow.fullCost) : null,
      netContribution: economicsRow ? roundMoney(numberOf(economicsRow.directContribution) - numberOf(economicsRow.fullCost)) : null,
      roiPct: economicsRow?.roiPct == null ? null : numberOf(economicsRow.roiPct),
      kpiScore,
      overdueWork: mechanicAppointments.filter((row) => ACTIVE_STATUSES.includes(row.status) && row.plannedEndAt < now).length,
      reworkCount: employeeLines.filter((row) => warrantyLineIds.has(row.id)).length,
      currentTask: currentTask ? { appointmentId: currentTask.id, status: currentTask.status, workOrderId: currentTask.workOrderId } : null,
    };
  });

  const booked = appointments.filter((row) => row.status !== "NO_SHOW").length + appointments.filter((row) => row.status === "NO_SHOW").length;
  const arrived = appointments.filter((row) => Boolean(row.actualArrivalAt) || (STATUS_RANK[row.status] || 0) >= STATUS_RANK.ARRIVED).length;
  const noShow = appointments.filter((row) => row.status === "NO_SHOW").length;
  const waitingApproval = appointments.filter((row) => row.status === "WAITING_APPROVAL" || row.status === "WAITING_CALCULATION").length;
  const waitingParts = appointments.filter((row) => row.status === "WAITING_PARTS" || row.status === "WAITING_PARTS_SELECTION").length;
  const unassignedActive = appointments.filter((row) => ACTIVE_STATUSES.includes(row.status) && !row.mechanicId).length;
  const mechanicUtilValues = team.filter((row) => row.roleCode === "MECHANIC" && row.utilizationPct != null).map((row) => row.utilizationPct!);
  const averageMechanicUtilizationPct = mechanicUtilValues.length ? Math.round(mechanicUtilValues.reduce((a, b) => a + b, 0) / mechanicUtilValues.length * 10) / 10 : null;
  const freeLiftHours = Math.round(posts.reduce((sum, row) => sum + row.freeMinutes, 0) / 6) / 10;

  const deviations = deriveManagementDeviations({
    target: input.base.result.target,
    fact: input.base.result.fact,
    weightedForecast,
    gap: input.base.result.target == null ? null : Math.max(0, roundMoney(input.base.result.target - weightedForecast)),
    booked,
    arrived,
    noShow,
    waitingApproval,
    waitingParts,
    unassignedActive,
    activeMechanics: team.filter((row) => row.roleCode === "MECHANIC" && ["ON_SHIFT", "LATE", "PARTIAL_SHIFT"].includes(row.shift?.status || "")).length,
    averageMechanicUtilizationPct,
    freeLiftHours,
    warrantyRatePct,
    partsMarginPct,
    averageCheck,
    previousAverageCheck,
  });
  const recommendations = gapClosingRecommendations(deviations, input.base.result.target == null ? null : Math.max(0, roundMoney(input.base.result.target - weightedForecast)));

  const schemeForLocation = (locationId: string) => {
    const specific = schemes.find((row) => row.locationId === locationId);
    const global = schemes.find((row) => row.locationId == null);
    return schemeJson(specific || global || DEFAULT_SCHEME);
  };
  const closedCountByLocation = new Map<string, number>();
  for (const id of closedOrderIds) {
    const locationId = workOrderLocation.get(id);
    if (locationId) closedCountByLocation.set(locationId, (closedCountByLocation.get(locationId) || 0) + 1);
  }
  const bonusByLocation = input.base.locations.map((locationResult) => {
    const scheme = schemeForLocation(locationResult.id);
    const breakEvenNetwork = input.base.plan?.breakEvenAmount ?? 0;
    const networkTarget = input.base.plan?.targetAmount ?? 0;
    const breakEven = networkTarget > 0 && locationResult.target != null ? roundMoney(breakEvenNetwork * locationResult.target / networkTarget) : 0;
    const locationReceivables = receivables.filter((row) => row.locationId === locationResult.id);
    const locationReceivableTotal = locationReceivables.reduce((sum, row) => sum + Math.max(0, numberOf(row.amount) - numberOf(row.settledAmount)), 0);
    const locationOverdue = locationReceivables.filter((row) => row.status === "OVERDUE" || (row.dueAt && row.dueAt < now)).reduce((sum, row) => sum + Math.max(0, numberOf(row.amount) - numberOf(row.settledAmount)), 0);
    const locationWarranty = warrantyClaims.filter((claim) => laborLines.some((line) => line.id === claim.workOrderLineId && workOrderLocation.get(line.workOrderId) === locationResult.id)).length;
    const locationClosed = closedCountByLocation.get(locationResult.id) || 0;
    const quality = {
      grossMarginPct,
      warrantyRatePct: locationClosed ? Math.round(locationWarranty / locationClosed * 1000) / 10 : 0,
      overdueReceivablePct: locationReceivableTotal > 0 ? Math.round(locationOverdue / locationReceivableTotal * 1000) / 10 : 0,
      dataQualityPct,
    };
    const calculation = calculateStationManagerBonus({ target: locationResult.target || 0, fact: locationResult.fact, breakEven, scheme, quality });
    return { locationId: locationResult.id, locationName: locationResult.name, scheme, quality, breakEven, ...calculation };
  });

  const stationManagers = assignments.filter((row) => row.role.code === "STATION_MANAGER").map((row) => {
    const locationResult = input.base.locations.find((item) => item.id === row.locationId);
    const bonus = bonusByLocation.find((item) => item.locationId === row.locationId);
    const managerKpis = kpisByEmployee.get(row.employeeId) || [];
    const scores = managerKpis.map((item) => item.score == null ? null : numberOf(item.score)).filter((value): value is number => value != null);
    return {
      employeeId: row.employeeId,
      name: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
      locationId: row.locationId,
      locationName: input.base.locations.find((item) => item.id === row.locationId)?.name || "Станція",
      plan: locationResult?.target ?? null,
      fact: locationResult?.fact ?? 0,
      forecast: locationResult?.confirmedForecast ?? 0,
      gap: locationResult?.gap ?? null,
      kpiScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : null,
      preliminaryBonus: bonus?.payoutAmount ?? 0,
      qualityPass: bonus?.qualityPass ?? true,
    };
  });

  const dayAllocations = (plan?.allocations || []).filter((row) => row.level === "DAY" && (!scopeIds || !row.locationId || scopeIds.includes(row.locationId))).map((row) => ({ id: row.id, locationId: row.locationId, day: row.day?.toISOString().slice(0, 10) || null, targetAmount: money(row.targetAmount), source: row.source }));
  const postAllocations = (plan?.allocations || []).filter((row) => row.level === "POST" && (!scopeIds || !row.locationId || scopeIds.includes(row.locationId))).map((row) => ({ id: row.id, locationId: row.locationId, postId: row.postId, targetAmount: money(row.targetAmount), source: row.source }));

  const currentGap = input.base.result.target == null ? null : Math.max(0, roundMoney(input.base.result.target - weightedForecast));
  const scopeKey = scopeIds?.length ? [...scopeIds].sort().join(",") : "ALL";
  const snapshotKey = `${input.base.plan?.id || week.start}:${scopeKey}:${todayKey}`.slice(0, 180);
  await prisma.managementForecastSnapshot.upsert({
    where: { snapshotKey },
    update: {
      factAmount: input.base.result.fact,
      paceForecast: pace,
      conservativeForecast,
      confirmedForecast: input.base.result.confirmedForecast,
      weightedForecast,
      baseForecast: input.base.result.baseForecast,
      optimisticForecast: input.base.result.optimisticForecast,
      gapAmount: currentGap,
      factors: toPrismaJson({ probabilities: probabilityRows, dataQualityPct, productive }),
    },
    create: {
      snapshotKey,
      planId: input.base.plan?.id || null,
      locationId: scopeIds?.length === 1 ? scopeIds[0] : null,
      periodStart: dateOnly(week.start),
      periodEnd: dateOnly(week.end),
      factAmount: input.base.result.fact,
      paceForecast: pace,
      conservativeForecast,
      confirmedForecast: input.base.result.confirmedForecast,
      weightedForecast,
      baseForecast: input.base.result.baseForecast,
      optimisticForecast: input.base.result.optimisticForecast,
      gapAmount: currentGap,
      factors: toPrismaJson({ probabilities: probabilityRows, dataQualityPct, productive }),
    },
  });

  const activeDeviationKeys: string[] = [];
  for (const deviation of deviations) {
    const key = `${input.base.plan?.id || week.start}:${scopeKey}:${deviation.code}`.slice(0, 190);
    activeDeviationKeys.push(key);
    await prisma.managementDeviation.upsert({
      where: { deviationKey: key },
      update: {
        severity: deviation.severity,
        impactAmount: deviation.impactAmount ?? null,
        impactHours: deviation.impactHours ?? null,
        impactClients: deviation.impactClients ?? null,
        description: deviation.description,
        recommendedAction: deviation.recommendedAction,
        status: "OPEN",
        resolvedAt: null,
        metadata: toPrismaJson({ scopeKey, refreshedAt: now.toISOString() }),
      },
      create: {
        deviationKey: key,
        planId: input.base.plan?.id || null,
        locationId: scopeIds?.length === 1 ? scopeIds[0] : null,
        periodStart: dateOnly(week.start),
        periodEnd: dateOnly(week.end),
        code: deviation.code,
        severity: deviation.severity,
        impactAmount: deviation.impactAmount ?? null,
        impactHours: deviation.impactHours ?? null,
        impactClients: deviation.impactClients ?? null,
        description: deviation.description,
        recommendedAction: deviation.recommendedAction,
        metadata: toPrismaJson({ scopeKey, refreshedAt: now.toISOString() }),
      },
    });
  }
  await prisma.managementDeviation.updateMany({
    where: {
      periodStart: dateOnly(week.start),
      periodEnd: dateOnly(week.end),
      status: "OPEN",
      ...(scopeIds?.length === 1 ? { locationId: scopeIds[0] } : { locationId: null }),
      ...(activeDeviationKeys.length ? { deviationKey: { notIn: activeDeviationKeys } } : {}),
    },
    data: { status: "RESOLVED", resolvedAt: now },
  });

  for (const bonus of bonusByLocation) {
    await prisma.stationBonusResult.upsert({
      where: { locationId_periodStart_periodEnd_status: { locationId: bonus.locationId, periodStart: dateOnly(week.start), periodEnd: dateOnly(week.end), status: "PRELIMINARY" } },
      update: {
        schemeId: bonus.scheme.id,
        planId: input.base.plan?.id || null,
        targetAmount: input.base.locations.find((row) => row.id === bonus.locationId)?.target || 0,
        factAmount: input.base.locations.find((row) => row.id === bonus.locationId)?.fact || 0,
        performancePct: bonus.performancePct,
        qualityScorePct: bonus.qualityScorePct,
        payoutAmount: bonus.payoutAmount,
        details: toPrismaJson({ scheme: bonus.scheme, quality: bonus.quality, gates: bonus.gates, appliedPercent: bonus.appliedPercent, basisAmount: bonus.basisAmount }),
        calculatedAt: now,
      },
      create: {
        schemeId: bonus.scheme.id,
        planId: input.base.plan?.id || null,
        locationId: bonus.locationId,
        periodStart: dateOnly(week.start),
        periodEnd: dateOnly(week.end),
        status: "PRELIMINARY",
        targetAmount: input.base.locations.find((row) => row.id === bonus.locationId)?.target || 0,
        factAmount: input.base.locations.find((row) => row.id === bonus.locationId)?.fact || 0,
        performancePct: bonus.performancePct,
        qualityScorePct: bonus.qualityScorePct,
        payoutAmount: bonus.payoutAmount,
        details: toPrismaJson({ scheme: bonus.scheme, quality: bonus.quality, gates: bonus.gates, appliedPercent: bonus.appliedPercent, basisAmount: bonus.basisAmount }),
      },
    });
  }

  return {
    intelligence: {
      paceForecast: pace,
      conservativeForecast,
      weightedForecast,
      weightedGap: currentGap,
      probabilities: probabilityRows,
      recommendations,
      deviations,
    },
    capacity: {
      totalMinutes: productive.total,
      elapsedMinutes: productive.elapsed,
      freeLiftHours,
      posts,
    },
    people: {
      team,
      stationManagers,
      scheduleCoveragePct: team.length ? Math.round(team.filter((row) => row.scheduleCoverageDays > 0).length / team.length * 1000) / 10 : 100,
      averageMechanicUtilizationPct,
      activeMechanicsToday: team.filter((row) => row.roleCode === "MECHANIC" && ["ON_SHIFT", "LATE", "PARTIAL_SHIFT"].includes(row.shift?.status || "")).length,
      unassignedActive,
    },
    quality: {
      grossMarginPct,
      partsMarginPct,
      warrantyRatePct,
      overdueReceivablePct,
      dataQualityPct,
      warrantyClaims: warrantyClaims.length,
      overdueReceivable: roundMoney(overdueReceivable),
      receivableTotal: roundMoney(receivableTotal),
      averageCheck,
      previousAverageCheck,
    },
    bonus: {
      locations: bonusByLocation,
    },
    planning: {
      dayAllocations,
      postAllocations,
    },
  };
}
