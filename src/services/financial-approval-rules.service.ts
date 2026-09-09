import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { FinancialCenterV2Error, type FinanceActor } from "@/src/services/financial-center-v2.service";

function text(value: unknown, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function amount(value: unknown, allowNull = false) {
  if ((value === null || value === undefined || value === "") && allowNull) return null;
  try {
    const result = new Prisma.Decimal(String(value ?? 0).replace(",", ".")).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (!result.isFinite() || result.lessThan(0)) throw new Error("invalid");
    return result;
  } catch {
    throw new FinancialCenterV2Error("INVALID_APPROVAL_AMOUNT", "Некоректний поріг погодження.");
  }
}

export async function listApprovalRules(locationId?: string | null, allowedLocationIds?: string[] | null) {
  const prisma = getPrisma();
  return prisma.financialApprovalRule.findMany({
    where: {
      operationType: "EXPENSE",
      ...(locationId ? { OR: [{ locationId }, { locationId: null }] } : allowedLocationIds?.length ? { OR: [{ locationId: { in: allowedLocationIds } }, { locationId: null }] } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { minAmount: "asc" }],
  });
}

export async function saveApprovalRule(input: Record<string, unknown>, actor: FinanceActor) {
  const prisma = getPrisma();
  const id = text(input.id, 96);
  const name = text(input.name, 160);
  if (!name) throw new FinancialCenterV2Error("NAME_REQUIRED", "Вкажіть назву правила погодження.");
  const minAmount = amount(input.minAmount) as Prisma.Decimal;
  const maxAmount = amount(input.maxAmount, true);
  if (maxAmount && maxAmount.lessThan(minAmount)) throw new FinancialCenterV2Error("INVALID_APPROVAL_RANGE", "Максимальна сума не може бути меншою за мінімальну.");
  const locationId = text(input.locationId, 64);
  const requiredPermission = text(input.requiredPermission, 96);
  const requiredRole = text(input.requiredRole, 96);
  const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 100;
  const isActive = input.isActive !== false;
  const data = { name, operationType: "EXPENSE", minAmount, maxAmount, locationId, requiredPermission, requiredRole, sortOrder, isActive };
  const row = id ? await prisma.financialApprovalRule.update({ where: { id }, data }) : await prisma.financialApprovalRule.create({ data });
  await prisma.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "FinancialApprovalRule", entityId: row.id, action: id ? "FINANCE_APPROVAL_RULE_UPDATED" : "FINANCE_APPROVAL_RULE_CREATED", after: toPrismaJson({ name, minAmount: minAmount.toString(), maxAmount: maxAmount?.toString() || null, locationId, requiredPermission, requiredRole, isActive }) } });
  return row;
}

export async function setApprovalRuleActive(id: string, isActive: boolean, actor: FinanceActor) {
  const prisma = getPrisma();
  const row = await prisma.financialApprovalRule.update({ where: { id }, data: { isActive } });
  await prisma.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "FinancialApprovalRule", entityId: row.id, action: isActive ? "FINANCE_APPROVAL_RULE_ENABLED" : "FINANCE_APPROVAL_RULE_DISABLED", after: toPrismaJson({ isActive }) } });
  return row;
}
