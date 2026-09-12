import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { outstandingAmount } from "@/src/domain/finance";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { FinancialCenterV2Error, type FinanceActor } from "@/src/services/financial-center-v2.service";

const OPEN_STATUSES = ["OPEN", "PARTIALLY_PAID", "OVERDUE"] as const;
const SETTLEMENT_SOURCE = "FINANCIAL_SETTLEMENT";
const PAYMENT_CATEGORY = "CUSTOMER_PAYMENT";
const SUPPLIER_PAYMENT_CATEGORY = "SUPPLIER_PAYMENT";

export type FinancialSettlementDirection = "RECEIVABLE" | "PAYABLE";

export type FinancialSettlementInput = {
  direction?: unknown;
  obligationId?: unknown;
  amount?: unknown;
  moneyAccountId?: unknown;
  occurredAt?: unknown;
  idempotencyKey?: unknown;
  sourceEntity?: unknown;
  sourceEntityId?: unknown;
  clientId?: unknown;
  supplierId?: unknown;
  workOrderId?: unknown;
  locationId?: unknown;
  counterpartyName?: unknown;
  note?: unknown;
};

export class FinanceSettlementError extends FinancialCenterV2Error {
  constructor(code: string, message: string, status = 400) {
    super(code, message, status);
    this.name = "FinanceSettlementError";
  }
}

function text(value: unknown, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function positiveDecimal(value: unknown, code: string, message: string) {
  if (value === null || value === undefined || value === "") {
    throw new FinanceSettlementError(code, message);
  }
  try {
    const result = new Prisma.Decimal(String(value).replace(",", ".")).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (!result.isFinite() || result.lessThanOrEqualTo(0)) throw new Error("invalid");
    return result;
  } catch {
    throw new FinanceSettlementError(code, message);
  }
}

function dateValue(value: unknown, code: string, message: string, fallback = new Date()) {
  if (value === null || value === undefined || value === "") return fallback;
  const result = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(result.getTime())) throw new FinanceSettlementError(code, message);
  return result;
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return toPrismaJson(value);
}

function directionValue(value: unknown): FinancialSettlementDirection {
  const direction = String(value || "RECEIVABLE").toUpperCase();
  if (direction === "RECEIVABLE" || direction === "PAYABLE") return direction;
  throw new FinanceSettlementError("INVALID_SETTLEMENT_DIRECTION", "Вкажіть дебіторську або кредиторську операцію.");
}

function settlementKey(input: FinancialSettlementInput) {
  const explicit = text(input.idempotencyKey, 120);
  if (explicit) return explicit;
  throw new FinanceSettlementError("IDEMPOTENCY_KEY_REQUIRED", "Для платежу потрібен ключ повторної безпеки.");
}

function statusForObligation(amount: Prisma.Decimal, settledAmount: Prisma.Decimal, dueAt: Date | null, now: Date) {
  if (settledAmount.greaterThanOrEqualTo(amount)) return "PAID" as const;
  if (settledAmount.greaterThan(0)) return "PARTIALLY_PAID" as const;
  if (dueAt && dueAt < now) return "OVERDUE" as const;
  return "OPEN" as const;
}

async function ensurePaymentCategory(tx: Prisma.TransactionClient, direction: FinancialSettlementDirection) {
  const isPayable = direction === "PAYABLE";
  return tx.financialCategory.upsert({
    where: { code: isPayable ? SUPPLIER_PAYMENT_CATEGORY : PAYMENT_CATEGORY },
    update: {
      name: isPayable ? "Оплата постачальнику" : "Оплата клієнта",
      cashFlowSection: "OPERATING",
      isActive: true,
    },
    create: {
      code: isPayable ? SUPPLIER_PAYMENT_CATEGORY : PAYMENT_CATEGORY,
      name: isPayable ? "Оплата постачальнику" : "Оплата клієнта",
      cashFlowSection: "OPERATING",
      isSystem: true,
      isActive: true,
      sortOrder: isPayable ? 61 : 60,
    },
  });
}

async function accountForSettlement(
  tx: Prisma.TransactionClient,
  moneyAccountId: string,
  currency: string,
) {
  const account = await tx.moneyAccount.findUnique({ where: { id: moneyAccountId } });
  if (!account || !account.isActive) {
    throw new FinanceSettlementError("MONEY_ACCOUNT_NOT_FOUND", "Активний рахунок не знайдено.", 404);
  }
  if (account.currency !== currency) {
    throw new FinanceSettlementError("CURRENCY_MISMATCH", "Валюта рахунку не відповідає валюті зобов’язання.");
  }
  return account;
}

async function findObligation(
  tx: Prisma.TransactionClient,
  input: FinancialSettlementInput,
  direction: FinancialSettlementDirection,
) {
  const obligationId = text(input.obligationId, 96);
  const clientId = text(input.clientId, 64);
  const supplierId = text(input.supplierId, 64);
  const workOrderId = text(input.workOrderId, 64);
  const locationId = text(input.locationId, 64);
  const where: Prisma.FinancialObligationWhereInput = {
    direction,
    status: { in: [...OPEN_STATUSES] },
    ...(obligationId ? { id: obligationId } : {}),
    ...(clientId ? { clientId } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(workOrderId ? { workOrderId } : {}),
    ...(locationId ? { locationId } : {}),
  };
  const obligation = await tx.financialObligation.findFirst({
    where,
    orderBy: [{ dueAt: "asc" }, { issuedAt: "asc" }, { createdAt: "asc" }],
  });
  if (!obligation) {
    throw new FinanceSettlementError(
      direction === "PAYABLE" ? "PAYABLE_NOT_FOUND" : "RECEIVABLE_NOT_FOUND",
      direction === "PAYABLE"
        ? "Відкрите кредиторське зобов’язання не знайдено."
        : "Відкрите дебіторське зобов’язання не знайдено.",
      404,
    );
  }
  return obligation;
}

export async function postFinancialSettlement(input: FinancialSettlementInput, actor: FinanceActor) {
  const direction = directionValue(input.direction);
  const amount = positiveDecimal(input.amount, "SETTLEMENT_AMOUNT_REQUIRED", "Вкажіть суму платежу.");
  const moneyAccountId = text(input.moneyAccountId, 96);
  if (!moneyAccountId) throw new FinanceSettlementError("MONEY_ACCOUNT_REQUIRED", "Виберіть рахунок операції.");
  const idempotencyKey = settlementKey(input);
  const sourceEntity = text(input.sourceEntity, 48) || SETTLEMENT_SOURCE;
  const sourceEntityId = text(input.sourceEntityId, 128) || idempotencyKey;
  const occurredAt = dateValue(input.occurredAt, "INVALID_SETTLEMENT_DATE", "Некоректна дата платежу.");
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      "financial-settlement:" + sourceEntity + ":" + sourceEntityId,
    );

    const existing = await tx.financialSettlement.findFirst({
      where: { sourceEntity, sourceEntityId },
      include: { allocations: true },
    });
    if (existing) {
      const cash = existing.cashTransactionId
        ? await tx.cashTransaction.findUnique({ where: { id: existing.cashTransactionId } })
        : null;
      return { settlement: existing, cash, reused: true };
    }

    const obligation = await findObligation(tx, input, direction);
    const requestedLocationId = text(input.locationId, 64);
    if (requestedLocationId && obligation.locationId && requestedLocationId !== obligation.locationId) {
      throw new FinanceSettlementError("LOCATION_MISMATCH", "Платіж належить іншій станції.", 403);
    }

    const currentAmount = new Prisma.Decimal(obligation.amount);
    const currentSettled = new Prisma.Decimal(obligation.settledAmount);
    const remaining = currentAmount.minus(currentSettled);
    if (amount.greaterThan(remaining)) {
      throw new FinanceSettlementError(
        direction === "PAYABLE" ? "PAYMENT_EXCEEDS_PAYABLE" : "PAYMENT_EXCEEDS_RECEIVABLE",
        "Сума платежу перевищує залишок зобов’язання.",
      );
    }

    const account = await accountForSettlement(tx, moneyAccountId, obligation.currency);
    const category = await ensurePaymentCategory(tx, direction);
    const isReceivable = direction === "RECEIVABLE";
    const cash = await tx.cashTransaction.create({
      data: {
        kind: isReceivable ? "INFLOW" : "OUTFLOW",
        status: "POSTED",
        flowSection: "OPERATING",
        amount,
        currency: obligation.currency,
        occurredAt,
        fromAccountId: isReceivable ? null : account.id,
        toAccountId: isReceivable ? account.id : null,
        categoryId: category.id,
        costCenterId: obligation.costCenterId,
        obligationId: obligation.id,
        workOrderId: obligation.workOrderId,
        clientId: obligation.clientId,
        supplierId: obligation.supplierId,
        locationId: obligation.locationId || requestedLocationId,
        sourceEntity,
        sourceEntityId,
        description: text(input.note, 4000) || (isReceivable ? "Оплата клієнта" : "Оплата постачальнику"),
        metadata: jsonSafe({ idempotencyKey, direction, obligationId: obligation.id }),
        createdById: actor.id,
        postedAt: occurredAt,
      },
    });

    const nextSettled = currentSettled.plus(amount).toDecimalPlaces(2);
    const now = new Date();
    const updatedObligation = await tx.financialObligation.update({
      where: { id: obligation.id },
      data: {
        settledAmount: nextSettled,
        status: statusForObligation(currentAmount, nextSettled, obligation.dueAt, now),
        settledAt: nextSettled.greaterThanOrEqualTo(currentAmount) ? occurredAt : null,
      },
    });

    const settlement = await tx.financialSettlement.create({
      data: {
        type: isReceivable ? "PAYMENT" : "SUPPLIER_PAYMENT",
        status: "POSTED",
        amount,
        currency: obligation.currency,
        occurredAt,
        moneyAccountId: account.id,
        clientId: obligation.clientId || text(input.clientId, 64),
        supplierId: obligation.supplierId || text(input.supplierId, 64),
        workOrderId: obligation.workOrderId || text(input.workOrderId, 64),
        locationId: obligation.locationId || requestedLocationId,
        counterpartyName: obligation.counterpartyName || text(input.counterpartyName, 240),
        cashTransactionId: cash.id,
        sourceEntity,
        sourceEntityId,
        note: text(input.note, 4000),
        metadata: jsonSafe({ idempotencyKey, direction, obligationId: obligation.id }),
        createdById: actor.id,
      },
    });
    const allocation = await tx.financialSettlementAllocation.create({
      data: { settlementId: settlement.id, obligationId: obligation.id, amount },
    });

    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        actorName: actor.name,
        entityType: "FinancialSettlement",
        entityId: settlement.id,
        action: isReceivable ? "CUSTOMER_PAYMENT_POSTED" : "SUPPLIER_PAYMENT_POSTED",
        before: jsonSafe({ obligationId: obligation.id, settledAmount: currentSettled.toFixed(2), status: obligation.status }),
        after: jsonSafe({ settlementId: settlement.id, cashTransactionId: cash.id, allocationId: allocation.id, amount: amount.toFixed(2), settledAmount: nextSettled.toFixed(2), status: updatedObligation.status }),
      },
    });

    return { settlement, allocation, cash, obligation: updatedObligation, reused: false };
  });
}

export async function reverseFinancialSettlement(settlementId: string, actor: FinanceActor) {
  const id = text(settlementId, 96);
  if (!id) throw new FinanceSettlementError("SETTLEMENT_ID_REQUIRED", "Вкажіть платіж.");
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", "financial-settlement-reversal:" + id);
    const original = await tx.financialSettlement.findUnique({ where: { id }, include: { allocations: true } });
    if (!original) throw new FinanceSettlementError("SETTLEMENT_NOT_FOUND", "Платіж не знайдено.", 404);
    if (original.type === "ADVANCE_RECEIPT" || original.type === "ADVANCE_APPLY") {
      throw new FinanceSettlementError("ADVANCE_REVERSAL_REQUIRED", "Аванс потрібно повернути або скасувати окремою операцією.", 409);
    }

    const sourceEntity = "FINANCIAL_SETTLEMENT_REVERSAL";
    const sourceEntityId = id;
    const existingReversal = await tx.financialSettlement.findFirst({
      where: { sourceEntity, sourceEntityId },
      include: { allocations: true },
    });
    if (existingReversal) return { settlement: existingReversal, reused: true };

    if (original.status === "REVERSED") {
      return { settlement: original, reused: true };
    }

    const originalCash = original.cashTransactionId
      ? await tx.cashTransaction.findUnique({ where: { id: original.cashTransactionId } })
      : null;
    if (originalCash && originalCash.status !== "POSTED") {
      throw new FinanceSettlementError("CASH_TRANSACTION_NOT_POSTED", "Початковий платіж уже не є проведеним.", 409);
    }

    const now = new Date();
    for (const allocation of original.allocations) {
      await tx.$queryRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        "financial-obligation:" + allocation.obligationId,
      );
      const obligation = await tx.financialObligation.findUnique({ where: { id: allocation.obligationId } });
      if (!obligation) throw new FinanceSettlementError("OBLIGATION_NOT_FOUND", "Зобов’язання платежу не знайдено.", 404);
      const currentSettled = new Prisma.Decimal(obligation.settledAmount);
      const allocationAmount = new Prisma.Decimal(allocation.amount);
      if (currentSettled.lessThan(allocationAmount)) {
        throw new FinanceSettlementError("SETTLEMENT_REVERSAL_CONFLICT", "Залишок зобов’язання менший за суму сторно.", 409);
      }
      const nextSettled = currentSettled.minus(allocationAmount).toDecimalPlaces(2);
      await tx.financialObligation.update({
        where: { id: obligation.id },
        data: {
          settledAmount: nextSettled,
          status: statusForObligation(new Prisma.Decimal(obligation.amount), nextSettled, obligation.dueAt, now),
          settledAt: null,
        },
      });
    }

    let reversalCash = null;
    if (originalCash) {
      const existingCashReversal = await tx.cashTransaction.findUnique({ where: { reversalOfId: originalCash.id } });
      if (existingCashReversal) {
        reversalCash = existingCashReversal;
      } else {
        const isOriginalInflow = originalCash.kind === "INFLOW";
        reversalCash = await tx.cashTransaction.create({
          data: {
            kind: isOriginalInflow ? "OUTFLOW" : "INFLOW",
            status: "POSTED",
            flowSection: originalCash.flowSection,
            amount: originalCash.amount,
            currency: originalCash.currency,
            occurredAt: now,
            fromAccountId: isOriginalInflow ? originalCash.toAccountId : null,
            toAccountId: isOriginalInflow ? null : originalCash.fromAccountId,
            categoryId: originalCash.categoryId,
            costCenterId: originalCash.costCenterId,
            obligationId: originalCash.obligationId,
            workOrderId: originalCash.workOrderId,
            clientId: originalCash.clientId,
            supplierId: originalCash.supplierId,
            locationId: originalCash.locationId,
            sourceEntity,
            sourceEntityId,
            description: "Сторно фінансового платежу",
            metadata: jsonSafe({ reversalOfId: originalCash.id, settlementId: id }),
            reversalOfId: originalCash.id,
            createdById: actor.id,
            postedAt: now,
          },
        });
      }
    }

    const reversal = await tx.financialSettlement.create({
      data: {
        type: "REFUND",
        status: "POSTED",
        amount: original.amount,
        currency: original.currency,
        occurredAt: now,
        moneyAccountId: original.moneyAccountId,
        clientId: original.clientId,
        supplierId: original.supplierId,
        workOrderId: original.workOrderId,
        locationId: original.locationId,
        counterpartyName: original.counterpartyName,
        cashTransactionId: reversalCash?.id || null,
        sourceEntity,
        sourceEntityId,
        reversalOfId: original.id,
        note: text("Сторно: " + (original.note || "фінансовий платіж"), 4000),
        metadata: jsonSafe({ reversalOfId: original.id, allocationCount: original.allocations.length }),
        createdById: actor.id,
      },
    });
    for (const allocation of original.allocations) {
      await tx.financialSettlementAllocation.create({
        data: { settlementId: reversal.id, obligationId: allocation.obligationId, amount: allocation.amount },
      });
    }
    await tx.financialSettlement.update({ where: { id: original.id }, data: { status: "REVERSED" } });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        actorName: actor.name,
        entityType: "FinancialSettlement",
        entityId: original.id,
        action: "FINANCIAL_SETTLEMENT_REVERSED",
        before: jsonSafe({ status: original.status, amount: original.amount.toString() }),
        after: jsonSafe({ status: "REVERSED", reversalSettlementId: reversal.id, reversalCashTransactionId: reversalCash?.id || null }),
      },
    });
    return { settlement: reversal, original, cash: reversalCash, reused: false };
  });
}

export async function receiveCustomerAdvance(input: FinancialSettlementInput, actor: FinanceActor) {
  const clientId = text(input.clientId, 64);
  const moneyAccountId = text(input.moneyAccountId, 96);
  if (!clientId || !moneyAccountId) throw new FinanceSettlementError("ADVANCE_FIELDS_REQUIRED", "Для авансу потрібні клієнт і рахунок.");
  const amount = positiveDecimal(input.amount, "ADVANCE_AMOUNT_REQUIRED", "Вкажіть суму авансу.");
  const receivedAt = dateValue(input.occurredAt, "INVALID_ADVANCE_DATE", "Некоректна дата авансу.");
  const currency = (text((input as Record<string, unknown>).currency, 3) || "UAH").toUpperCase();
  const sourceEntity = "CUSTOMER_ADVANCE";
  const sourceEntityId = text(input.sourceEntityId, 128) || text(input.idempotencyKey, 120);
  if (!sourceEntityId) throw new FinanceSettlementError("IDEMPOTENCY_KEY_REQUIRED", "Для авансу потрібен ключ повторної безпеки.");
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", "customer-advance:" + sourceEntityId);
    const existingSettlement = await tx.financialSettlement.findFirst({
      where: { sourceEntity, sourceEntityId },
      include: { allocations: true },
    });
    if (existingSettlement) {
      const cash = existingSettlement.cashTransactionId
        ? await tx.cashTransaction.findUnique({ where: { id: existingSettlement.cashTransactionId } })
        : null;
      const advance = await tx.customerAdvance.findFirst({ where: { cashTransactionId: existingSettlement.cashTransactionId || "" } });
      return { settlement: existingSettlement, cash, advance, reused: true };
    }

    const account = await accountForSettlement(tx, moneyAccountId, currency);
    const existingCash = await tx.cashTransaction.findFirst({ where: { sourceEntity, sourceEntityId } });
    let cash = existingCash;
    if (!cash) {
      cash = await tx.cashTransaction.create({
        data: {
          kind: "INFLOW",
          status: "POSTED",
          flowSection: "OPERATING",
          amount,
          currency,
          occurredAt: receivedAt,
          toAccountId: account.id,
          clientId,
          workOrderId: text(input.workOrderId, 64),
          locationId: text(input.locationId, 64),
          sourceEntity,
          sourceEntityId,
          description: text(input.note, 4000) || "Аванс клієнта",
          metadata: jsonSafe({ sourceEntityId, advance: true }),
          createdById: actor.id,
          postedAt: receivedAt,
        },
      });
    } else if (new Prisma.Decimal(cash.amount).notEqualTo(amount)) {
      throw new FinanceSettlementError("ADVANCE_AMOUNT_CONFLICT", "Існуючий аванс має іншу суму.", 409);
    }

    let advance = await tx.customerAdvance.findFirst({ where: { cashTransactionId: cash.id } });
    if (!advance) {
      advance = await tx.customerAdvance.create({
        data: {
          clientId,
          workOrderId: text(input.workOrderId, 64),
          amount,
          currency,
          receivedAt,
          moneyAccountId: account.id,
          locationId: text(input.locationId, 64),
          cashTransactionId: cash.id,
          description: text(input.note, 4000),
          createdById: actor.id,
        },
      });
    }

    const settlement = await tx.financialSettlement.create({
      data: {
        type: "ADVANCE_RECEIPT",
        status: "POSTED",
        amount: advance.amount,
        currency: advance.currency,
        occurredAt: advance.receivedAt,
        moneyAccountId: advance.moneyAccountId,
        clientId: advance.clientId,
        workOrderId: advance.workOrderId,
        locationId: advance.locationId,
        cashTransactionId: cash.id,
        advanceId: advance.id,
        sourceEntity,
        sourceEntityId,
        counterpartyName: null,
        note: advance.description,
        metadata: jsonSafe({ advanceId: advance.id }),
        createdById: actor.id,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        actorName: actor.name,
        entityType: "CustomerAdvance",
        entityId: advance.id,
        action: "CUSTOMER_ADVANCE_RECEIVED",
        after: jsonSafe({ amount: advance.amount.toString(), settlementId: settlement.id, cashTransactionId: cash.id, clientId: advance.clientId }),
      },
    });
    return { settlement, cash, advance, reused: false };
  });
}

export async function applyCustomerAdvanceSettlement(
  advanceId: string,
  workOrderId: string,
  rawAmount: unknown,
  rawIdempotencyKey: unknown,
  actor: FinanceActor,
) {
  const id = text(advanceId, 96);
  const woId = text(workOrderId, 64);
  if (!id || !woId) throw new FinanceSettlementError("ADVANCE_FIELDS_REQUIRED", "Вкажіть аванс і замовлення.");
  const amount = positiveDecimal(rawAmount, "ADVANCE_AMOUNT_REQUIRED", "Вкажіть суму зарахування авансу.");
  const key = text(rawIdempotencyKey, 120) || "advance-apply:" + id + ":" + woId + ":" + amount.toFixed(2);
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", "customer-advance-apply:" + id + ":" + woId);
    const existing = await tx.financialSettlement.findFirst({
      where: { sourceEntity: "CUSTOMER_ADVANCE_APPLY", sourceEntityId: key },
      include: { allocations: true },
    });
    if (existing) return { settlement: existing, reused: true };

    const advance = await tx.customerAdvance.findUnique({ where: { id } });
    if (!advance) throw new FinanceSettlementError("ADVANCE_NOT_FOUND", "Аванс не знайдено.", 404);
    if (advance.status === "REFUNDED") throw new FinanceSettlementError("ADVANCE_CLOSED", "Повернений аванс не можна зарахувати.", 409);
    const remaining = new Prisma.Decimal(advance.amount).minus(advance.appliedAmount);
    if (amount.greaterThan(remaining)) throw new FinanceSettlementError("ADVANCE_EXCEEDS_REMAINING", "Сума зарахування перевищує залишок авансу.");

    const receivable = await tx.financialObligation.findFirst({
      where: {
        workOrderId: woId,
        clientId: advance.clientId,
        direction: "RECEIVABLE",
        status: { in: [...OPEN_STATUSES] },
      },
      orderBy: { issuedAt: "asc" },
    });
    if (!receivable) throw new FinanceSettlementError("RECEIVABLE_NOT_FOUND", "Для цього замовлення немає відкритої дебіторки.", 404);
    const receivableOutstanding = new Prisma.Decimal(outstandingAmount(receivable.amount, receivable.settledAmount));
    if (amount.greaterThan(receivableOutstanding)) throw new FinanceSettlementError("ADVANCE_EXCEEDS_RECEIVABLE", "Сума авансу перевищує залишок до оплати за замовленням.");

    const nextSettled = new Prisma.Decimal(receivable.settledAmount).plus(amount).toDecimalPlaces(2);
    const nextApplied = new Prisma.Decimal(advance.appliedAmount).plus(amount).toDecimalPlaces(2);
    const now = new Date();
    const updatedReceivable = await tx.financialObligation.update({
      where: { id: receivable.id },
      data: {
        settledAmount: nextSettled,
        status: statusForObligation(new Prisma.Decimal(receivable.amount), nextSettled, receivable.dueAt, now),
        settledAt: nextSettled.greaterThanOrEqualTo(receivable.amount) ? now : null,
      },
    });
    const updatedAdvance = await tx.customerAdvance.update({
      where: { id },
      data: {
        workOrderId: woId,
        appliedAmount: nextApplied,
        status: nextApplied.greaterThanOrEqualTo(advance.amount) ? "APPLIED" : "PARTIALLY_APPLIED",
      },
    });
    const settlement = await tx.financialSettlement.create({
      data: {
        type: "ADVANCE_APPLY",
        status: "POSTED",
        amount,
        currency: advance.currency,
        occurredAt: now,
        moneyAccountId: advance.moneyAccountId,
        clientId: advance.clientId,
        workOrderId: woId,
        locationId: advance.locationId || receivable.locationId,
        advanceId: advance.id,
        sourceEntity: "CUSTOMER_ADVANCE_APPLY",
        sourceEntityId: key,
        note: "Зарахування авансу в оплату замовлення",
        metadata: jsonSafe({ advanceId: advance.id, receivableId: receivable.id }),
        createdById: actor.id,
      },
    });
    const allocation = await tx.financialSettlementAllocation.create({
      data: { settlementId: settlement.id, obligationId: receivable.id, amount },
    });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        actorName: actor.name,
        entityType: "CustomerAdvance",
        entityId: advance.id,
        action: "CUSTOMER_ADVANCE_APPLIED",
        before: jsonSafe({ appliedAmount: advance.appliedAmount.toString(), status: advance.status, receivableSettled: receivable.settledAmount.toString() }),
        after: jsonSafe({ appliedAmount: nextApplied.toString(), status: updatedAdvance.status, settlementId: settlement.id, allocationId: allocation.id, receivableSettled: nextSettled.toString() }),
      },
    });
    return { settlement, allocation, advance: updatedAdvance, receivable: updatedReceivable, reused: false };
  });
}

export async function refundCustomerAdvanceSettlement(advanceId: string, actor: FinanceActor) {
  const id = text(advanceId, 96);
  if (!id) throw new FinanceSettlementError("ADVANCE_ID_REQUIRED", "Вкажіть аванс.");
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", "customer-advance-refund:" + id);
    const existingSettlement = await tx.financialSettlement.findFirst({
      where: { sourceEntity: "CUSTOMER_ADVANCE_REFUND", sourceEntityId: id },
      include: { allocations: true },
    });
    if (existingSettlement) {
      const cash = existingSettlement.cashTransactionId
        ? await tx.cashTransaction.findUnique({ where: { id: existingSettlement.cashTransactionId } })
        : null;
      const advance = await tx.customerAdvance.findUnique({ where: { id } });
      return { settlement: existingSettlement, cash, advance, reused: true };
    }

    const advance = await tx.customerAdvance.findUnique({ where: { id } });
    if (!advance) throw new FinanceSettlementError("ADVANCE_NOT_FOUND", "Аванс не знайдено.", 404);
    if (advance.status === "REFUNDED") throw new FinanceSettlementError("ADVANCE_CLOSED", "Аванс уже повернуто.", 409);
    const remaining = new Prisma.Decimal(advance.amount).minus(advance.appliedAmount).toDecimalPlaces(2);
    if (remaining.lessThanOrEqualTo(0)) throw new FinanceSettlementError("ADVANCE_NO_REMAINING", "У авансу немає невикористаного залишку.", 409);
    const account = await accountForSettlement(tx, advance.moneyAccountId, advance.currency);
    const existingCash = await tx.cashTransaction.findFirst({ where: { sourceEntity: "CUSTOMER_ADVANCE_REFUND", sourceEntityId: id } });
    let cash = existingCash;
    const now = new Date();
    if (!cash) {
      cash = await tx.cashTransaction.create({
        data: {
          kind: "OUTFLOW",
          status: "POSTED",
          flowSection: "OPERATING",
          amount: remaining,
          currency: advance.currency,
          occurredAt: now,
          fromAccountId: account.id,
          clientId: advance.clientId,
          workOrderId: advance.workOrderId,
          locationId: advance.locationId,
          sourceEntity: "CUSTOMER_ADVANCE_REFUND",
          sourceEntityId: id,
          description: "Повернення невикористаного авансу клієнта",
          metadata: jsonSafe({ advanceId: id, appliedAmount: advance.appliedAmount.toString() }),
          createdById: actor.id,
          postedAt: now,
        },
      });
    } else if (new Prisma.Decimal(cash.amount).notEqualTo(remaining)) {
      throw new FinanceSettlementError("ADVANCE_REFUND_CONFLICT", "Існуюче повернення авансу має іншу суму.", 409);
    }

    const updatedAdvance = await tx.customerAdvance.update({ where: { id }, data: { status: "REFUNDED" } });
    const settlement = await tx.financialSettlement.create({
      data: {
        type: "ADVANCE_REFUND",
        status: "POSTED",
        amount: remaining,
        currency: advance.currency,
        occurredAt: now,
        moneyAccountId: account.id,
        clientId: advance.clientId,
        workOrderId: advance.workOrderId,
        locationId: advance.locationId,
        cashTransactionId: cash.id,
        advanceId: advance.id,
        sourceEntity: "CUSTOMER_ADVANCE_REFUND",
        sourceEntityId: id,
        note: "Повернення невикористаного авансу",
        metadata: jsonSafe({ advanceId: id, appliedAmount: advance.appliedAmount.toString() }),
        createdById: actor.id,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        actorName: actor.name,
        entityType: "CustomerAdvance",
        entityId: advance.id,
        action: "CUSTOMER_ADVANCE_REFUNDED",
        before: jsonSafe({ status: advance.status, appliedAmount: advance.appliedAmount.toString() }),
        after: jsonSafe({ status: updatedAdvance.status, settlementId: settlement.id, cashTransactionId: cash.id, amount: remaining.toFixed(2) }),
      },
    });
    return { settlement, cash, advance: updatedAdvance, reused: false };
  });
}

export async function listFinancialSettlements(options: {
  locationId?: string | null;
  locationIds?: string[] | null;
  type?: string | null;
  status?: string | null;
  clientId?: string | null;
  supplierId?: string | null;
  workOrderId?: string | null;
  from?: Date | null;
  to?: Date | null;
}) {
  const prisma = getPrisma();
  const type = options.type && ["PAYMENT", "REFUND", "ADVANCE_RECEIPT", "ADVANCE_APPLY", "ADVANCE_REFUND", "SUPPLIER_PAYMENT"].includes(options.type)
    ? options.type as "PAYMENT" | "REFUND" | "ADVANCE_RECEIPT" | "ADVANCE_APPLY" | "ADVANCE_REFUND" | "SUPPLIER_PAYMENT"
    : undefined;
  const status = options.status && ["POSTED", "REVERSED"].includes(options.status)
    ? options.status as "POSTED" | "REVERSED"
    : undefined;
  const rows = await prisma.financialSettlement.findMany({
    where: {
      ...(options.locationId ? { locationId: options.locationId } : options.locationIds?.length ? { locationId: { in: options.locationIds } } : {}),
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(options.clientId ? { clientId: options.clientId } : {}),
      ...(options.supplierId ? { supplierId: options.supplierId } : {}),
      ...(options.workOrderId ? { workOrderId: options.workOrderId } : {}),
      ...(options.from || options.to ? { occurredAt: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lt: options.to } : {}) } } : {}),
    },
    include: { allocations: true },
    orderBy: { occurredAt: "desc" },
    take: 500,
  });
  return rows;
}

export async function listFinancialPayables(options: {
  locationId?: string | null;
  locationIds?: string[] | null;
  status?: string | null;
  supplierId?: string | null;
}) {
  const prisma = getPrisma();
  const status = options.status && ["OPEN", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"].includes(options.status)
    ? options.status as "OPEN" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CANCELLED"
    : undefined;
  return prisma.financialObligation.findMany({
    where: {
      direction: "PAYABLE",
      ...(status ? { status } : { status: { in: [...OPEN_STATUSES] } }),
      ...(options.locationId ? { locationId: options.locationId } : options.locationIds?.length ? { locationId: { in: options.locationIds } } : {}),
      ...(options.supplierId ? { supplierId: options.supplierId } : {}),
    },
    orderBy: [{ dueAt: "asc" }, { issuedAt: "asc" }],
    take: 500,
  });
}

export async function listFinanceAdvances(options: {
  locationId?: string | null;
  locationIds?: string[] | null;
  clientId?: string | null;
}) {
  const prisma = getPrisma();
  return prisma.customerAdvance.findMany({
    where: {
      ...(options.locationId ? { locationId: options.locationId } : options.locationIds?.length ? { locationId: { in: options.locationIds } } : {}),
      ...(options.clientId ? { clientId: options.clientId } : {}),
    },
    orderBy: { receivedAt: "desc" },
    take: 500,
  });
}
