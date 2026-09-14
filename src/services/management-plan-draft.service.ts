import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { roundMoney, weekKeys } from "@/src/domain/management-result";
import { ManagementResultError, type ManagementActor } from "@/src/services/management-result.service";

function optionalAmount(value: unknown, label: string) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new ManagementResultError("INVALID_AMOUNT", `${label} має бути невід'ємним числом.`);
  return roundMoney(parsed);
}
function dateOnly(value: string) { return new Date(`${value}T00:00:00.000Z`); }
function snapshot(row: { id: string; periodStart: Date; periodEnd: Date; targetAmount: unknown; minimumAmount: unknown; stretchAmount: unknown; breakEvenAmount: unknown; status: string }) {
  return { id: row.id, periodStart: row.periodStart.toISOString().slice(0, 10), periodEnd: row.periodEnd.toISOString().slice(0, 10), targetAmount: Number(row.targetAmount), minimumAmount: row.minimumAmount == null ? null : Number(row.minimumAmount), stretchAmount: row.stretchAmount == null ? null : Number(row.stretchAmount), breakEvenAmount: row.breakEvenAmount == null ? null : Number(row.breakEvenAmount), status: row.status };
}

export async function saveDraftManagementPlan(input: { anchor?: string | null; targetAmount: unknown; minimumAmount?: unknown; stretchAmount?: unknown; breakEvenAmount?: unknown; reason?: string | null; actor: ManagementActor }) {
  if (input.actor.role !== "OWNER") throw new ManagementResultError("OWNER_REQUIRED", "Чернетку головного плану може змінювати лише Власник.", 403);
  const target = optionalAmount(input.targetAmount, "Target");
  if (target == null || target <= 0) throw new ManagementResultError("TARGET_REQUIRED", "Target має бути більше 0 грн.");
  const minimum = optionalAmount(input.minimumAmount, "Minimum");
  const stretch = optionalAmount(input.stretchAmount, "Stretch");
  const breakEven = optionalAmount(input.breakEvenAmount, "Break-even");
  if (minimum != null && minimum > target) throw new ManagementResultError("INVALID_MINIMUM", "Minimum не може перевищувати Target.");
  if (stretch != null && stretch < target) throw new ManagementResultError("INVALID_STRETCH", "Stretch не може бути нижчим за Target.");
  const week = weekKeys(input.anchor);
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`management-plan-draft:${week.start}`}))`;
    const current = await tx.managementPlan.findFirst({ where: { periodStart: dateOnly(week.start), periodEnd: dateOnly(week.end), metric: "MANAGEMENT_GROSS_PROFIT" } });
    if (current && !["DRAFT", "OWNER_APPROVED", "EXECUTIVE_DISTRIBUTED", "STATION_ACCEPTED"].includes(current.status)) throw new ManagementResultError("PLAN_LOCKED", "Активний або закритий план не можна переписати чернеткою.", 409);
    const before = current ? snapshot(current) : null;
    const plan = current ? await tx.managementPlan.update({ where: { id: current.id }, data: { minimumAmount: minimum, targetAmount: target, stretchAmount: stretch, breakEvenAmount: breakEven, status: "DRAFT", approvedAt: null, approvedById: null } }) : await tx.managementPlan.create({ data: { periodStart: dateOnly(week.start), periodEnd: dateOnly(week.end), minimumAmount: minimum, targetAmount: target, stretchAmount: stretch, breakEvenAmount: breakEven, status: "DRAFT", createdById: input.actor.id } });
    if (current) await tx.managementPlanAllocation.deleteMany({ where: { planId: plan.id } });
    const after = snapshot(plan);
    await tx.managementPlanRevision.create({ data: { planId: plan.id, actorId: input.actor.id, actorRole: input.actor.role, action: current ? "PLAN_DRAFT_UPDATED" : "PLAN_DRAFT_CREATED", reason: input.reason?.trim() || null, before: before ? toPrismaJson(before) : undefined, after: toPrismaJson(after) } });
    await tx.auditEvent.create({ data: { actorId: input.actor.id, actorName: input.actor.name, entityType: "ManagementPlan", entityId: plan.id, action: current ? "PLAN_DRAFT_UPDATED" : "PLAN_DRAFT_CREATED", before: before ? toPrismaJson(before) : undefined, after: toPrismaJson(after) } });
    return { ok: true, week, plan: after };
  });
}
