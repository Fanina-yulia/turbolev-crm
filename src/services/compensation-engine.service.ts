import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { acquireTransactionAdvisoryLock } from "@/src/lib/advisory-lock";
import {
  dailyBaseAmount,
  laborCompensation,
  minimumSalaryTopUp,
  partsCompensation,
  profitShareCompensation,
  roundCompensation,
} from "@/src/domain/compensation";

const CURRENCY = "UAH";

type Tx = Prisma.TransactionClient;

type RuleSnapshot = {
  baseSalary: number;
  minimumSalary: number;
  workPercent: number;
  partsSalesPercent: number;
  partsMarginPercent: number;
  netProfitPercent: number;
};

function numberOf(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function percent(value: unknown) {
  return Math.min(100, Math.max(0, numberOf(value)));
}

function ruleOf(employee: {
  baseSalary: Prisma.Decimal | null;
  minimumSalary: Prisma.Decimal | null;
  workPercent: Prisma.Decimal | null;
  partsSalesPercent: Prisma.Decimal | null;
  partsMarginPercent: Prisma.Decimal | null;
  netProfitPercent: Prisma.Decimal | null;
}): RuleSnapshot {
  return {
    baseSalary: Math.max(0, numberOf(employee.baseSalary)),
    minimumSalary: Math.max(0, numberOf(employee.minimumSalary)),
    workPercent: percent(employee.workPercent),
    partsSalesPercent: percent(employee.partsSalesPercent),
    partsMarginPercent: percent(employee.partsMarginPercent),
    netProfitPercent: percent(employee.netProfitPercent),
  };
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function periodKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function monthBounds(date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const next = new Date(Date.UTC(year, month + 1, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  return { start, next, end, days: end.getUTCDate(), key: periodKey(start) };
}

function previousMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 15));
}

function dayAtNoon(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day, 12));
}

async function ensurePayrollPeriodTx(tx: Tx, date: Date) {
  const bounds = monthBounds(date);
  return tx.payrollPeriod.upsert({
    where: { key: bounds.key },
    update: {},
    create: {
      key: bounds.key,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      status: "OPEN",
    },
  });
}

async function postAccrualTx(tx: Tx, input: {
  employeeId: string;
  category: "BASE" | "LABOR" | "SALES" | "KPI" | "BONUS" | "ALLOWANCE" | "DEDUCTION" | "ADJUSTMENT" | "OTHER";
  amount: number;
  occurredAt: Date;
  sourceType: string;
  sourceId: string;
  description: string;
  rule: RuleSnapshot;
  basis?: Record<string, unknown>;
}) {
  const amount = roundCompensation(input.amount);
  if (!(amount > 0)) return null;
  await acquireTransactionAdvisoryLock(tx, `compensation:${input.employeeId}:${input.sourceType}:${input.sourceId}`);
  const existing = await tx.salaryAccrual.findFirst({
    where: {
      employeeId: input.employeeId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      status: { not: "REVERSED" },
    },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  const period = await ensurePayrollPeriodTx(tx, input.occurredAt);
  if (period.status === "CLOSED") return null;

  const accrual = await tx.salaryAccrual.create({
    data: {
      employeeId: input.employeeId,
      payrollPeriodId: period.id,
      category: input.category,
      amount,
      currency: CURRENCY,
      occurredAt: input.occurredAt,
      status: "POSTED",
      sourceType: input.sourceType,
      sourceId: input.sourceId.slice(0, 160),
      description: input.description,
    },
  });

  await tx.auditEvent.create({
    data: {
      entityType: "SalaryAccrual",
      entityId: accrual.id,
      action: "COMPENSATION_AUTO_POSTED",
      after: toPrismaJson({
        employeeId: input.employeeId,
        category: input.category,
        amount,
        occurredAt: input.occurredAt,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      }),
      metadata: toPrismaJson({
        rule: input.rule,
        basis: input.basis ?? {},
        payrollPeriodId: period.id,
        payrollKey: period.key,
      }),
    },
  });
  return accrual;
}

async function employeeById(tx: Tx, employeeId: string) {
  return tx.employeeProfile.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      hireDate: true,
      isActive: true,
      baseSalary: true,
      minimumSalary: true,
      workPercent: true,
      partsSalesPercent: true,
      partsMarginPercent: true,
      netProfitPercent: true,
    },
  });
}

async function resolveEmployeeIdFromMechanicRef(tx: Tx, mechanicRef: string | null) {
  if (!mechanicRef) return null;
  const direct = await tx.employeeProfile.findUnique({ where: { id: mechanicRef }, select: { id: true } });
  if (direct) return direct.id;
  const resource = await tx.serviceMechanic.findFirst({
    where: {
      OR: [
        { id: mechanicRef },
        { userId: mechanicRef },
        { employeeId: mechanicRef },
      ],
    },
    select: { employeeId: true, userId: true },
    orderBy: { updatedAt: "desc" },
  });
  if (resource?.employeeId) return resource.employeeId;
  if (resource?.userId) {
    const profile = await tx.employeeProfile.findUnique({ where: { userId: resource.userId }, select: { id: true } });
    if (profile) return profile.id;
  }
  const byUser = await tx.employeeProfile.findUnique({ where: { userId: mechanicRef }, select: { id: true } });
  return byUser?.id ?? null;
}

function lineRevenue(line: {
  actualQuantity: Prisma.Decimal | null;
  plannedQuantity: Prisma.Decimal;
  actualUnitPrice: Prisma.Decimal | null;
  plannedUnitPrice: Prisma.Decimal;
  actualDiscount: Prisma.Decimal | null;
  plannedDiscount: Prisma.Decimal;
}) {
  const qty = numberOf(line.actualQuantity ?? line.plannedQuantity);
  const price = numberOf(line.actualUnitPrice ?? line.plannedUnitPrice);
  const discount = numberOf(line.actualDiscount ?? line.plannedDiscount);
  return roundCompensation(Math.max(0, qty * price - discount));
}

export async function postMechanicLaborCompensationForLine(lineId: string, explicitEmployeeId?: string | null) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const line = await tx.workOrderLine.findUnique({
      where: { id: lineId },
      select: {
        id: true,
        workOrderId: true,
        type: true,
        status: true,
        description: true,
        mechanicId: true,
        completedAt: true,
        actualQuantity: true,
        plannedQuantity: true,
        actualUnitPrice: true,
        plannedUnitPrice: true,
        actualDiscount: true,
        plannedDiscount: true,
      },
    });
    if (!line || line.type !== "LABOR" || line.status !== "COMPLETED") return null;
    const employeeId = explicitEmployeeId || await resolveEmployeeIdFromMechanicRef(tx, line.mechanicId);
    if (!employeeId) return null;
    const employee = await employeeById(tx, employeeId);
    if (!employee?.isActive) return null;
    const rule = ruleOf(employee);
    const revenue = lineRevenue(line);
    const amount = laborCompensation(revenue, rule.workPercent);
    const accrual = await postAccrualTx(tx, {
      employeeId,
      category: "LABOR",
      amount,
      occurredAt: line.completedAt || new Date(),
      sourceType: "WORK_ORDER_LABOR",
      sourceId: line.id,
      description: `% від робіт · ${line.description}`,
      rule,
      basis: { workOrderId: line.workOrderId, workOrderLineId: line.id, revenue, percent: rule.workPercent },
    });
    const quantity = numberOf(line.actualQuantity ?? line.plannedQuantity);
    if (amount > 0 && quantity > 0) {
      await tx.workOrderLine.update({
        where: { id: line.id },
        data: { actualUnitCost: new Prisma.Decimal((amount / quantity).toFixed(2)) },
      });
    }
    return accrual;
  });
}

export async function postWalkInDiagnosticCompensation(input: {
  diagnosticRequestId: string;
  employeeId?: string | null;
  mechanicRef?: string | null;
  amount: number;
  occurredAt?: Date;
  appointmentId?: string | null;
  locationId?: string | null;
}) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const employeeId = input.employeeId || await resolveEmployeeIdFromMechanicRef(tx, input.mechanicRef ?? null);
    if (!employeeId) return null;
    const employee = await employeeById(tx, employeeId);
    if (!employee?.isActive) return null;
    const rule = ruleOf(employee);
    const revenue = roundCompensation(Math.max(0, input.amount));
    const amount = laborCompensation(revenue, rule.workPercent);
    return postAccrualTx(tx, {
      employeeId: employee.id,
      category: "LABOR",
      amount,
      occurredAt: input.occurredAt || new Date(),
      sourceType: "WALK_IN_DIAGNOSTIC_LABOR",
      sourceId: input.diagnosticRequestId,
      description: "% від робіт · позапланова діагностика",
      rule,
      basis: {
        diagnosticRequestId: input.diagnosticRequestId,
        appointmentId: input.appointmentId ?? null,
        locationId: input.locationId ?? null,
        revenue,
        percent: rule.workPercent,
      },
    });
  });
}

export async function postAttributedPartsCompensation(attributionIds: string[]) {
  const ids = Array.from(new Set(attributionIds.filter(Boolean)));
  if (!ids.length) return { posted: 0 };

  const prisma = getPrisma();
  const rows = await prisma.attributionLedgerEntry.findMany({
    where: {
      id: { in: ids },
      attributionType: "DIRECT",
      metricCode: { in: ["PARTS_REVENUE", "PARTS_MARGIN"] },
      economicValue: { not: null },
      event: { status: "POSTED" },
    },
    select: {
      id: true,
      employeeId: true,
      metricCode: true,
      economicValue: true,
      event: { select: { occurredAt: true, workOrderId: true } },
    },
  });

  let posted = 0;
  for (const row of rows) {
    const employee = await prisma.employeeProfile.findUnique({
      where: { id: row.employeeId },
      select: {
        id: true, firstName: true, lastName: true, hireDate: true, isActive: true,
        baseSalary: true, minimumSalary: true, workPercent: true, partsSalesPercent: true,
        partsMarginPercent: true, netProfitPercent: true,
      },
    });
    if (!employee?.isActive) continue;
    const rule = ruleOf(employee);
    const basis = Math.max(0, numberOf(row.economicValue));
    const pct = row.metricCode === "PARTS_REVENUE" ? rule.partsSalesPercent : rule.partsMarginPercent;
    const amount = row.metricCode === "PARTS_REVENUE"
      ? partsCompensation({ sales: basis, cost: 0, salesPercent: pct, marginPercent: 0 }).fromSales
      : partsCompensation({ sales: basis, cost: 0, salesPercent: 0, marginPercent: pct }).fromMargin;
    const sourceType = row.metricCode === "PARTS_REVENUE" ? "ATTRIBUTION_PARTS_SALES" : "ATTRIBUTION_PARTS_MARGIN";
    const accrual = await prisma.$transaction((tx) => postAccrualTx(tx, {
      employeeId: row.employeeId,
      category: "SALES",
      amount,
      occurredAt: row.event.occurredAt,
      sourceType,
      sourceId: row.id,
      description: row.metricCode === "PARTS_REVENUE" ? "% від продажу деталей" : "% від маржі деталей",
      rule,
      basis: { attributionId: row.id, workOrderId: row.event.workOrderId, metricCode: row.metricCode, basis, percent: pct },
    }));
    if (accrual) posted += 1;
  }
  return { posted };
}

async function reconcileBaseForMonth(date: Date, throughDate: Date) {
  const prisma = getPrisma();
  const bounds = monthBounds(date);
  const lastDay = Math.min(
    bounds.days,
    date.getUTCFullYear() === throughDate.getUTCFullYear() && date.getUTCMonth() === throughDate.getUTCMonth()
      ? throughDate.getUTCDate()
      : bounds.days,
  );
  const employees = await prisma.employeeProfile.findMany({
    where: { isActive: true, baseSalary: { gt: 0 } },
    select: {
      id: true, firstName: true, lastName: true, hireDate: true, isActive: true,
      baseSalary: true, minimumSalary: true, workPercent: true, partsSalesPercent: true,
      partsMarginPercent: true, netProfitPercent: true,
    },
  });

  let posted = 0;
  for (const employee of employees) {
    const rule = ruleOf(employee);
    const daily = dailyBaseAmount(rule.baseSalary, bounds.days);
    if (!(daily > 0)) continue;
    for (let day = 1; day <= lastDay; day += 1) {
      const occurredAt = dayAtNoon(bounds.start.getUTCFullYear(), bounds.start.getUTCMonth(), day);
      if (employee.hireDate && occurredAt < employee.hireDate) continue;
      const accrual = await prisma.$transaction((tx) => postAccrualTx(tx, {
        employeeId: employee.id,
        category: "BASE",
        amount: daily,
        occurredAt,
        sourceType: "BASE_DAILY",
        sourceId: dateKey(occurredAt),
        description: `Базова ставка · ${dateKey(occurredAt)}`,
        rule,
        basis: { monthlyBase: rule.baseSalary, daysInMonth: bounds.days, dailyAmount: daily },
      }));
      if (accrual) posted += 1;
    }
  }
  return posted;
}

async function reconcileLaborLinesForMonth(date: Date) {
  const prisma = getPrisma();
  const bounds = monthBounds(date);
  const lines = await prisma.workOrderLine.findMany({
    where: {
      type: "LABOR",
      status: "COMPLETED",
      completedAt: { gte: bounds.start, lt: bounds.next },
      mechanicId: { not: null },
    },
    select: { id: true },
    take: 2000,
  });
  let posted = 0;
  for (const line of lines) if (await postMechanicLaborCompensationForLine(line.id)) posted += 1;
  return posted;
}

async function reconcileWalkInDiagnosticsForMonth(date: Date) {
  const prisma = getPrisma();
  const bounds = monthBounds(date);
  const events = await prisma.financialEvent.findMany({
    where: {
      status: "POSTED",
      sourceEntity: "WALK_IN_DIAGNOSTIC",
      recognizedAt: { gte: bounds.start, lt: bounds.next },
      sourceEntityId: { endsWith: ":revenue" },
    },
    select: { amount: true, recognizedAt: true, sourceEntityId: true, metadata: true, locationId: true },
    take: 1000,
  });
  let posted = 0;
  for (const event of events) {
    const diagnosticRequestId = String(event.sourceEntityId || "").replace(/:revenue$/, "");
    if (!diagnosticRequestId) continue;
    const assignment = await prisma.diagnosticAssignment.findUnique({
      where: { diagnosticRequestId },
      select: { mechanicId: true },
    });
    const mechanicResource = assignment?.mechanicId ? await prisma.serviceMechanic.findUnique({
      where: { id: assignment.mechanicId },
      select: { employeeId: true, userId: true },
    }) : null;
    const employeeId = mechanicResource?.employeeId
      || (mechanicResource?.userId
        ? (await prisma.employeeProfile.findUnique({ where: { userId: mechanicResource.userId }, select: { id: true } }))?.id
        : null)
      || null;
    if (!employeeId) continue;
    const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
      ? event.metadata as Record<string, unknown>
      : {};
    const accrual = await postWalkInDiagnosticCompensation({
      diagnosticRequestId,
      employeeId,
      amount: numberOf(event.amount),
      occurredAt: event.recognizedAt,
      appointmentId: typeof metadata.appointmentId === "string" ? metadata.appointmentId : null,
      locationId: event.locationId,
    });
    if (accrual) posted += 1;
  }
  return posted;
}

async function reconcileAttributedPartsForMonth(date: Date) {
  const prisma = getPrisma();
  const bounds = monthBounds(date);
  const rows = await prisma.attributionLedgerEntry.findMany({
    where: {
      attributionType: "DIRECT",
      metricCode: { in: ["PARTS_REVENUE", "PARTS_MARGIN"] },
      event: { status: "POSTED", occurredAt: { gte: bounds.start, lt: bounds.next } },
      economicValue: { not: null },
    },
    select: {
      id: true,
      employeeId: true,
      metricCode: true,
      economicValue: true,
      event: { select: { occurredAt: true, workOrderId: true, sourceType: true, sourceId: true } },
    },
    take: 3000,
  });
  let posted = 0;
  for (const row of rows) {
    const employee = await employeeById(prisma as unknown as Tx, row.employeeId);
    if (!employee?.isActive) continue;
    const rule = ruleOf(employee);
    const basis = Math.max(0, numberOf(row.economicValue));
    const pct = row.metricCode === "PARTS_REVENUE" ? rule.partsSalesPercent : rule.partsMarginPercent;
    const amount = row.metricCode === "PARTS_REVENUE"
      ? partsCompensation({ sales: basis, cost: 0, salesPercent: pct, marginPercent: 0 }).fromSales
      : partsCompensation({ sales: basis, cost: 0, salesPercent: 0, marginPercent: pct }).fromMargin;
    const sourceType = row.metricCode === "PARTS_REVENUE" ? "ATTRIBUTION_PARTS_SALES" : "ATTRIBUTION_PARTS_MARGIN";
    const accrual = await prisma.$transaction((tx) => postAccrualTx(tx, {
      employeeId: row.employeeId,
      category: "SALES",
      amount,
      occurredAt: row.event.occurredAt,
      sourceType,
      sourceId: row.id,
      description: row.metricCode === "PARTS_REVENUE" ? "% від продажу деталей" : "% від маржі деталей",
      rule,
      basis: { attributionId: row.id, workOrderId: row.event.workOrderId, metricCode: row.metricCode, basis, percent: pct },
    }));
    if (accrual) posted += 1;
  }
  return posted;
}

async function employeeLocationForPeriod(employeeId: string, start: Date, end: Date) {
  const row = await getPrisma().employeeRoleAssignment.findFirst({
    where: {
      employeeId,
      startsAt: { lt: end },
      OR: [{ endsAt: null }, { endsAt: { gte: start } }],
    },
    select: { locationId: true },
    orderBy: [{ isPrimary: "desc" }, { startsAt: "desc" }],
  });
  return row?.locationId ?? null;
}

async function preProfitShareNetProfit(start: Date, end: Date, locationId: string | null) {
  const prisma = getPrisma();
  const events = await prisma.financialEvent.findMany({
    where: {
      status: "POSTED",
      currency: CURRENCY,
      recognizedAt: { gte: start, lt: end },
      ...(locationId ? { locationId } : {}),
      NOT: { category: { code: "OPEX_PROFIT_SHARE" } },
    },
    select: { pnlSection: true, amount: true },
  });
  const sums: Record<string, number> = {};
  for (const row of events) sums[row.pnlSection] = (sums[row.pnlSection] || 0) + numberOf(row.amount);
  return roundCompensation(
    (sums.REVENUE || 0)
    - (sums.COGS || 0)
    - (sums.OPEX || 0)
    + (sums.OTHER_INCOME || 0)
    - (sums.OTHER_EXPENSE || 0)
    - (sums.TAX || 0),
  );
}

export async function estimateProfitShareForEmployee(employeeId: string, date = new Date()) {
  const prisma = getPrisma();
  const employee = await employeeById(prisma as unknown as Tx, employeeId);
  if (!employee?.isActive) return 0;
  const rule = ruleOf(employee);
  if (!(rule.netProfitPercent > 0)) return 0;
  const bounds = monthBounds(date);
  const locationId = await employeeLocationForPeriod(employeeId, bounds.start, bounds.next);
  const preShareProfit = await preProfitShareNetProfit(bounds.start, bounds.next, locationId);
  return profitShareCompensation(preShareProfit, rule.netProfitPercent);
}

async function reconcileProfitShareForMonth(date: Date) {
  const prisma = getPrisma();
  const bounds = monthBounds(date);
  const employees = await prisma.employeeProfile.findMany({
    where: { isActive: true, netProfitPercent: { gt: 0 } },
    select: {
      id: true, firstName: true, lastName: true, hireDate: true, isActive: true,
      baseSalary: true, minimumSalary: true, workPercent: true, partsSalesPercent: true,
      partsMarginPercent: true, netProfitPercent: true,
    },
  });
  let posted = 0;
  for (const employee of employees) {
    const rule = ruleOf(employee);
    const locationId = await employeeLocationForPeriod(employee.id, bounds.start, bounds.next);
    const preShareProfit = await preProfitShareNetProfit(bounds.start, bounds.next, locationId);
    const amount = profitShareCompensation(preShareProfit, rule.netProfitPercent);
    const accrual = await prisma.$transaction((tx) => postAccrualTx(tx, {
      employeeId: employee.id,
      category: "BONUS",
      amount,
      occurredAt: dayAtNoon(bounds.end.getUTCFullYear(), bounds.end.getUTCMonth(), bounds.end.getUTCDate()),
      sourceType: "PROFIT_SHARE",
      sourceId: bounds.key,
      description: "% від чистого прибутку до profit-share бонусів",
      rule,
      basis: { period: bounds.key, locationId, preShareNetProfit: preShareProfit, percent: rule.netProfitPercent },
    }));
    if (accrual) posted += 1;
  }
  return posted;
}

async function activeDaysForEmployee(employee: { hireDate: Date | null }, bounds: ReturnType<typeof monthBounds>) {
  if (!employee.hireDate || employee.hireDate <= bounds.start) return bounds.days;
  if (employee.hireDate >= bounds.next) return 0;
  return Math.max(0, bounds.days - employee.hireDate.getUTCDate() + 1);
}

async function reconcileMinimumSalaryForMonth(date: Date) {
  const prisma = getPrisma();
  const bounds = monthBounds(date);
  const employees = await prisma.employeeProfile.findMany({
    where: { isActive: true, minimumSalary: { gt: 0 } },
    select: {
      id: true, firstName: true, lastName: true, hireDate: true, isActive: true,
      baseSalary: true, minimumSalary: true, workPercent: true, partsSalesPercent: true,
      partsMarginPercent: true, netProfitPercent: true,
    },
  });
  let posted = 0;
  for (const employee of employees) {
    const rule = ruleOf(employee);
    const sum = await prisma.salaryAccrual.aggregate({
      where: {
        employeeId: employee.id,
        status: "POSTED",
        occurredAt: { gte: bounds.start, lt: bounds.next },
        sourceType: { not: "MINIMUM_TOPUP" },
      },
      _sum: { amount: true },
    });
    const activeDays = await activeDaysForEmployee(employee, bounds);
    const amount = minimumSalaryTopUp({
      minimumSalary: rule.minimumSalary,
      earnedBeforeTopUp: numberOf(sum._sum.amount),
      activeDays,
      daysInMonth: bounds.days,
    });
    const accrual = await prisma.$transaction((tx) => postAccrualTx(tx, {
      employeeId: employee.id,
      category: "ADJUSTMENT",
      amount,
      occurredAt: dayAtNoon(bounds.end.getUTCFullYear(), bounds.end.getUTCMonth(), bounds.end.getUTCDate()),
      sourceType: "MINIMUM_TOPUP",
      sourceId: bounds.key,
      description: "Доплата до гарантованого мінімуму",
      rule,
      basis: { period: bounds.key, activeDays, daysInMonth: bounds.days, earnedBeforeTopUp: numberOf(sum._sum.amount), minimumSalary: rule.minimumSalary },
    }));
    if (accrual) posted += 1;
  }
  return posted;
}

export async function reconcileCompensation(now = new Date()) {
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
  const previous = previousMonth(current);

  const currentBase = await reconcileBaseForMonth(current, now);
  const currentLabor = await reconcileLaborLinesForMonth(current);
  const currentWalkIn = await reconcileWalkInDiagnosticsForMonth(current);
  const currentParts = await reconcileAttributedPartsForMonth(current);

  const previousBase = await reconcileBaseForMonth(previous, monthBounds(previous).end);
  const previousLabor = await reconcileLaborLinesForMonth(previous);
  const previousWalkIn = await reconcileWalkInDiagnosticsForMonth(previous);
  const previousParts = await reconcileAttributedPartsForMonth(previous);
  const previousProfitShare = await reconcileProfitShareForMonth(previous);
  const previousMinimumTopUp = await reconcileMinimumSalaryForMonth(previous);

  return {
    current: { base: currentBase, labor: currentLabor, walkIn: currentWalkIn, parts: currentParts },
    previous: {
      base: previousBase,
      labor: previousLabor,
      walkIn: previousWalkIn,
      parts: previousParts,
      profitShare: previousProfitShare,
      minimumTopUp: previousMinimumTopUp,
    },
  };
}
