import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { outstandingAmount } from "@/src/domain/finance";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { FinancialCenterV2Error, type FinanceActor } from "@/src/services/financial-center-v2.service";

function decimal(value: unknown, code: string, message: string) {
  try {
    const result = new Prisma.Decimal(String(value ?? "").replace(",", ".")).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (!result.isFinite() || result.lessThanOrEqualTo(0)) throw new Error("invalid");
    return result;
  } catch {
    throw new FinancialCenterV2Error(code, message);
  }
}

export async function applyCustomerAdvance(advanceId: string, workOrderId: string, rawAmount: unknown, actor: FinanceActor) {
  const prisma = getPrisma();
  const amount = decimal(rawAmount, "ADVANCE_AMOUNT_REQUIRED", "Вкажіть суму зарахування авансу.");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `customer-advance-apply:${advanceId}:${workOrderId}`);
    const advance = await tx.customerAdvance.findUnique({ where: { id: advanceId } });
    if (!advance) throw new FinancialCenterV2Error("ADVANCE_NOT_FOUND", "Аванс не знайдено.", 404);
    if (advance.status === "REFUNDED" || advance.status === "APPLIED") throw new FinancialCenterV2Error("ADVANCE_CLOSED", "Аванс уже закритий.", 409);
    const remaining = new Prisma.Decimal(advance.amount).minus(advance.appliedAmount);
    if (amount.greaterThan(remaining)) throw new FinancialCenterV2Error("ADVANCE_EXCEEDS_REMAINING", "Сума зарахування перевищує залишок авансу.");

    const receivable = await tx.financialObligation.findFirst({
      where: { workOrderId, clientId: advance.clientId, direction: "RECEIVABLE", status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] } },
      orderBy: { issuedAt: "asc" },
    });
    if (!receivable) throw new FinancialCenterV2Error("RECEIVABLE_NOT_FOUND", "Для цього замовлення немає відкритої дебіторки.", 404);
    const receivableOutstanding = new Prisma.Decimal(outstandingAmount(receivable.amount, receivable.settledAmount));
    if (amount.greaterThan(receivableOutstanding)) throw new FinancialCenterV2Error("ADVANCE_EXCEEDS_RECEIVABLE", "Сума авансу перевищує залишок до оплати за замовленням.");

    const nextSettled = new Prisma.Decimal(receivable.settledAmount).plus(amount);
    const receivablePaid = nextSettled.greaterThanOrEqualTo(receivable.amount);
    const nextApplied = new Prisma.Decimal(advance.appliedAmount).plus(amount);
    const advanceApplied = nextApplied.greaterThanOrEqualTo(advance.amount);
    const now = new Date();

    const updatedReceivable = await tx.financialObligation.update({
      where: { id: receivable.id },
      data: { settledAmount: nextSettled, status: receivablePaid ? "PAID" : "PARTIALLY_PAID", settledAt: receivablePaid ? now : null },
    });
    const updatedAdvance = await tx.customerAdvance.update({
      where: { id: advanceId },
      data: { workOrderId, appliedAmount: nextApplied, status: advanceApplied ? "APPLIED" : "PARTIALLY_APPLIED" },
    });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        actorName: actor.name,
        entityType: "CustomerAdvance",
        entityId: advanceId,
        action: "CUSTOMER_ADVANCE_APPLIED",
        before: toPrismaJson({ appliedAmount: advance.appliedAmount.toString(), status: advance.status, receivableSettled: receivable.settledAmount.toString() }),
        after: toPrismaJson({ appliedAmount: nextApplied.toString(), status: updatedAdvance.status, workOrderId, amount: amount.toString(), receivableId: receivable.id, receivableSettled: nextSettled.toString() }),
      },
    });
    return { advance: updatedAdvance, receivable: updatedReceivable };
  });
}

export async function refundCustomerAdvance(advanceId: string, actor: FinanceActor) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `customer-advance-refund:${advanceId}`);
    const advance = await tx.customerAdvance.findUnique({ where: { id: advanceId } });
    if (!advance) throw new FinancialCenterV2Error("ADVANCE_NOT_FOUND", "Аванс не знайдено.", 404);
    if (advance.status === "REFUNDED") return { advance, reused: true };
    if (new Prisma.Decimal(advance.appliedAmount).greaterThan(0)) throw new FinancialCenterV2Error("ADVANCE_PARTLY_APPLIED", "Аванс уже частково використаний. Для такого повернення потрібне окреме коригування застосованої частини.", 409);
    const existing = await tx.cashTransaction.findFirst({ where: { sourceEntity: "CUSTOMER_ADVANCE_REFUND", sourceEntityId: advanceId } });
    if (existing) {
      const updated = await tx.customerAdvance.update({ where: { id: advanceId }, data: { status: "REFUNDED" } });
      return { advance: updated, cash: existing, reused: true };
    }
    const account = await tx.moneyAccount.findUnique({ where: { id: advance.moneyAccountId } });
    if (!account?.isActive) throw new FinancialCenterV2Error("ACCOUNT_NOT_FOUND", "Рахунок авансу недоступний.", 404);
    const now = new Date();
    const cash = await tx.cashTransaction.create({
      data: {
        kind: "OUTFLOW",
        status: "POSTED",
        flowSection: "OPERATING",
        amount: advance.amount,
        currency: advance.currency,
        occurredAt: now,
        fromAccountId: advance.moneyAccountId,
        clientId: advance.clientId,
        workOrderId: advance.workOrderId,
        locationId: advance.locationId,
        sourceEntity: "CUSTOMER_ADVANCE_REFUND",
        sourceEntityId: advanceId,
        description: "Повернення невикористаного авансу клієнта",
        metadata: toPrismaJson({ advanceId }),
        createdById: actor.id,
        postedAt: now,
      },
    });
    const updatedAdvance = await tx.customerAdvance.update({ where: { id: advanceId }, data: { status: "REFUNDED" } });
    await tx.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "CustomerAdvance", entityId: advanceId, action: "CUSTOMER_ADVANCE_REFUNDED", before: toPrismaJson({ status: advance.status }), after: toPrismaJson({ status: updatedAdvance.status, cashTransactionId: cash.id, amount: advance.amount.toString() }) } });
    return { advance: updatedAdvance, cash, reused: false };
  });
}

export async function listCustomerAdvances(locationId?: string | null, allowedLocationIds?: string[] | null) {
  const prisma = getPrisma();
  return prisma.customerAdvance.findMany({
    where: locationId ? { locationId } : allowedLocationIds?.length ? { locationId: { in: allowedLocationIds } } : {},
    orderBy: { receivedAt: "desc" },
    take: 200,
  });
}
