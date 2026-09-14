import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import {
  allocateMoneyByWeight,
  gapToPlan,
  managementGrossFromSnapshot,
  planProgressPercent,
  roundMoney,
  weekKeys,
} from "@/src/domain/management-result";

const DEFAULT_TZ = "Europe/Kyiv";
const HIGH_CONFIDENCE_STATUSES = new Set(["READY_FOR_REPAIR", "IN_REPAIR", "WAITING_QC", "WAITING_PAYMENT", "READY_FOR_PICKUP"]);
const BASE_FORECAST_STATUSES = new Set(["WAITING_APPROVAL", "WAITING_PARTS", ...HIGH_CONFIDENCE_STATUSES]);
const OPTIMISTIC_FORECAST_STATUSES = new Set(["DIAGNOSTICS", "WAITING_PARTS_SELECTION", "WAITING_CALCULATION", ...BASE_FORECAST_STATUSES]);
const STATUS_RANK: Record<string, number> = {
  BOOKED: 1,
  ARRIVED: 2,
  DIAGNOSTICS: 3,
  WAITING_PARTS_SELECTION: 4,
  WAITING_CALCULATION: 5,
  WAITING_APPROVAL: 6,
  WAITING_PARTS: 7,
  READY_FOR_REPAIR: 8,
  IN_REPAIR: 9,
  WAITING_QC: 10,
  WAITING_PAYMENT: 11,
  READY_FOR_PICKUP: 12,
  COMPLETED: 13,
};

export type ManagementActor = {
  id: string | null;
  name: string | null;
  role: string;
};

export class ManagementResultError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ManagementResultError";
    this.code = code;
    this.status = status;
  }
}

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currencyAmount(value: unknown) {
  return roundMoney(numeric(value));
}

function dateKeyInTimezone(date = new Date(), timeZone = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function offsetMinutes(date: Date, timeZone: string) {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
  const match = value?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === "+" ? minutes : -minutes;
}

function dateKeyStartUtc(dateKey: string, timeZone = DEFAULT_TZ) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  const offset = offsetMinutes(probe, timeZone);
  return new Date(Date.UTC(year, month - 1, day, 0, -offset));
}

function dateOnlyUtc(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function localMinute(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function sum(values: number[]) {
  return roundMoney(values.reduce((total, value) => total + value, 0));
}

function planJson(plan: {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  metric: string;
  currency: string;
  minimumAmount: unknown;
  targetAmount: unknown;
  stretchAmount: unknown;
  breakEvenAmount: unknown;
  status: string;
}) {
  return {
    id: plan.id,
    periodStart: plan.periodStart.toISOString().slice(0, 10),
    periodEnd: plan.periodEnd.toISOString().slice(0, 10),
    metric: plan.metric,
    currency: plan.currency,
    minimumAmount: plan.minimumAmount == null ? null : currencyAmount(plan.minimumAmount),
    targetAmount: currencyAmount(plan.targetAmount),
    stretchAmount: plan.stretchAmount == null ? null : currencyAmount(plan.stretchAmount),
    breakEvenAmount: plan.breakEvenAmount == null ? null : currencyAmount(plan.breakEvenAmount),
    status: plan.status,
  };
}

function validateOptionalAmount(value: unknown, field: string) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new ManagementResultError("INVALID_AMOUNT", `${field} має бути невід'ємним числом.`);
  return roundMoney(number);
}

async function activeCapacity(tx: Prisma.TransactionClient | ReturnType<typeof getPrisma>) {
  const locations = await tx.serviceLocation.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      timezone: true,
      openMinute: true,
      closeMinute: true,
      posts: {
        where: { isActive: true },
        select: { id: true, name: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return locations.map((location) => {
    const dailyMinutes = Math.max(0, location.closeMinute - location.openMinute);
    return {
      ...location,
      dailyMinutes,
      weeklyMinutes: dailyMinutes * 7 * location.posts.length,
    };
  });
}

async function rebuildAutoAllocations(
  tx: Prisma.TransactionClient,
  planId: string,
  targetAmount: number,
  actorId: string | null,
  weekDays: string[],
) {
  const capacity = await activeCapacity(tx);
  const productiveLocations = capacity.filter((location) => location.weeklyMinutes > 0 && location.posts.length > 0);
  if (!productiveLocations.length) {
    throw new ManagementResultError("NO_ACTIVE_CAPACITY", "Немає активної станції з активним підйомником для розподілу плану.", 409);
  }

  await tx.managementPlanAllocation.deleteMany({ where: { planId } });
  const locationAmounts = allocateMoneyByWeight(targetAmount, productiveLocations.map((location) => ({ id: location.id, weight: location.weeklyMinutes })));
  const locationAmountById = new Map(locationAmounts.map((row) => [row.id, row.amount]));

  for (const location of productiveLocations) {
    const locationAmount = locationAmountById.get(location.id) || 0;
    await tx.managementPlanAllocation.create({
      data: {
        planId,
        level: "LOCATION",
        locationId: location.id,
        targetAmount: locationAmount,
        capacityMinutes: location.weeklyMinutes,
        source: "AUTO_CAPACITY",
        createdById: actorId,
      },
    });

    const postAmounts = allocateMoneyByWeight(locationAmount, location.posts.map((post) => ({ id: post.id, weight: location.dailyMinutes * 7 })));
    for (const row of postAmounts) {
      await tx.managementPlanAllocation.create({
        data: {
          planId,
          level: "POST",
          locationId: location.id,
          postId: row.id,
          targetAmount: row.amount,
          capacityMinutes: location.dailyMinutes * 7,
          source: "AUTO_CAPACITY",
          createdById: actorId,
        },
      });
    }

    const dayAmounts = allocateMoneyByWeight(locationAmount, weekDays.map((day) => ({ id: day, weight: location.dailyMinutes * location.posts.length })));
    for (const row of dayAmounts) {
      await tx.managementPlanAllocation.create({
        data: {
          planId,
          level: "DAY",
          locationId: location.id,
          day: dateOnlyUtc(row.id),
          targetAmount: row.amount,
          capacityMinutes: location.dailyMinutes * location.posts.length,
          source: "AUTO_CAPACITY",
          createdById: actorId,
        },
      });
    }
  }
}

export async function saveAndApproveOwnerWeeklyPlan(input: {
  anchor?: string | null;
  targetAmount: unknown;
  minimumAmount?: unknown;
  stretchAmount?: unknown;
  breakEvenAmount?: unknown;
  reason?: string | null;
  actor: ManagementActor;
}) {
  if (input.actor.role !== "OWNER") throw new ManagementResultError("OWNER_REQUIRED", "Змінювати головний план може лише Власник.", 403);

  const targetAmount = validateOptionalAmount(input.targetAmount, "План");
  if (targetAmount == null || targetAmount <= 0) throw new ManagementResultError("TARGET_REQUIRED", "Вкажіть план більше 0 грн.");
  const minimumAmount = validateOptionalAmount(input.minimumAmount, "Мінімум");
  const stretchAmount = validateOptionalAmount(input.stretchAmount, "Stretch");
  const breakEvenAmount = validateOptionalAmount(input.breakEvenAmount, "Точка беззбитковості");
  if (minimumAmount != null && minimumAmount > targetAmount) throw new ManagementResultError("INVALID_MINIMUM", "Мінімум не може бути більшим за план.");
  if (stretchAmount != null && stretchAmount < targetAmount) throw new ManagementResultError("INVALID_STRETCH", "Stretch не може бути меншим за план.");

  const week = weekKeys(input.anchor || dateKeyInTimezone());
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`management-plan:${week.start}`}))`;
    const existing = await tx.managementPlan.findFirst({
      where: { periodStart: dateOnlyUtc(week.start), periodEnd: dateOnlyUtc(week.end), metric: "MANAGEMENT_GROSS_PROFIT" },
      include: { allocations: true },
    });
    if (existing?.status === "CLOSED") throw new ManagementResultError("PLAN_CLOSED", "Закритий тижневий план змінювати не можна.", 409);
    if (existing?.status === "ACTIVE") {
      throw new ManagementResultError("PLAN_ACTIVE", "Активний план не можна переписати. Потрібна окрема ревізія з погодженням Власника.", 409);
    }

    const before = existing ? planJson(existing) : null;
    const now = new Date();
    const plan = existing
      ? await tx.managementPlan.update({
          where: { id: existing.id },
          data: {
            currency: "UAH",
            minimumAmount,
            targetAmount,
            stretchAmount,
            breakEvenAmount,
            status: "OWNER_APPROVED",
            approvedById: input.actor.id,
            approvedAt: now,
          },
        })
      : await tx.managementPlan.create({
          data: {
            periodStart: dateOnlyUtc(week.start),
            periodEnd: dateOnlyUtc(week.end),
            metric: "MANAGEMENT_GROSS_PROFIT",
            currency: "UAH",
            minimumAmount,
            targetAmount,
            stretchAmount,
            breakEvenAmount,
            status: "OWNER_APPROVED",
            createdById: input.actor.id,
            approvedById: input.actor.id,
            approvedAt: now,
          },
        });

    await rebuildAutoAllocations(tx, plan.id, targetAmount, input.actor.id, week.days);
    const after = planJson(plan);
    await tx.managementPlanRevision.create({
      data: {
        planId: plan.id,
        actorId: input.actor.id,
        actorRole: input.actor.role,
        action: existing ? "OWNER_PLAN_UPDATED" : "OWNER_PLAN_CREATED",
        reason: input.reason?.trim() || null,
        before: before ? toPrismaJson(before) : undefined,
        after: toPrismaJson(after),
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: input.actor.id,
        actorName: input.actor.name,
        entityType: "ManagementPlan",
        entityId: plan.id,
        action: existing ? "OWNER_PLAN_UPDATED" : "OWNER_PLAN_CREATED",
        before: before ? toPrismaJson(before) : undefined,
        after: toPrismaJson(after),
        metadata: toPrismaJson({ weekStart: week.start, weekEnd: week.end, allocation: "AUTO_CAPACITY" }),
      },
    });
    return { plan: after, week };
  });
}

export async function activateWeeklyPlan(input: { planId: string; actor: ManagementActor }) {
  if (input.actor.role !== "OWNER" && input.actor.role !== "EXECUTIVE_DIRECTOR") {
    throw new ManagementResultError("MANAGEMENT_ROLE_REQUIRED", "Активувати план може Власник або Виконавчий директор.", 403);
  }
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const current = await tx.managementPlan.findUnique({ where: { id: input.planId } });
    if (!current) throw new ManagementResultError("PLAN_NOT_FOUND", "План не знайдено.", 404);
    if (current.status === "CLOSED") throw new ManagementResultError("PLAN_CLOSED", "План уже закритий.", 409);
    if (current.status === "ACTIVE") return planJson(current);
    const updated = await tx.managementPlan.update({ where: { id: current.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
    await tx.managementPlanRevision.create({
      data: {
        planId: current.id,
        actorId: input.actor.id,
        actorRole: input.actor.role,
        action: "PLAN_ACTIVATED",
        before: toPrismaJson(planJson(current)),
        after: toPrismaJson(planJson(updated)),
      },
    });
    return planJson(updated);
  });
}

export async function acceptStationPlan(input: { planId: string; locationIds: string[]; actor: ManagementActor }) {
  if (input.actor.role !== "STATION_MANAGER") throw new ManagementResultError("STATION_MANAGER_REQUIRED", "Підтвердити план станції може її Керівник.", 403);
  if (!input.locationIds.length) throw new ManagementResultError("LOCATION_REQUIRED", "Керівник не прив'язаний до станції.", 403);
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const plan = await tx.managementPlan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new ManagementResultError("PLAN_NOT_FOUND", "План не знайдено.", 404);
    if (plan.status === "CLOSED") throw new ManagementResultError("PLAN_CLOSED", "План уже закритий.", 409);
    const now = new Date();
    await tx.managementPlanAllocation.updateMany({
      where: { planId: plan.id, level: "LOCATION", locationId: { in: input.locationIds } },
      data: { acceptedAt: now, acceptedById: input.actor.id },
    });
    const locationAllocations = await tx.managementPlanAllocation.findMany({ where: { planId: plan.id, level: "LOCATION" }, select: { acceptedAt: true } });
    const allAccepted = locationAllocations.length > 0 && locationAllocations.every((row) => Boolean(row.acceptedAt));
    if (allAccepted && plan.status !== "ACTIVE") {
      await tx.managementPlan.update({ where: { id: plan.id }, data: { status: "STATION_ACCEPTED" } });
    }
    await tx.managementPlanRevision.create({
      data: {
        planId: plan.id,
        actorId: input.actor.id,
        actorRole: input.actor.role,
        action: "STATION_PLAN_ACCEPTED",
        after: toPrismaJson({ locationIds: input.locationIds, acceptedAt: now.toISOString() }),
      },
    });
    return { ok: true, allAccepted };
  });
}

function statusForWorkOrder(rows: Array<{ workOrderId: string | null; locationId: string; status: string }>) {
  const map = new Map<string, { status: string; locationId: string }>();
  for (const row of rows) {
    if (!row.workOrderId) continue;
    const existing = map.get(row.workOrderId);
    if (!existing || (STATUS_RANK[row.status] || 0) > (STATUS_RANK[existing.status] || 0)) {
      map.set(row.workOrderId, { status: row.status, locationId: row.locationId });
    }
  }
  return map;
}

function locationShare(planTarget: number | null, locationTarget: number | null, networkValue: number | null) {
  if (planTarget == null || planTarget <= 0 || locationTarget == null || networkValue == null) return null;
  return roundMoney(networkValue * locationTarget / planTarget);
}

function targetToNowFromDays(args: {
  dayAllocations: Array<{ locationId: string | null; day: Date | null; targetAmount: unknown }>;
  locations: Array<{ id: string; timezone: string; openMinute: number; closeMinute: number }>;
  now: Date;
}) {
  const locationMap = new Map(args.locations.map((location) => [location.id, location]));
  let result = 0;
  for (const allocation of args.dayAllocations) {
    if (!allocation.day || !allocation.locationId) continue;
    const location = locationMap.get(allocation.locationId);
    if (!location) continue;
    const dayKey = allocation.day.toISOString().slice(0, 10);
    const today = dateKeyInTimezone(args.now, location.timezone || DEFAULT_TZ);
    const amount = currencyAmount(allocation.targetAmount);
    if (dayKey < today) {
      result += amount;
      continue;
    }
    if (dayKey > today) continue;
    const totalMinutes = Math.max(1, location.closeMinute - location.openMinute);
    const elapsed = Math.min(totalMinutes, Math.max(0, localMinute(args.now, location.timezone || DEFAULT_TZ) - location.openMinute));
    result += amount * elapsed / totalMinutes;
  }
  return roundMoney(result);
}

export async function getWeeklyManagementResult(input: {
  anchor?: string | null;
  locationIds?: string[] | null;
  selectedLocationId?: string | null;
}) {
  const anchor = input.anchor || dateKeyInTimezone();
  const week = weekKeys(anchor);
  const from = dateKeyStartUtc(week.start);
  const to = dateKeyStartUtc(week.endExclusive);
  const prisma = getPrisma();
  const allCapacity = await activeCapacity(prisma);
  const requestedScope = input.selectedLocationId ? [input.selectedLocationId] : input.locationIds;
  const scopeLocationIds = requestedScope && requestedScope.length ? [...new Set(requestedScope)] : null;
  const scopedCapacity = scopeLocationIds ? allCapacity.filter((location) => scopeLocationIds.includes(location.id)) : allCapacity;

  const plan = await prisma.managementPlan.findFirst({
    where: { periodStart: dateOnlyUtc(week.start), periodEnd: dateOnlyUtc(week.end), metric: "MANAGEMENT_GROSS_PROFIT" },
    include: { allocations: true },
  });

  const locationAllocations = plan?.allocations.filter((row) => row.level === "LOCATION") ?? [];
  const scopedLocationAllocations = scopeLocationIds
    ? locationAllocations.filter((row) => row.locationId && scopeLocationIds.includes(row.locationId))
    : locationAllocations;
  const dayAllocations = plan?.allocations.filter((row) => row.level === "DAY" && (!scopeLocationIds || (row.locationId && scopeLocationIds.includes(row.locationId)))) ?? [];
  const networkTarget = plan ? currencyAmount(plan.targetAmount) : null;
  const target = plan
    ? (scopeLocationIds ? sum(scopedLocationAllocations.map((row) => currencyAmount(row.targetAmount))) : networkTarget)
    : null;

  let scopedWorkOrderIds: string[] | null = null;
  if (scopeLocationIds) {
    const links = await prisma.serviceAppointment.findMany({
      where: { locationId: { in: scopeLocationIds }, workOrderId: { not: null }, NOT: { id: { startsWith: "demo_" } } },
      select: { workOrderId: true },
      distinct: ["workOrderId"],
    });
    scopedWorkOrderIds = links.map((row) => row.workOrderId).filter((id): id is string => Boolean(id));
  }

  const closedOrders = scopedWorkOrderIds?.length === 0 ? [] : await prisma.workOrder.findMany({
    where: {
      status: "CLOSED",
      closedAt: { gte: from, lt: to },
      NOT: { id: { startsWith: "demo_" } },
      ...(scopedWorkOrderIds ? { id: { in: scopedWorkOrderIds } } : {}),
    },
    select: { id: true, closedAt: true },
  });
  const closedIds = closedOrders.map((row) => row.id);
  const actualSnapshots = closedIds.length ? await prisma.workOrderFinanceSnapshot.findMany({
    where: { workOrderId: { in: closedIds }, kind: "ACTUAL", lockedAt: { not: null } },
    select: {
      workOrderId: true,
      laborRevenue: true,
      partsRevenue: true,
      externalRevenue: true,
      otherRevenue: true,
      discountAmount: true,
      refundAmount: true,
      partsCost: true,
    },
  }) : [];
  const actualSnapshotByOrder = new Map(actualSnapshots.map((row) => [row.workOrderId, row]));
  const workOrderFact = sum(actualSnapshots.map((row) => managementGrossFromSnapshot(row)));

  const directServiceEvents = await prisma.financialEvent.findMany({
    where: {
      status: "POSTED",
      pnlSection: "REVENUE",
      recognizedAt: { gte: from, lt: to },
      sourceEntity: "WALK_IN_DIAGNOSTIC",
      ...(scopeLocationIds ? { locationId: { in: scopeLocationIds } } : {}),
    },
    select: { amount: true, locationId: true },
  });
  const directServiceFact = sum(directServiceEvents.map((row) => currencyAmount(row.amount)));
  const fact = roundMoney(workOrderFact + directServiceFact);

  const weekAppointments = await prisma.serviceAppointment.findMany({
    where: {
      plannedStartAt: { gte: from, lt: to },
      workOrderId: { not: null },
      NOT: { id: { startsWith: "demo_" } },
      status: { notIn: ["CANCELLED", "RESERVE", "NO_SHOW"] },
      ...(scopeLocationIds ? { locationId: { in: scopeLocationIds } } : {}),
    },
    select: { workOrderId: true, locationId: true, status: true },
  });
  const statusByWorkOrder = statusForWorkOrder(weekAppointments);
  const forecastOrderIds = [...statusByWorkOrder.keys()].filter((id) => !actualSnapshotByOrder.has(id));
  const plannedSnapshots = forecastOrderIds.length ? await prisma.workOrderFinanceSnapshot.findMany({
    where: { workOrderId: { in: forecastOrderIds }, kind: "PLANNED" },
    select: {
      workOrderId: true,
      laborRevenue: true,
      partsRevenue: true,
      externalRevenue: true,
      otherRevenue: true,
      discountAmount: true,
      refundAmount: true,
      partsCost: true,
    },
  }) : [];
  const plannedValueByOrder = new Map(plannedSnapshots.map((row) => [row.workOrderId, managementGrossFromSnapshot(row)]));

  let confirmedPipeline = 0;
  let basePipeline = 0;
  let optimisticPipeline = 0;
  for (const [workOrderId, status] of statusByWorkOrder.entries()) {
    const value = plannedValueByOrder.get(workOrderId);
    if (value == null) continue;
    if (HIGH_CONFIDENCE_STATUSES.has(status.status)) confirmedPipeline += value;
    if (BASE_FORECAST_STATUSES.has(status.status)) basePipeline += value;
    if (OPTIMISTIC_FORECAST_STATUSES.has(status.status)) optimisticPipeline += value;
  }
  confirmedPipeline = roundMoney(confirmedPipeline);
  basePipeline = roundMoney(basePipeline);
  optimisticPipeline = roundMoney(optimisticPipeline);
  const confirmedForecast = roundMoney(fact + confirmedPipeline);
  const baseForecast = roundMoney(fact + basePipeline);
  const optimisticForecast = roundMoney(fact + optimisticPipeline);

  const cashWhere: Prisma.CashTransactionWhereInput = {
    status: "POSTED",
    kind: "INFLOW",
    flowSection: "OPERATING",
    occurredAt: { gte: from, lt: to },
    clientId: { not: null },
  };
  if (scopeLocationIds) {
    cashWhere.OR = [
      { locationId: { in: scopeLocationIds } },
      ...(scopedWorkOrderIds?.length ? [{ workOrderId: { in: scopedWorkOrderIds } }] : []),
    ];
  }
  const cashRows = await prisma.cashTransaction.findMany({ where: cashWhere, select: { amount: true } });
  const cashIn = sum(cashRows.map((row) => currencyAmount(row.amount)));

  const targetToNow = plan ? targetToNowFromDays({
    dayAllocations,
    locations: scopedCapacity.map((row) => ({ id: row.id, timezone: row.timezone, openMinute: row.openMinute, closeMinute: row.closeMinute })),
    now: new Date(),
  }) : null;
  const currentDate = dateKeyInTimezone(new Date(), DEFAULT_TZ);
  const remainingDays = week.days.filter((day) => day >= currentDate).length || 1;
  const activePosts = scopedCapacity.reduce((count, location) => count + location.posts.length, 0);
  const gap = gapToPlan(target, confirmedForecast);
  const requiredPerDay = gap == null ? null : roundMoney(gap / remainingDays);
  const requiredPerLiftDay = gap == null || activePosts <= 0 ? null : roundMoney(gap / Math.max(1, remainingDays * activePosts));

  const actualLocationLinks = closedIds.length ? await prisma.serviceAppointment.findMany({
    where: { workOrderId: { in: closedIds }, NOT: { id: { startsWith: "demo_" } } },
    select: { workOrderId: true, locationId: true, plannedStartAt: true },
    orderBy: { plannedStartAt: "desc" },
  }) : [];
  const actualLocationByOrder = new Map<string, string>();
  for (const link of actualLocationLinks) if (link.workOrderId && !actualLocationByOrder.has(link.workOrderId)) actualLocationByOrder.set(link.workOrderId, link.locationId);

  const locationResult = scopedCapacity.map((location) => {
    const allocation = locationAllocations.find((row) => row.locationId === location.id);
    const locationTarget = allocation ? currencyAmount(allocation.targetAmount) : null;
    const closedValue = sum(actualSnapshots.filter((row) => actualLocationByOrder.get(row.workOrderId) === location.id).map((row) => managementGrossFromSnapshot(row)));
    const directValue = sum(directServiceEvents.filter((row) => row.locationId === location.id).map((row) => currencyAmount(row.amount)));
    const locationFact = roundMoney(closedValue + directValue);
    let locationConfirmed = 0;
    let locationBase = 0;
    let locationOptimistic = 0;
    for (const [workOrderId, status] of statusByWorkOrder.entries()) {
      if (status.locationId !== location.id) continue;
      const value = plannedValueByOrder.get(workOrderId);
      if (value == null) continue;
      if (HIGH_CONFIDENCE_STATUSES.has(status.status)) locationConfirmed += value;
      if (BASE_FORECAST_STATUSES.has(status.status)) locationBase += value;
      if (OPTIMISTIC_FORECAST_STATUSES.has(status.status)) locationOptimistic += value;
    }
    const confirmed = roundMoney(locationFact + locationConfirmed);
    const base = roundMoney(locationFact + locationBase);
    const optimistic = roundMoney(locationFact + locationOptimistic);
    return {
      id: location.id,
      name: location.name,
      target: locationTarget,
      fact: locationFact,
      confirmedForecast: confirmed,
      baseForecast: base,
      optimisticForecast: optimistic,
      gap: gapToPlan(locationTarget, confirmed),
      progressPct: planProgressPercent(locationFact, locationTarget),
      activePosts: location.posts.length,
      capacityMinutes: location.weeklyMinutes,
    };
  });

  const unpricedPipeline = [...statusByWorkOrder.keys()].filter((id) => !actualSnapshotByOrder.has(id) && !plannedValueByOrder.has(id)).length;
  const scopedTarget = target;
  const scopedRatio = networkTarget && scopedTarget != null ? scopedTarget / networkTarget : null;

  return {
    ok: true,
    range: { from: week.start, to: week.end, timezone: DEFAULT_TZ, days: 7 },
    plan: plan ? {
      ...planJson(plan),
      targetAmount: scopedTarget,
      minimumAmount: scopeLocationIds ? locationShare(networkTarget, scopedTarget, plan.minimumAmount == null ? null : currencyAmount(plan.minimumAmount)) : (plan.minimumAmount == null ? null : currencyAmount(plan.minimumAmount)),
      stretchAmount: scopeLocationIds ? locationShare(networkTarget, scopedTarget, plan.stretchAmount == null ? null : currencyAmount(plan.stretchAmount)) : (plan.stretchAmount == null ? null : currencyAmount(plan.stretchAmount)),
      breakEvenAmount: scopeLocationIds ? locationShare(networkTarget, scopedTarget, plan.breakEvenAmount == null ? null : currencyAmount(plan.breakEvenAmount)) : (plan.breakEvenAmount == null ? null : currencyAmount(plan.breakEvenAmount)),
      scopeRatio: scopedRatio,
    } : null,
    result: {
      target: scopedTarget,
      targetToNow,
      fact,
      cashIn,
      progressPct: planProgressPercent(fact, scopedTarget),
      confirmedForecast,
      baseForecast,
      optimisticForecast,
      gap,
      requiredPerDay,
      requiredPerLiftDay,
      remainingDays,
      activePosts,
    },
    breakdown: {
      workOrderFact,
      directServiceFact,
      confirmedPipeline,
      basePipeline,
      optimisticPipeline,
    },
    locations: locationResult,
    dataQuality: {
      finalizedWorkOrders: actualSnapshots.length,
      closedWithoutFinalFinance: Math.max(0, closedIds.length - actualSnapshots.length),
      pipelineWithoutPlannedFinance: unpricedPipeline,
      forecastCompleteness: unpricedPipeline > 0 ? "PARTIAL" : "COMPLETE",
    },
  };
}

export async function listWeeklyManagementPlans(input: { anchor?: string | null; locationIds?: string[] | null }) {
  const week = weekKeys(input.anchor || dateKeyInTimezone());
  const prisma = getPrisma();
  const plan = await prisma.managementPlan.findFirst({
    where: { periodStart: dateOnlyUtc(week.start), periodEnd: dateOnlyUtc(week.end), metric: "MANAGEMENT_GROSS_PROFIT" },
    include: { allocations: { orderBy: [{ level: "asc" }, { createdAt: "asc" }] }, revisions: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  if (!plan) return { ok: true, week, plan: null };
  const allocations = input.locationIds?.length
    ? plan.allocations.filter((row) => !row.locationId || input.locationIds!.includes(row.locationId))
    : plan.allocations;
  return {
    ok: true,
    week,
    plan: {
      ...planJson(plan),
      allocations: allocations.map((row) => ({
        id: row.id,
        level: row.level,
        locationId: row.locationId,
        postId: row.postId,
        day: row.day?.toISOString().slice(0, 10) ?? null,
        targetAmount: currencyAmount(row.targetAmount),
        capacityMinutes: row.capacityMinutes,
        source: row.source,
        acceptedAt: row.acceptedAt,
      })),
      revisions: plan.revisions,
    },
  };
}
