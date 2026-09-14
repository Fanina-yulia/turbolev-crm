import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { roundMoney } from "@/src/domain/management-result";
import { ManagementResultError, type ManagementActor } from "@/src/services/management-result.service";

function numeric(value: unknown, field: string, nullable = true) {
  if ((value == null || value === "") && nullable) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new ManagementResultError("INVALID_BONUS_VALUE", `${field} має бути невід'ємним числом.`);
  return parsed;
}
function dateOnly(value: string) { return new Date(`${value}T00:00:00.000Z`); }

export async function saveStationBonusScheme(input: {
  actor: ManagementActor;
  locationId?: string | null;
  basis?: unknown;
  activationThresholdPct?: unknown;
  basePercent?: unknown;
  fixedAmount?: unknown;
  tier2ThresholdPct?: unknown;
  tier2Percent?: unknown;
  tier3ThresholdPct?: unknown;
  tier3Percent?: unknown;
  minMarginPct?: unknown;
  maxWarrantyRatePct?: unknown;
  maxOverdueReceivablePct?: unknown;
  minDataQualityPct?: unknown;
  capAmount?: unknown;
  effectiveFrom?: string | null;
}) {
  if (input.actor.role !== "OWNER") throw new ManagementResultError("OWNER_REQUIRED", "Формулу мотивації може змінювати лише Власник.", 403);
  const basis = input.basis === "FACT" || input.basis === "ABOVE_TARGET" || input.basis === "ABOVE_BREAK_EVEN" ? input.basis : "ABOVE_BREAK_EVEN";
  const activationThresholdPct = numeric(input.activationThresholdPct ?? 90, "Поріг активації", false)!;
  const basePercent = numeric(input.basePercent ?? 3, "Базовий відсоток", false)!;
  const effectiveFrom = input.effectiveFrom && /^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom) ? dateOnly(input.effectiveFrom) : dateOnly(new Date().toISOString().slice(0, 10));
  const prisma = getPrisma();
  const current = await prisma.stationBonusScheme.findFirst({ where: { isActive: true, locationId: input.locationId || null }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }] });
  const data = {
    locationId: input.locationId || null,
    basis,
    activationThresholdPct,
    basePercent,
    fixedAmount: numeric(input.fixedAmount, "Фіксований бонус"),
    tier2ThresholdPct: numeric(input.tier2ThresholdPct, "Поріг рівня 2"),
    tier2Percent: numeric(input.tier2Percent, "Відсоток рівня 2"),
    tier3ThresholdPct: numeric(input.tier3ThresholdPct, "Поріг рівня 3"),
    tier3Percent: numeric(input.tier3Percent, "Відсоток рівня 3"),
    minMarginPct: numeric(input.minMarginPct, "Мінімальна маржа"),
    maxWarrantyRatePct: numeric(input.maxWarrantyRatePct, "Максимальна гарантія"),
    maxOverdueReceivablePct: numeric(input.maxOverdueReceivablePct, "Максимальна прострочена дебіторка"),
    minDataQualityPct: numeric(input.minDataQualityPct, "Мінімальна якість даних"),
    capAmount: numeric(input.capAmount, "Ліміт бонусу"),
    effectiveFrom,
    updatedById: input.actor.id,
  } as const;
  const scheme = current ? await prisma.stationBonusScheme.update({ where: { id: current.id }, data }) : await prisma.stationBonusScheme.create({ data: { ...data, createdById: input.actor.id } });
  await prisma.auditEvent.create({ data: { actorId: input.actor.id, actorName: input.actor.name, entityType: "StationBonusScheme", entityId: scheme.id, action: current ? "STATION_BONUS_SCHEME_UPDATED" : "STATION_BONUS_SCHEME_CREATED", before: current ? toPrismaJson(current) : undefined, after: toPrismaJson(scheme), metadata: toPrismaJson({ locationId: input.locationId || null }) } });
  return { ok: true, scheme };
}

export async function finalizeStationManagerBonus(input: { actor: ManagementActor; planId: string; locationId: string }) {
  if (input.actor.role !== "OWNER" && input.actor.role !== "EXECUTIVE_DIRECTOR") throw new ManagementResultError("MANAGEMENT_ROLE_REQUIRED", "Фіналізувати бонус може Власник або Виконавчий директор.", 403);
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`station-bonus-final:${input.planId}:${input.locationId}`}))`;
    const plan = await tx.managementPlan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new ManagementResultError("PLAN_NOT_FOUND", "План не знайдено.", 404);
    if (plan.status !== "CLOSED") throw new ManagementResultError("PLAN_NOT_CLOSED", "Фінальний бонус формується тільки після закриття тижня.", 409);
    const preliminary = await tx.stationBonusResult.findUnique({ where: { locationId_periodStart_periodEnd_status: { locationId: input.locationId, periodStart: plan.periodStart, periodEnd: plan.periodEnd, status: "PRELIMINARY" } } });
    if (!preliminary) throw new ManagementResultError("PRELIMINARY_BONUS_MISSING", "Спочатку відкрийте кабінет/результат тижня, щоб CRM розрахувала попередній бонус.", 409);
    const existingFinal = await tx.stationBonusResult.findUnique({ where: { locationId_periodStart_periodEnd_status: { locationId: input.locationId, periodStart: plan.periodStart, periodEnd: plan.periodEnd, status: "FINAL" } } });
    const final = existingFinal || await tx.stationBonusResult.create({ data: {
      schemeId: preliminary.schemeId,
      planId: input.planId,
      locationId: input.locationId,
      periodStart: plan.periodStart,
      periodEnd: plan.periodEnd,
      status: "FINAL",
      targetAmount: preliminary.targetAmount,
      factAmount: preliminary.factAmount,
      performancePct: preliminary.performancePct,
      qualityScorePct: preliminary.qualityScorePct,
      payoutAmount: preliminary.payoutAmount,
      details: toPrismaJson(preliminary.details ?? {}),
      calculatedAt: preliminary.calculatedAt,
      finalizedAt: new Date(),
      finalizedById: input.actor.id,
    } });

    const manager = await tx.employeeRoleAssignment.findFirst({
      where: { locationId: input.locationId, role: { code: "STATION_MANAGER" }, startsAt: { lte: plan.periodEnd }, OR: [{ endsAt: null }, { endsAt: { gt: plan.periodStart } }] },
      include: { employee: true },
      orderBy: [{ isPrimary: "desc" }, { startsAt: "desc" }],
    });
    let accrualId: string | null = null;
    if (manager && Number(final.payoutAmount) > 0) {
      const payroll = await tx.payrollPeriod.findFirst({ where: { periodStart: { lte: plan.periodStart }, periodEnd: { gte: plan.periodEnd } }, orderBy: { periodStart: "desc" } });
      if (payroll) {
        const existingAccrual = await tx.salaryAccrual.findFirst({ where: { employeeId: manager.employeeId, sourceType: "STATION_MANAGER_BONUS", sourceId: final.id, status: { not: "REVERSED" } } });
        const accrual = existingAccrual || await tx.salaryAccrual.create({ data: {
          employeeId: manager.employeeId,
          payrollPeriodId: payroll.id,
          category: "BONUS",
          amount: roundMoney(Number(final.payoutAmount)),
          currency: "UAH",
          occurredAt: plan.periodEnd,
          status: "DRAFT",
          sourceType: "STATION_MANAGER_BONUS",
          sourceId: final.id,
          description: `Фінальний бонус керівника станції за ${plan.periodStart.toISOString().slice(0, 10)} — ${plan.periodEnd.toISOString().slice(0, 10)}`,
        } });
        accrualId = accrual.id;
      }
    }
    await tx.auditEvent.create({ data: { actorId: input.actor.id, actorName: input.actor.name, entityType: "StationBonusResult", entityId: final.id, action: "STATION_MANAGER_BONUS_FINALIZED", after: toPrismaJson(final), metadata: toPrismaJson({ planId: input.planId, locationId: input.locationId, employeeId: manager?.employeeId || null, salaryAccrualId: accrualId }) } });
    return { ok: true, result: final, salaryAccrualId: accrualId, employeeId: manager?.employeeId || null };
  });
}
