import { Prisma } from "@/src/generated/prisma/client";
import { decimalToNumber, outstandingAmount, roundMoney } from "@/src/domain/finance";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

const EXPENSE_SOURCE = "MANUAL_EXPENSE";
const EXPENSE_PAYMENT_SOURCE = "MANUAL_EXPENSE_PAYMENT";

export class FinanceExpenseError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "FinanceExpenseError";
    this.code = code;
    this.status = status;
  }
}

type ExpenseLineInput = {
  description: string;
  amount: Prisma.Decimal;
  quantity?: Prisma.Decimal | null;
  unit?: string | null;
  unitPrice?: Prisma.Decimal | null;
  categoryId?: string | null;
  costCenterId?: string | null;
  workOrderId?: string | null;
  supplierId?: string | null;
};

export type ExpenseDraftInput = {
  amount: unknown;
  categoryId: unknown;
  expenseDate?: unknown;
  paymentDate?: unknown;
  dueAt?: unknown;
  currency?: unknown;
  locationId?: unknown;
  costCenterId?: unknown;
  supplierId?: unknown;
  counterpartyName?: unknown;
  moneyAccountId?: unknown;
  workOrderId?: unknown;
  clientId?: unknown;
  vehicleId?: unknown;
  supplierOrderId?: unknown;
  documentNumber?: unknown;
  description?: unknown;
  notes?: unknown;
  lines?: unknown;
};

export type ExpensePostingInput = {
  paymentStatus?: unknown;
  paidAmount?: unknown;
  moneyAccountId?: unknown;
  paymentDate?: unknown;
  dueAt?: unknown;
  idempotencyKey?: unknown;
};

export type ExpensePaymentInput = {
  paidAmount?: unknown;
  moneyAccountId?: unknown;
  paymentDate?: unknown;
  idempotencyKey?: unknown;
};

function text(value: unknown, max = 240) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function requiredText(value: unknown, code: string, message: string, max = 240) {
  const result = text(value, max);
  if (!result) throw new FinanceExpenseError(code, message);
  return result;
}

function decimal(value: unknown, code: string, message: string, allowZero = false) {
  if (value === null || value === undefined || value === "") {
    throw new FinanceExpenseError(code, message);
  }
  let result: Prisma.Decimal;
  try {
    result = new Prisma.Decimal(String(value).replace(",", ".")).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  } catch {
    throw new FinanceExpenseError(code, message);
  }
  if (!result.isFinite() || (allowZero ? result.lessThan(0) : result.lessThanOrEqualTo(0))) {
    throw new FinanceExpenseError(code, message);
  }
  return result;
}

function optionalDecimal(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return decimal(value, "INVALID_AMOUNT", "Сума має бути додатним числом.", true);
}

function dateValue(value: unknown, code: string, message: string, fallback = new Date()) {
  if (value === null || value === undefined || value === "") return fallback;
  const raw = String(value);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(raw + "T12:00:00+03:00")
    : new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new FinanceExpenseError(code, message);
  return parsed;
}

function optionalDate(value: unknown, code: string, message: string) {
  if (value === null || value === undefined || value === "") return null;
  return dateValue(value, code, message);
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return toPrismaJson(value);
}

function normalizeCurrency(value: unknown) {
  const currency = text(value, 3)?.toUpperCase() || "UAH";
  if (!/^[A-Z]{3}$/.test(currency)) throw new FinanceExpenseError("INVALID_CURRENCY", "Валюта повинна містити три латинські літери.");
  return currency;
}

function normalizePaymentStatus(value: unknown): "UNPAID" | "PARTIALLY_PAID" | "PAID" {
  const status = typeof value === "string" ? value.toUpperCase() : "UNPAID";
  if (status === "PAID" || status === "PARTIALLY_PAID" || status === "UNPAID") return status;
  throw new FinanceExpenseError("INVALID_PAYMENT_STATUS", "Некоректний статус оплати.");
}

function numberYear(date: Date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", year: "numeric" }).format(date);
}

async function nextExpenseNumber(tx: Prisma.TransactionClient, date: Date) {
  const year = numberYear(date);
  const lockKey = "finance-expense-number:" + year;
  await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", lockKey);
  const prefix = "ВТ-" + year + "-";
  const latest = await tx.expenseDocument.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const previous = latest ? Number(latest.number.slice(prefix.length)) : 0;
  return prefix + String((Number.isFinite(previous) ? previous : 0) + 1).padStart(5, "0");
}

async function categoryFor(tx: Prisma.TransactionClient, categoryId: string) {
  const category = await tx.financialCategory.findUnique({ where: { id: categoryId } });
  if (!category || !category.isActive) {
    throw new FinanceExpenseError("CATEGORY_NOT_FOUND", "Категорію витрати не знайдено або її деактивовано.", 404);
  }
  if (category.pnlSection === "REVENUE") {
    throw new FinanceExpenseError("INVALID_EXPENSE_CATEGORY", "Категорія доходу не може використовуватися для витрати.");
  }
  return category;
}

function parseLines(input: ExpenseDraftInput, amount: Prisma.Decimal, categoryId: string, costCenterId: string | null, workOrderId: string | null, supplierId: string | null): ExpenseLineInput[] {
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  const lines = rawLines.length
    ? rawLines.map((raw, index) => {
        const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
        return {
          description: requiredText(row.description, "LINE_DESCRIPTION_REQUIRED", "Опис рядка " + (index + 1) + " є обов’язковим."),
          amount: decimal(row.amount, "LINE_AMOUNT_INVALID", "Сума рядка " + (index + 1) + " є некоректною."),
          quantity: optionalDecimal(row.quantity),
          unit: text(row.unit, 32),
          unitPrice: optionalDecimal(row.unitPrice),
          categoryId: text(row.categoryId, 80) || categoryId,
          costCenterId: text(row.costCenterId, 80) || costCenterId,
          workOrderId: text(row.workOrderId, 64) || workOrderId,
          supplierId: text(row.supplierId, 64) || supplierId,
        } satisfies ExpenseLineInput;
      })
    : [{
        description: text(input.description, 500) || "Операційна витрата",
        amount,
        categoryId,
        costCenterId,
        workOrderId,
        supplierId,
      } satisfies ExpenseLineInput];

  const total = lines.reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0)).toDecimalPlaces(2);
  if (!total.equals(amount)) {
    throw new FinanceExpenseError("LINES_TOTAL_MISMATCH", "Сума рядків не дорівнює загальній сумі витрати.");
  }
  return lines;
}

function normalizeDraft(input: ExpenseDraftInput) {
  const amount = decimal(input.amount, "AMOUNT_REQUIRED", "Вкажіть додатну суму витрати.");
  const categoryId = requiredText(input.categoryId, "CATEGORY_REQUIRED", "Оберіть категорію витрати.", 80);
  const expenseDate = dateValue(input.expenseDate, "INVALID_EXPENSE_DATE", "Дата витрати є некоректною.");
  const currency = normalizeCurrency(input.currency);
  const costCenterId = text(input.costCenterId, 80);
  const workOrderId = text(input.workOrderId, 64);
  const supplierId = text(input.supplierId, 64);
  return {
    amount,
    categoryId,
    expenseDate,
    recognizedAt: expenseDate,
    paymentDate: optionalDate(input.paymentDate, "INVALID_PAYMENT_DATE", "Дата оплати є некоректною."),
    dueAt: optionalDate(input.dueAt, "INVALID_DUE_DATE", "Строк оплати є некоректним."),
    currency,
    locationId: text(input.locationId, 64),
    costCenterId,
    supplierId,
    counterpartyName: text(input.counterpartyName, 240),
    moneyAccountId: text(input.moneyAccountId, 64),
    workOrderId,
    clientId: text(input.clientId, 64),
    vehicleId: text(input.vehicleId, 64),
    supplierOrderId: text(input.supplierOrderId, 64),
    documentNumber: text(input.documentNumber, 120),
    description: text(input.description, 4000),
    notes: text(input.notes, 4000),
    lines: parseLines(input, amount, categoryId, costCenterId, workOrderId, supplierId),
  };
}

function paymentStatusFor(amount: Prisma.Decimal, paidAmount: Prisma.Decimal, dueAt: Date | null, now = new Date()) {
  if (paidAmount.greaterThanOrEqualTo(amount)) return "PAID" as const;
  if (paidAmount.greaterThan(0)) return "PARTIALLY_PAID" as const;
  if (dueAt && dueAt < now) return "OVERDUE" as const;
  return "UNPAID" as const;
}

async function validateAccount(tx: Prisma.TransactionClient, accountId: string, currency: string) {
  const account = await tx.moneyAccount.findUnique({ where: { id: accountId } });
  if (!account || !account.isActive) throw new FinanceExpenseError("MONEY_ACCOUNT_NOT_FOUND", "Активний рахунок не знайдено.", 404);
  if (account.currency !== currency) throw new FinanceExpenseError("CURRENCY_MISMATCH", "Валюта рахунку не відповідає валюті витрати.");
  return account;
}

async function createExpenseObligation(
  tx: Prisma.TransactionClient,
  expense: { id: string; amount: Prisma.Decimal; paidAmount: Prisma.Decimal; currency: string; dueAt: Date | null; categoryId: string | null; costCenterId: string | null; supplierId: string | null; locationId: string | null; counterpartyName: string | null; workOrderId: string | null; description: string | null },
) {
  const paymentStatus = paymentStatusFor(expense.amount, expense.paidAmount, expense.dueAt);
  const status = paymentStatus === "UNPAID" ? "OPEN" as const : paymentStatus;
  return tx.financialObligation.create({
    data: {
      direction: "PAYABLE",
      status,
      amount: expense.amount,
      settledAmount: expense.paidAmount,
      currency: expense.currency,
      issuedAt: new Date(),
      dueAt: expense.dueAt,
      settledAt: status === "PAID" ? new Date() : null,
      categoryId: expense.categoryId,
      costCenterId: expense.costCenterId,
      supplierId: expense.supplierId,
      locationId: expense.locationId,
      counterpartyName: expense.counterpartyName,
      workOrderId: expense.workOrderId,
      sourceEntity: EXPENSE_SOURCE,
      sourceEntityId: expense.id,
      description: expense.description,
    },
  });
}

export async function createExpense(input: ExpenseDraftInput, actorId: string | null, actorName: string) {
  const normalized = normalizeDraft(input);
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await categoryFor(tx, normalized.categoryId);
    const number = await nextExpenseNumber(tx, normalized.expenseDate);
    const expense = await tx.expenseDocument.create({
      data: {
        number,
        amount: normalized.amount,
        currency: normalized.currency,
        expenseDate: normalized.expenseDate,
        recognizedAt: normalized.recognizedAt,
        paymentDate: normalized.paymentDate,
        dueAt: normalized.dueAt,
        categoryId: normalized.categoryId,
        costCenterId: normalized.costCenterId,
        locationId: normalized.locationId,
        supplierId: normalized.supplierId,
        counterpartyName: normalized.counterpartyName,
        moneyAccountId: normalized.moneyAccountId,
        workOrderId: normalized.workOrderId,
        clientId: normalized.clientId,
        vehicleId: normalized.vehicleId,
        supplierOrderId: normalized.supplierOrderId,
        documentNumber: normalized.documentNumber,
        description: normalized.description,
        notes: normalized.notes,
        createdById: actorId,
        lines: { create: normalized.lines.map((line, index) => ({ ...line, lineNumber: index + 1 })) },
      },
      include: { lines: true },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        actorName,
        entityType: "ExpenseDocument",
        entityId: expense.id,
        action: "EXPENSE_DRAFT_CREATED",
        after: jsonSafe({ number: expense.number, amount: expense.amount.toString(), categoryId: expense.categoryId, locationId: expense.locationId }),
      },
    });
    return expense;
  });
}

export async function updateExpense(id: string, input: ExpenseDraftInput, actorId: string | null, actorName: string) {
  const normalized = normalizeDraft(input);
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const current = await tx.expenseDocument.findUnique({ where: { id }, include: { lines: true } });
    if (!current) throw new FinanceExpenseError("EXPENSE_NOT_FOUND", "Витрату не знайдено.", 404);
    if (current.status !== "DRAFT" && current.status !== "REJECTED") throw new FinanceExpenseError("EXPENSE_NOT_EDITABLE", "Проведену або погоджену витрату не можна редагувати.", 409);
    await categoryFor(tx, normalized.categoryId);
    await tx.expenseLine.deleteMany({ where: { expenseDocumentId: id } });
    const expense = await tx.expenseDocument.update({
      where: { id },
      data: {
        amount: normalized.amount,
        currency: normalized.currency,
        expenseDate: normalized.expenseDate,
        recognizedAt: normalized.recognizedAt,
        paymentDate: normalized.paymentDate,
        dueAt: normalized.dueAt,
        categoryId: normalized.categoryId,
        costCenterId: normalized.costCenterId,
        locationId: normalized.locationId,
        supplierId: normalized.supplierId,
        counterpartyName: normalized.counterpartyName,
        moneyAccountId: normalized.moneyAccountId,
        workOrderId: normalized.workOrderId,
        clientId: normalized.clientId,
        vehicleId: normalized.vehicleId,
        supplierOrderId: normalized.supplierOrderId,
        documentNumber: normalized.documentNumber,
        description: normalized.description,
        notes: normalized.notes,
        status: "DRAFT",
        paymentStatus: "UNPAID",
        paidAmount: 0,
        lines: { create: normalized.lines.map((line, index) => ({ ...line, lineNumber: index + 1 })) },
      },
      include: { lines: true },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        actorName,
        entityType: "ExpenseDocument",
        entityId: expense.id,
        action: "EXPENSE_DRAFT_UPDATED",
        before: jsonSafe({ status: current.status, amount: current.amount.toString(), categoryId: current.categoryId }),
        after: jsonSafe({ status: expense.status, amount: expense.amount.toString(), categoryId: expense.categoryId }),
      },
    });
    return expense;
  });
}

export async function postExpense(id: string, input: ExpensePostingInput, actorId: string | null, actorName: string) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const lockKey = "finance-expense-post:" + id;
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", lockKey);
    const current = await tx.expenseDocument.findUnique({ where: { id }, include: { lines: true } });
    if (!current) throw new FinanceExpenseError("EXPENSE_NOT_FOUND", "Витрату не знайдено.", 404);
    if (current.status === "POSTED") return { expense: current, reused: true };
    if (current.status === "REVERSED") throw new FinanceExpenseError("EXPENSE_REVERSED", "Сторновану витрату не можна провести повторно.", 409);
    if (current.status !== "DRAFT" && current.status !== "APPROVED") throw new FinanceExpenseError("EXPENSE_NOT_READY", "Витрата не готова до проведення.", 409);

    const categoryId = current.categoryId;
    if (!categoryId) throw new FinanceExpenseError("CATEGORY_REQUIRED", "У витрати відсутня категорія.");
    const category = await categoryFor(tx, categoryId);
    const paymentStatus = normalizePaymentStatus(input.paymentStatus ?? current.paymentStatus);
    const paidAmount = paymentStatus === "PAID"
      ? current.amount
      : paymentStatus === "PARTIALLY_PAID"
        ? decimal(input.paidAmount, "PAID_AMOUNT_REQUIRED", "Вкажіть суму часткової оплати.")
        : new Prisma.Decimal(0);
    if (paidAmount.greaterThan(current.amount)) throw new FinanceExpenseError("PAYMENT_EXCEEDS_EXPENSE", "Оплата не може перевищувати суму витрати.");
    const paymentDate = optionalDate(input.paymentDate, "INVALID_PAYMENT_DATE", "Дата оплати є некоректною.") ?? current.paymentDate ?? new Date();
    const dueAt = optionalDate(input.dueAt, "INVALID_DUE_DATE", "Строк оплати є некоректним.") ?? current.dueAt;
    const moneyAccountId = text(input.moneyAccountId, 64) || current.moneyAccountId;
    if (paidAmount.greaterThan(0) && !moneyAccountId) throw new FinanceExpenseError("MONEY_ACCOUNT_REQUIRED", "Для оплаченої витрати потрібно вибрати рахунок.");
    if (paidAmount.greaterThan(0) && moneyAccountId) await validateAccount(tx, moneyAccountId, current.currency);
    if (paymentStatus === "UNPAID" && !current.counterpartyName && !current.supplierId) {
      throw new FinanceExpenseError("COUNTERPARTY_REQUIRED", "Для неоплаченої витрати вкажіть постачальника або контрагента.");
    }

    const now = new Date();
    const obligation = current.counterpartyName || current.supplierId || dueAt || paidAmount.greaterThan(0)
      ? await createExpenseObligation(tx, {
          id: current.id,
          amount: current.amount,
          paidAmount,
          currency: current.currency,
          dueAt,
          categoryId: current.categoryId,
          costCenterId: current.costCenterId,
          supplierId: current.supplierId,
          locationId: current.locationId,
          counterpartyName: current.counterpartyName,
          workOrderId: current.workOrderId,
          description: current.description,
        })
      : null;

    const event = category.pnlSection
      ? await tx.financialEvent.create({
          data: {
            status: "POSTED",
            pnlSection: category.pnlSection,
            amount: current.amount,
            currency: current.currency,
            recognizedAt: current.recognizedAt,
            categoryId: current.categoryId,
            costCenterId: current.costCenterId,
            supplierId: current.supplierId,
            locationId: current.locationId,
            workOrderId: current.workOrderId,
            clientId: current.clientId,
            vehicleId: current.vehicleId,
            sourceEntity: EXPENSE_SOURCE,
            sourceEntityId: current.id,
            description: current.description || category.name,
            metadata: jsonSafe({ expenseId: current.id, expenseNumber: current.number }),
            createdById: actorId,
            postedAt: now,
          },
        })
      : null;

    const cash = paidAmount.greaterThan(0) && moneyAccountId
      ? await tx.cashTransaction.create({
          data: {
            kind: "OUTFLOW",
            status: "POSTED",
            flowSection: category.cashFlowSection || "OPERATING",
            amount: paidAmount,
            currency: current.currency,
            occurredAt: paymentDate,
            fromAccountId: moneyAccountId,
            categoryId: current.categoryId,
            costCenterId: current.costCenterId,
            obligationId: obligation?.id,
            supplierId: current.supplierId,
            locationId: current.locationId,
            workOrderId: current.workOrderId,
            clientId: current.clientId,
            sourceEntity: EXPENSE_PAYMENT_SOURCE,
            sourceEntityId: current.id + ":initial",
            description: current.description || category.name,
            metadata: jsonSafe({ expenseId: current.id, expenseNumber: current.number }),
            createdById: actorId,
            postedAt: paymentDate,
          },
        })
      : null;

    const finalPaymentStatus = paymentStatusFor(current.amount, paidAmount, dueAt, now);
    const expense = await tx.expenseDocument.update({
      where: { id },
      data: {
        status: "POSTED",
        paymentStatus: finalPaymentStatus,
        paidAmount,
        moneyAccountId,
        paymentDate: paidAmount.greaterThan(0) ? paymentDate : null,
        dueAt,
        postedAt: now,
      },
      include: { lines: true },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        actorName,
        entityType: "ExpenseDocument",
        entityId: id,
        action: "EXPENSE_POSTED",
        before: jsonSafe({ status: current.status, paymentStatus: current.paymentStatus }),
        after: jsonSafe({ status: expense.status, paymentStatus: expense.paymentStatus, amount: expense.amount.toString(), paidAmount: expense.paidAmount.toString(), eventId: event?.id ?? null, cashTransactionId: cash?.id ?? null, obligationId: obligation?.id ?? null }),
      },
    });
    return { expense, event, cash, obligation, reused: false };
  });
}

export async function payExpense(id: string, input: ExpensePaymentInput, actorId: string | null, actorName: string) {
  const amount = decimal(input.paidAmount, "PAYMENT_AMOUNT_REQUIRED", "Вкажіть суму оплати.");
  const accountId = requiredText(input.moneyAccountId, "MONEY_ACCOUNT_REQUIRED", "Виберіть рахунок для оплати.", 64);
  const idempotencyKey = requiredText(input.idempotencyKey, "IDEMPOTENCY_KEY_REQUIRED", "Ключ повторної безпеки оплати є обов’язковим.", 96);
  const occurredAt = optionalDate(input.paymentDate, "INVALID_PAYMENT_DATE", "Дата оплати є некоректною.") ?? new Date();
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const lockKey = "finance-expense-payment:" + id + ":" + idempotencyKey;
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", lockKey);
    const sourceEntityId = id + ":" + idempotencyKey;
    const existing = await tx.cashTransaction.findFirst({ where: { sourceEntity: EXPENSE_PAYMENT_SOURCE, sourceEntityId } });
    if (existing) return { payment: existing, reused: true };
    const expense = await tx.expenseDocument.findUnique({ where: { id } });
    if (!expense) throw new FinanceExpenseError("EXPENSE_NOT_FOUND", "Витрату не знайдено.", 404);
    if (expense.status !== "POSTED") throw new FinanceExpenseError("EXPENSE_NOT_POSTED", "Оплачувати можна лише проведену витрату.", 409);
    const obligation = await tx.financialObligation.findFirst({ where: { sourceEntity: EXPENSE_SOURCE, sourceEntityId: id, direction: "PAYABLE", status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] } }, orderBy: { createdAt: "desc" } });
    if (!obligation) throw new FinanceExpenseError("PAYABLE_NOT_FOUND", "Для цієї витрати немає відкритої кредиторки.", 404);
    const outstanding = new Prisma.Decimal(outstandingAmount(obligation.amount, obligation.settledAmount));
    if (amount.greaterThan(outstanding)) throw new FinanceExpenseError("PAYMENT_EXCEEDS_OUTSTANDING", "Оплата перевищує залишок кредиторки.");
    const account = await validateAccount(tx, accountId, expense.currency);
    const category = expense.categoryId ? await categoryFor(tx, expense.categoryId) : null;
    const payment = await tx.cashTransaction.create({
      data: {
        kind: "OUTFLOW",
        status: "POSTED",
        flowSection: category?.cashFlowSection || "OPERATING",
        amount,
        currency: expense.currency,
        occurredAt,
        fromAccountId: account.id,
        categoryId: expense.categoryId,
        costCenterId: expense.costCenterId,
        obligationId: obligation.id,
        supplierId: expense.supplierId,
        locationId: expense.locationId,
        workOrderId: expense.workOrderId,
        clientId: expense.clientId,
        sourceEntity: EXPENSE_PAYMENT_SOURCE,
        sourceEntityId,
        description: "Оплата витрати " + expense.number,
        metadata: jsonSafe({ expenseId: id, expenseNumber: expense.number, idempotencyKey }),
        createdById: actorId,
        postedAt: occurredAt,
      },
    });
    const settledAmount = new Prisma.Decimal(obligation.settledAmount).plus(amount).toDecimalPlaces(2);
    const fullyPaid = settledAmount.greaterThanOrEqualTo(obligation.amount);
    const updatedObligation = await tx.financialObligation.update({ where: { id: obligation.id }, data: { settledAmount, status: fullyPaid ? "PAID" : "PARTIALLY_PAID", settledAt: fullyPaid ? occurredAt : null } });
    const nextPaid = new Prisma.Decimal(expense.paidAmount).plus(amount).toDecimalPlaces(2);
    const updatedExpense = await tx.expenseDocument.update({ where: { id }, data: { paidAmount: nextPaid, paymentStatus: fullyPaid ? "PAID" : "PARTIALLY_PAID", paymentDate: occurredAt, moneyAccountId: account.id } });
    await tx.auditEvent.create({ data: { actorId, actorName, entityType: "ExpenseDocument", entityId: id, action: "EXPENSE_PAYMENT_POSTED", before: jsonSafe({ paidAmount: expense.paidAmount.toString(), obligationStatus: obligation.status }), after: jsonSafe({ paidAmount: updatedExpense.paidAmount.toString(), obligationStatus: updatedObligation.status, paymentId: payment.id, idempotencyKey }) } });
    return { payment, obligation: updatedObligation, expense: updatedExpense, reused: false };
  });
}

export async function listExpenses(options: { from?: Date | null; to?: Date | null; locationId?: string | null; locationIds?: string[]; status?: string | null; paymentStatus?: string | null; categoryId?: string | null; search?: string | null; page?: number; pageSize?: number }) {
  const prisma = getPrisma();
  const page = Math.max(1, options.page || 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize || 50));
  const where: Prisma.ExpenseDocumentWhereInput = {
    ...(options.from || options.to ? { expenseDate: { ...(options.from ? { gte: options.from } : {}), ...(options.to ? { lt: options.to } : {}) } } : {}),
    ...(options.locationId ? { locationId: options.locationId } : options.locationIds?.length ? { locationId: { in: options.locationIds } } : {}),
    ...(options.categoryId ? { categoryId: options.categoryId } : {}),
    ...(options.status ? { status: options.status as never } : {}),
    ...(options.paymentStatus ? { paymentStatus: options.paymentStatus as never } : {}),
    ...(options.search ? { OR: [{ number: { contains: options.search, mode: "insensitive" } }, { description: { contains: options.search, mode: "insensitive" } }, { counterpartyName: { contains: options.search, mode: "insensitive" } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.expenseDocument.findMany({ where, orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize, include: { lines: true } }),
    prisma.expenseDocument.count({ where }),
  ]);
  const categoryIds = Array.from(new Set(rows.flatMap((row) => [row.categoryId, ...row.lines.map((line) => line.categoryId)]).filter(Boolean) as string[]));
  const supplierIds = Array.from(new Set(rows.map((row) => row.supplierId).filter(Boolean) as string[]));
  const [categories, suppliers] = await Promise.all([
    categoryIds.length ? prisma.financialCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, code: true, name: true, pnlSection: true, cashFlowSection: true } }) : [],
    supplierIds.length ? prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } }) : [],
  ]);
  const categoryById = new Map(categories.map((row) => [row.id, row]));
  const supplierById = new Map(suppliers.map((row) => [row.id, row]));
  return {
    rows: rows.map((row) => ({
      ...row,
      amount: decimalToNumber(row.amount),
      paidAmount: decimalToNumber(row.paidAmount),
      outstanding: roundMoney(outstandingAmount(row.amount, row.paidAmount)),
      category: row.categoryId ? categoryById.get(row.categoryId) || null : null,
      supplier: row.supplierId ? supplierById.get(row.supplierId) || null : null,
      lines: row.lines.map((line) => ({ ...line, amount: decimalToNumber(line.amount), quantity: line.quantity ? decimalToNumber(line.quantity) : null, unitPrice: line.unitPrice ? decimalToNumber(line.unitPrice) : null })),
    })),
    total,
    page,
    pageSize,
  };
}

export async function getExpense(id: string) {
  const prisma = getPrisma();
  const row = await prisma.expenseDocument.findUnique({ where: { id }, include: { lines: true } });
  if (!row) throw new FinanceExpenseError("EXPENSE_NOT_FOUND", "Витрату не знайдено.", 404);
  const [category, supplier, obligations, cash] = await Promise.all([
    row.categoryId ? prisma.financialCategory.findUnique({ where: { id: row.categoryId }, select: { id: true, code: true, name: true, pnlSection: true, cashFlowSection: true } }) : null,
    row.supplierId ? prisma.supplier.findUnique({ where: { id: row.supplierId }, select: { id: true, name: true } }) : null,
    prisma.financialObligation.findMany({ where: { sourceEntity: EXPENSE_SOURCE, sourceEntityId: id }, orderBy: { createdAt: "asc" } }),
    prisma.cashTransaction.findMany({ where: { sourceEntity: EXPENSE_PAYMENT_SOURCE, sourceEntityId: { startsWith: id + ":" } }, orderBy: { occurredAt: "asc" }, include: { fromAccount: { select: { id: true, name: true, type: true } } } }),
  ]);
  return {
    ...row,
    amount: decimalToNumber(row.amount),
    paidAmount: decimalToNumber(row.paidAmount),
    outstanding: roundMoney(outstandingAmount(row.amount, row.paidAmount)),
    category,
    supplier,
    lines: row.lines.map((line) => ({ ...line, amount: decimalToNumber(line.amount), quantity: line.quantity ? decimalToNumber(line.quantity) : null, unitPrice: line.unitPrice ? decimalToNumber(line.unitPrice) : null })),
    obligations: obligations.map((item) => ({ ...item, amount: decimalToNumber(item.amount), settledAmount: decimalToNumber(item.settledAmount), outstanding: roundMoney(outstandingAmount(item.amount, item.settledAmount)) })),
    cash: cash.map((item) => ({ ...item, amount: decimalToNumber(item.amount) })),
  };
}
