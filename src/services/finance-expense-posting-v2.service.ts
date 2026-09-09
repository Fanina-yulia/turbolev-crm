import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { FinanceExpenseError, type ExpensePostingInput } from "@/src/services/finance-expenses.service";

const EXPENSE_SOURCE = "MANUAL_EXPENSE";
const EXPENSE_LINE_SOURCE = "MANUAL_EXPENSE_LINE";
const EXPENSE_PAYMENT_SOURCE = "MANUAL_EXPENSE_PAYMENT";

function text(value: unknown, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function decimal(value: unknown, code: string, message: string) {
  if (value === null || value === undefined || value === "") throw new FinanceExpenseError(code, message);
  try {
    const result = new Prisma.Decimal(String(value).replace(",", ".")).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (!result.isFinite() || result.lessThanOrEqualTo(0)) throw new Error("invalid");
    return result;
  } catch {
    throw new FinanceExpenseError(code, message);
  }
}

function optionalDate(value: unknown, code: string, message: string) {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00+03:00`) : new Date(raw);
  if (Number.isNaN(date.getTime())) throw new FinanceExpenseError(code, message);
  return date;
}

function paymentStatus(value: unknown): "UNPAID" | "PARTIALLY_PAID" | "PAID" {
  const status = typeof value === "string" ? value.toUpperCase() : "UNPAID";
  if (status === "UNPAID" || status === "PARTIALLY_PAID" || status === "PAID") return status;
  throw new FinanceExpenseError("INVALID_PAYMENT_STATUS", "Некоректний статус оплати.");
}

function finalPaymentStatus(amount: Prisma.Decimal, paidAmount: Prisma.Decimal, dueAt: Date | null, now: Date) {
  if (paidAmount.greaterThanOrEqualTo(amount)) return "PAID" as const;
  if (paidAmount.greaterThan(0)) return "PARTIALLY_PAID" as const;
  if (dueAt && dueAt < now) return "OVERDUE" as const;
  return "UNPAID" as const;
}

async function approvalRule(tx: Prisma.TransactionClient, locationId: string | null, amount: Prisma.Decimal) {
  const rules = await tx.financialApprovalRule.findMany({
    where: { operationType: "EXPENSE", isActive: true, OR: [{ locationId }, { locationId: null }] },
    orderBy: [{ sortOrder: "asc" }, { minAmount: "desc" }],
  });
  return rules.find((rule) => amount.greaterThanOrEqualTo(rule.minAmount) && (!rule.maxAmount || amount.lessThanOrEqualTo(rule.maxAmount))) || null;
}

export async function postExpenseV2(id: string, input: ExpensePostingInput, actorId: string | null, actorName: string) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `finance-expense-post-v2:${id}`);
    const current = await tx.expenseDocument.findUnique({ where: { id }, include: { lines: true } });
    if (!current) throw new FinanceExpenseError("EXPENSE_NOT_FOUND", "Витрату не знайдено.", 404);
    if (current.status === "POSTED") return { expense: current, reused: true };
    if (current.status === "REVERSED") throw new FinanceExpenseError("EXPENSE_REVERSED", "Сторновану витрату не можна провести повторно.", 409);

    const requiredApproval = await approvalRule(tx, current.locationId, new Prisma.Decimal(current.amount));
    if (requiredApproval && current.status !== "APPROVED") {
      throw new FinanceExpenseError("EXPENSE_APPROVAL_REQUIRED", `Витрата потребує погодження за правилом «${requiredApproval.name}».`, 409);
    }
    if (current.status !== "DRAFT" && current.status !== "APPROVED") throw new FinanceExpenseError("EXPENSE_NOT_READY", "Витрата не готова до проведення.", 409);

    if (!current.categoryId && !current.lines.some((line) => line.categoryId)) throw new FinanceExpenseError("CATEGORY_REQUIRED", "У витрати відсутня категорія.");
    const categoryIds = Array.from(new Set([current.categoryId, ...current.lines.map((line) => line.categoryId)].filter(Boolean) as string[]));
    const categories = await tx.financialCategory.findMany({ where: { id: { in: categoryIds }, isActive: true } });
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    if (categoryById.size !== categoryIds.length) throw new FinanceExpenseError("CATEGORY_NOT_FOUND", "Одну з категорій витрати не знайдено або деактивовано.", 404);
    for (const category of categories) {
      if (category.pnlSection === "REVENUE") throw new FinanceExpenseError("INVALID_EXPENSE_CATEGORY", "Категорія доходу не може використовуватися для витрати.");
    }

    const requestedPaymentStatus = paymentStatus(input.paymentStatus ?? current.paymentStatus);
    const paidAmount = requestedPaymentStatus === "PAID"
      ? new Prisma.Decimal(current.amount)
      : requestedPaymentStatus === "PARTIALLY_PAID"
        ? decimal(input.paidAmount, "PAID_AMOUNT_REQUIRED", "Вкажіть суму часткової оплати.")
        : new Prisma.Decimal(0);
    if (paidAmount.greaterThan(current.amount)) throw new FinanceExpenseError("PAYMENT_EXCEEDS_EXPENSE", "Оплата не може перевищувати суму витрати.");

    const paymentDate = optionalDate(input.paymentDate, "INVALID_PAYMENT_DATE", "Дата оплати є некоректною.") ?? current.paymentDate ?? new Date();
    const dueAt = optionalDate(input.dueAt, "INVALID_DUE_DATE", "Строк оплати є некоректним.") ?? current.dueAt;
    const moneyAccountId = text(input.moneyAccountId, 64) || current.moneyAccountId;
    if (paidAmount.greaterThan(0) && !moneyAccountId) throw new FinanceExpenseError("MONEY_ACCOUNT_REQUIRED", "Для оплаченої витрати потрібно вибрати рахунок.");
    if (requestedPaymentStatus === "UNPAID" && !current.counterpartyName && !current.supplierId) throw new FinanceExpenseError("COUNTERPARTY_REQUIRED", "Для неоплаченої витрати вкажіть постачальника або контрагента.");

    let account = null;
    if (moneyAccountId) {
      account = await tx.moneyAccount.findUnique({ where: { id: moneyAccountId } });
      if (!account?.isActive) throw new FinanceExpenseError("MONEY_ACCOUNT_NOT_FOUND", "Активний рахунок не знайдено.", 404);
      if (account.currency !== current.currency) throw new FinanceExpenseError("CURRENCY_MISMATCH", "Валюта рахунку не відповідає валюті витрати.");
    }

    const now = new Date();
    const obligationNeeded = Boolean(current.counterpartyName || current.supplierId || dueAt || paidAmount.greaterThan(0));
    const obligation = obligationNeeded ? await tx.financialObligation.create({
      data: {
        direction: "PAYABLE",
        status: finalPaymentStatus(current.amount, paidAmount, dueAt, now) === "UNPAID" ? "OPEN" : finalPaymentStatus(current.amount, paidAmount, dueAt, now),
        amount: current.amount,
        settledAmount: paidAmount,
        currency: current.currency,
        issuedAt: current.expenseDate,
        dueAt,
        settledAt: paidAmount.greaterThanOrEqualTo(current.amount) ? paymentDate : null,
        categoryId: current.categoryId,
        costCenterId: current.costCenterId,
        supplierId: current.supplierId,
        locationId: current.locationId,
        counterpartyName: current.counterpartyName,
        workOrderId: current.workOrderId,
        sourceEntity: EXPENSE_SOURCE,
        sourceEntityId: current.id,
        description: current.description,
        metadata: toPrismaJson({ expenseId: current.id, expenseNumber: current.number }),
      },
    }) : null;

    const lines = current.lines.length ? current.lines : [{
      id: "document",
      lineNumber: 1,
      description: current.description || "Операційна витрата",
      amount: current.amount,
      quantity: null,
      unit: null,
      unitPrice: null,
      categoryId: current.categoryId,
      costCenterId: current.costCenterId,
      workOrderId: current.workOrderId,
      supplierId: current.supplierId,
      expenseDocumentId: current.id,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    }];

    const events = [];
    for (const line of lines) {
      const categoryId = line.categoryId || current.categoryId;
      const category = categoryId ? categoryById.get(categoryId) : null;
      if (!category?.pnlSection) continue;
      const event = await tx.financialEvent.create({
        data: {
          status: "POSTED",
          pnlSection: category.pnlSection,
          amount: line.amount,
          currency: current.currency,
          recognizedAt: current.recognizedAt,
          categoryId,
          costCenterId: line.costCenterId || current.costCenterId,
          supplierId: line.supplierId || current.supplierId,
          locationId: current.locationId,
          workOrderId: line.workOrderId || current.workOrderId,
          clientId: current.clientId,
          vehicleId: current.vehicleId,
          sourceEntity: EXPENSE_LINE_SOURCE,
          sourceEntityId: `${current.id}:${line.id}`.slice(0, 96),
          description: line.description || current.description || category.name,
          metadata: toPrismaJson({ expenseId: current.id, expenseNumber: current.number, expenseLineId: line.id, lineNumber: line.lineNumber }),
          createdById: actorId,
          postedAt: now,
        },
      });
      events.push(event);
    }

    const documentCategory = current.categoryId ? categoryById.get(current.categoryId) : null;
    const flowSections = Array.from(new Set(lines.map((line) => (line.categoryId ? categoryById.get(line.categoryId)?.cashFlowSection : null)).filter(Boolean)));
    const cashFlowSection = documentCategory?.cashFlowSection || (flowSections.length === 1 ? flowSections[0] : "OPERATING") || "OPERATING";
    const cash = paidAmount.greaterThan(0) && account ? await tx.cashTransaction.create({
      data: {
        kind: "OUTFLOW",
        status: "POSTED",
        flowSection: cashFlowSection,
        amount: paidAmount,
        currency: current.currency,
        occurredAt: paymentDate,
        fromAccountId: account.id,
        categoryId: current.categoryId,
        costCenterId: current.costCenterId,
        obligationId: obligation?.id,
        supplierId: current.supplierId,
        locationId: current.locationId,
        workOrderId: current.workOrderId,
        clientId: current.clientId,
        sourceEntity: EXPENSE_PAYMENT_SOURCE,
        sourceEntityId: `${current.id}:initial`,
        description: current.description || `Витрата ${current.number}`,
        metadata: toPrismaJson({ expenseId: current.id, expenseNumber: current.number }),
        createdById: actorId,
        postedAt: paymentDate,
      },
    }) : null;

    const finalStatus = finalPaymentStatus(current.amount, paidAmount, dueAt, now);
    const expense = await tx.expenseDocument.update({
      where: { id },
      data: { status: "POSTED", paymentStatus: finalStatus, paidAmount, moneyAccountId, paymentDate: paidAmount.greaterThan(0) ? paymentDate : null, dueAt, postedAt: now },
      include: { lines: true },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        actorName,
        entityType: "ExpenseDocument",
        entityId: id,
        action: "EXPENSE_POSTED",
        before: toPrismaJson({ status: current.status, paymentStatus: current.paymentStatus }),
        after: toPrismaJson({ status: expense.status, paymentStatus: expense.paymentStatus, amount: expense.amount.toString(), paidAmount: expense.paidAmount.toString(), financialEventIds: events.map((event) => event.id), cashTransactionId: cash?.id ?? null, obligationId: obligation?.id ?? null, approvalRuleId: requiredApproval?.id ?? null }),
      },
    });
    return { expense, events, cash, obligation, approvalRule: requiredApproval, reused: false };
  });
}
