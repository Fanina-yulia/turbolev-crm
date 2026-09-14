import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { allocateMoneyByWeight, roundMoney } from "@/src/domain/management-result";
import { ManagementResultError, saveAndApproveOwnerWeeklyPlan, type ManagementActor } from "@/src/services/management-result.service";

function numberOf(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function amount(value: unknown, field: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new ManagementResultError("INVALID_AMOUNT", `${field} має бути невід'ємною сумою.`);
  return roundMoney(parsed);
}
function cents(value: number) { return Math.round(value * 100); }
function assertSameTotal(rows: Array<{ targetAmount: number }>, expected: number, label: string) {
  const total = rows.reduce((sum, row) => sum + cents(row.targetAmount), 0);
  if (total !== cents(expected)) throw new ManagementResultError("ALLOCATION_TOTAL_MISMATCH", `${label}: сума розподілу має дорівнювати ${roundMoney(expected)} грн.`, 409);
}

async function auditPlan(tx: Prisma.TransactionClient, input: {
  planId: string;
  actor: ManagementActor;
  action: string;
  before?: unknown;
  after: unknown;
  reason?: string | null;
}) {
  await tx.managementPlanRevision.create({ data: {
    planId: input.planId,
    actorId: input.actor.id,
    actorRole: input.actor.role,
    action: input.action,
    reason: input.reason?.trim() || null,
    before: input.before == null ? undefined : toPrismaJson(input.before),
    after: toPrismaJson(input.after),
  }});
  await tx.auditEvent.create({ data: {
    actorId: input.actor.id,
    actorName: input.actor.name,
    entityType: "ManagementPlan",
    entityId: input.planId,
    action: input.action,
    before: input.before == null ? undefined : toPrismaJson(input.before),
    after: toPrismaJson(input.after),
    metadata: toPrismaJson({ role: input.actor.role, reason: input.reason?.trim() || null }),
  }});
}

export async function ownerApprovePlan(input: { planId: string; actor: ManagementActor; reason?: string | null }) {
  if (input.actor.role !== "OWNER") throw new ManagementResultError("OWNER_REQUIRED", "Затверджувати головний план може лише Власник.", 403);
  const plan = await getPrisma().managementPlan.findUnique({ where: { id: input.planId } });
  if (!plan) throw new ManagementResultError("PLAN_NOT_FOUND", "План не знайдено.", 404);
  if (plan.status === "CLOSED" || plan.status === "ACTIVE") throw new ManagementResultError("PLAN_LOCKED", "Активний або закритий план не можна повторно затвердити.", 409);
  return saveAndApproveOwnerWeeklyPlan({
    anchor: plan.periodStart.toISOString().slice(0, 10),
    targetAmount: numberOf(plan.targetAmount),
    minimumAmount: plan.minimumAmount == null ? null : numberOf(plan.minimumAmount),
    stretchAmount: plan.stretchAmount == null ? null : numberOf(plan.stretchAmount),
    breakEvenAmount: plan.breakEvenAmount == null ? null : numberOf(plan.breakEvenAmount),
    reason: input.reason || "OWNER_APPROVAL",
    actor: input.actor,
  });
}

export async function distributePlanBetweenStations(input: {
  planId: string;
  allocations?: Array<{ locationId: string; targetAmount: unknown }>;
  actor: ManagementActor;
  reason?: string | null;
}) {
  if (input.actor.role !== "OWNER" && input.actor.role !== "EXECUTIVE_DIRECTOR") throw new ManagementResultError("EXECUTIVE_REQUIRED", "Розподіляти план між станціями може Власник або Виконавчий директор.", 403);
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`management-distribute:${input.planId}`}))`;
    const plan = await tx.managementPlan.findUnique({ where: { id: input.planId }, include: { allocations: true } });
    if (!plan) throw new ManagementResultError("PLAN_NOT_FOUND", "План не знайдено.", 404);
    if (!["OWNER_APPROVED", "EXECUTIVE_DISTRIBUTED", "STATION_ACCEPTED"].includes(plan.status)) throw new ManagementResultError("PLAN_NOT_DISTRIBUTABLE", "Цей стан плану не можна перерозподіляти.", 409);
    const target = numberOf(plan.targetAmount);
    const locationRows = plan.allocations.filter((row) => row.level === "LOCATION" && row.locationId);
    if (!locationRows.length) throw new ManagementResultError("NO_LOCATION_ALLOCATIONS", "Немає розподілу плану по станціях.", 409);

    const requested = input.allocations?.length ? input.allocations.map((row) => ({ locationId: row.locationId, targetAmount: amount(row.targetAmount, "План станції") })) : locationRows.map((row) => ({ locationId: row.locationId!, targetAmount: numberOf(row.targetAmount) }));
    const validLocations = new Set(locationRows.map((row) => row.locationId!));
    if (requested.some((row) => !validLocations.has(row.locationId)) || new Set(requested.map((row) => row.locationId)).size !== requested.length || requested.length !== locationRows.length) throw new ManagementResultError("INVALID_LOCATION_ALLOCATION", "Потрібно передати рівно один розподіл для кожної станції плану.", 400);
    assertSameTotal(requested, target, "Розподіл між станціями");

    const before = locationRows.map((row) => ({ locationId: row.locationId, targetAmount: numberOf(row.targetAmount) }));
    for (const requestedRow of requested) {
      const locationAllocation = locationRows.find((row) => row.locationId === requestedRow.locationId)!;
      await tx.managementPlanAllocation.update({ where: { id: locationAllocation.id }, data: { targetAmount: requestedRow.targetAmount, source: "EXECUTIVE_DISTRIBUTION", createdById: input.actor.id, acceptedAt: null, acceptedById: null } });

      for (const level of ["POST", "DAY"] as const) {
        const children = plan.allocations.filter((row) => row.level === level && row.locationId === requestedRow.locationId);
        if (!children.length) continue;
        const weights = children.map((row) => ({ id: row.id, weight: row.capacityMinutes && row.capacityMinutes > 0 ? row.capacityMinutes : 1 }));
        const split = allocateMoneyByWeight(requestedRow.targetAmount, weights);
        for (const child of split) await tx.managementPlanAllocation.update({ where: { id: child.id }, data: { targetAmount: child.amount, source: "EXECUTIVE_DISTRIBUTION", createdById: input.actor.id } });
      }
    }
    const updated = await tx.managementPlan.update({ where: { id: plan.id }, data: { status: "EXECUTIVE_DISTRIBUTED" } });
    const after = requested.map((row) => ({ locationId: row.locationId, targetAmount: row.targetAmount }));
    await auditPlan(tx, { planId: plan.id, actor: input.actor, action: "EXECUTIVE_PLAN_DISTRIBUTED", before, after: { allocations: after, status: updated.status }, reason: input.reason });
    return { ok: true, status: updated.status, allocations: after };
  });
}

export async function redistributeStationPlan(input: {
  planId: string;
  locationId: string;
  level: "POST" | "DAY";
  allocations: Array<{ id: string; targetAmount: unknown }>;
  actor: ManagementActor;
  allowedLocationIds: string[];
  reason?: string | null;
}) {
  if (!input.locationId || !input.allowedLocationIds.includes(input.locationId)) throw new ManagementResultError("LOCATION_FORBIDDEN", "Немає права змінювати план цієї станції.", 403);
  if (input.actor.role !== "STATION_MANAGER" && input.actor.role !== "OWNER" && input.actor.role !== "EXECUTIVE_DIRECTOR") throw new ManagementResultError("MANAGEMENT_ROLE_REQUIRED", "Недостатньо прав для перерозподілу плану.", 403);
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const plan = await tx.managementPlan.findUnique({ where: { id: input.planId }, include: { allocations: true } });
    if (!plan) throw new ManagementResultError("PLAN_NOT_FOUND", "План не знайдено.", 404);
    if (plan.status === "CLOSED") throw new ManagementResultError("PLAN_CLOSED", "Закритий план не змінюється.", 409);
    const locationRow = plan.allocations.find((row) => row.level === "LOCATION" && row.locationId === input.locationId);
    if (!locationRow) throw new ManagementResultError("LOCATION_PLAN_NOT_FOUND", "План станції не знайдено.", 404);
    const rows = plan.allocations.filter((row) => row.level === input.level && row.locationId === input.locationId);
    const validIds = new Set(rows.map((row) => row.id));
    if (!input.allocations.length || input.allocations.length !== rows.length || input.allocations.some((row) => !validIds.has(row.id)) || new Set(input.allocations.map((row) => row.id)).size !== rows.length) throw new ManagementResultError("INVALID_ALLOCATION", `Передайте повний розподіл рівня ${input.level}.`, 400);
    const parsed = input.allocations.map((row) => ({ id: row.id, targetAmount: amount(row.targetAmount, "Розподіл") }));
    assertSameTotal(parsed, numberOf(locationRow.targetAmount), input.level === "DAY" ? "Розподіл по днях" : "Розподіл по підйомниках");
    const before = rows.map((row) => ({ id: row.id, targetAmount: numberOf(row.targetAmount) }));
    for (const row of parsed) await tx.managementPlanAllocation.update({ where: { id: row.id }, data: { targetAmount: row.targetAmount, source: "STATION_REDISTRIBUTION", createdById: input.actor.id } });
    await auditPlan(tx, { planId: plan.id, actor: input.actor, action: `STATION_${input.level}_REDISTRIBUTED`, before, after: parsed, reason: input.reason });
    return { ok: true, allocations: parsed };
  });
}

export async function closeManagementPlan(input: { planId: string; actor: ManagementActor; reason?: string | null }) {
  if (input.actor.role !== "OWNER" && input.actor.role !== "EXECUTIVE_DIRECTOR") throw new ManagementResultError("MANAGEMENT_ROLE_REQUIRED", "Закрити тиждень може Власник або Виконавчий директор.", 403);
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const plan = await tx.managementPlan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new ManagementResultError("PLAN_NOT_FOUND", "План не знайдено.", 404);
    if (plan.status === "CLOSED") return { ok: true, plan };
    if (plan.status !== "ACTIVE") throw new ManagementResultError("PLAN_NOT_ACTIVE", "Закривати можна лише активний план.", 409);
    const before = { status: plan.status, closedAt: plan.closedAt };
    const updated = await tx.managementPlan.update({ where: { id: plan.id }, data: { status: "CLOSED", closedAt: new Date() } });
    await auditPlan(tx, { planId: plan.id, actor: input.actor, action: "PLAN_CLOSED", before, after: { status: updated.status, closedAt: updated.closedAt }, reason: input.reason });
    return { ok: true, plan: updated };
  });
}
