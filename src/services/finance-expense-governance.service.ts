import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import { FinancialCenterV2Error, type FinanceActor } from "@/src/services/financial-center-v2.service";

const EXPENSE_SOURCE = "MANUAL_EXPENSE";
const EXPENSE_LINE_SOURCE = "MANUAL_EXPENSE_LINE";
const EXPENSE_PAYMENT_SOURCE = "MANUAL_EXPENSE_PAYMENT";

function text(value: unknown, max = 4000) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export async function approvalRequirementForExpense(expenseId: string) {
  const prisma = getPrisma();
  const expense = await prisma.expenseDocument.findUnique({ where: { id: expenseId } });
  if (!expense) throw new FinancialCenterV2Error("EXPENSE_NOT_FOUND", "Витрату не знайдено.", 404);
  const rules = await prisma.financialApprovalRule.findMany({
    where: { operationType: "EXPENSE", isActive: true, OR: [{ locationId: expense.locationId }, { locationId: null }] },
    orderBy: [{ sortOrder: "asc" }, { minAmount: "desc" }],
  });
  const amount = new Prisma.Decimal(expense.amount);
  const rule = rules.find((item) => amount.greaterThanOrEqualTo(item.minAmount) && (!item.maxAmount || amount.lessThanOrEqualTo(item.maxAmount))) || null;
  return { expense, required: Boolean(rule), rule };
}

export async function requestExpenseApproval(expenseId: string, actor: FinanceActor) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `expense-approval-request:${expenseId}`);
    const current = await tx.expenseDocument.findUnique({ where: { id: expenseId } });
    if (!current) throw new FinancialCenterV2Error("EXPENSE_NOT_FOUND", "Витрату не знайдено.", 404);
    if (!["DRAFT", "REJECTED"].includes(current.status)) throw new FinancialCenterV2Error("EXPENSE_NOT_SUBMITTABLE", "На погодження можна подати лише чернетку або відхилену витрату.", 409);
    const updated = await tx.expenseDocument.update({ where: { id: expenseId }, data: { status: "PENDING_APPROVAL", approvedById: null, approvedAt: null } });
    await tx.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "ExpenseDocument", entityId: expenseId, action: "EXPENSE_APPROVAL_REQUESTED", before: toPrismaJson({ status: current.status }), after: toPrismaJson({ status: updated.status }) } });
    return updated;
  });
}

export async function approveExpense(expenseId: string, actor: FinanceActor) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `expense-approve:${expenseId}`);
    const current = await tx.expenseDocument.findUnique({ where: { id: expenseId } });
    if (!current) throw new FinancialCenterV2Error("EXPENSE_NOT_FOUND", "Витрату не знайдено.", 404);
    if (!["PENDING_APPROVAL", "DRAFT"].includes(current.status)) throw new FinancialCenterV2Error("EXPENSE_NOT_APPROVABLE", "Витрата не очікує погодження.", 409);
    const now = new Date();
    const updated = await tx.expenseDocument.update({ where: { id: expenseId }, data: { status: "APPROVED", approvedById: actor.id, approvedAt: now } });
    await tx.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "ExpenseDocument", entityId: expenseId, action: "EXPENSE_APPROVED", before: toPrismaJson({ status: current.status }), after: toPrismaJson({ status: updated.status, approvedAt: now }) } });
    return updated;
  });
}

export async function rejectExpense(expenseId: string, reason: unknown, actor: FinanceActor) {
  const prisma = getPrisma();
  const rejectionReason = text(reason) || "Відхилено без коментаря";
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `expense-reject:${expenseId}`);
    const current = await tx.expenseDocument.findUnique({ where: { id: expenseId } });
    if (!current) throw new FinancialCenterV2Error("EXPENSE_NOT_FOUND", "Витрату не знайдено.", 404);
    if (!["PENDING_APPROVAL", "APPROVED"].includes(current.status)) throw new FinancialCenterV2Error("EXPENSE_NOT_REJECTABLE", "Витрата не перебуває у стані погодження.", 409);
    const updated = await tx.expenseDocument.update({ where: { id: expenseId }, data: { status: "REJECTED", approvedById: null, approvedAt: null, notes: [current.notes, `Відхилення: ${rejectionReason}`].filter(Boolean).join("\n") } });
    await tx.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "ExpenseDocument", entityId: expenseId, action: "EXPENSE_REJECTED", before: toPrismaJson({ status: current.status }), after: toPrismaJson({ status: updated.status, reason: rejectionReason }) } });
    return updated;
  });
}

export async function reverseExpense(expenseId: string, reason: unknown, actor: FinanceActor) {
  const prisma = getPrisma();
  const reversalReason = text(reason);
  if (!reversalReason) throw new FinancialCenterV2Error("REVERSAL_REASON_REQUIRED", "Для сторно вкажіть причину.");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `expense-reverse:${expenseId}`);
    const current = await tx.expenseDocument.findUnique({ where: { id: expenseId } });
    if (!current) throw new FinancialCenterV2Error("EXPENSE_NOT_FOUND", "Витрату не знайдено.", 404);
    if (current.status === "REVERSED") return { expense: current, reused: true };
    if (current.status !== "POSTED") throw new FinancialCenterV2Error("EXPENSE_NOT_POSTED", "Сторнувати можна лише проведену витрату.", 409);

    const [events, cash, obligations] = await Promise.all([
      tx.financialEvent.findMany({ where: { status: "POSTED", OR: [{ sourceEntity: EXPENSE_SOURCE, sourceEntityId: expenseId }, { sourceEntity: EXPENSE_LINE_SOURCE, sourceEntityId: { startsWith: `${expenseId}:` } }] } }),
      tx.cashTransaction.findMany({ where: { status: "POSTED", sourceEntity: EXPENSE_PAYMENT_SOURCE, sourceEntityId: { startsWith: `${expenseId}:` } } }),
      tx.financialObligation.findMany({ where: { sourceEntity: EXPENSE_SOURCE, sourceEntityId: expenseId, status: { in: ["OPEN", "PARTIALLY_PAID", "PAID", "OVERDUE"] } } }),
    ]);

    const now = new Date();
    for (const event of events) {
      const reversal = await tx.financialEvent.create({
        data: {
          status: "REVERSED",
          pnlSection: event.pnlSection,
          amount: event.amount,
          currency: event.currency,
          recognizedAt: now,
          categoryId: event.categoryId,
          costCenterId: event.costCenterId,
          workOrderId: event.workOrderId,
          clientId: event.clientId,
          vehicleId: event.vehicleId,
          supplierId: event.supplierId,
          employeeId: event.employeeId,
          locationId: event.locationId,
          sourceEntity: "EXPENSE_REVERSAL",
          sourceEntityId: `${expenseId}:${event.id}`.slice(0, 96),
          description: `Сторно: ${event.description || current.number}`,
          metadata: toPrismaJson({ expenseId, reversalReason }),
          reversalOfId: event.id,
          createdById: actor.id,
          postedAt: now,
        },
      });
      await tx.financialEvent.update({ where: { id: event.id }, data: { status: "REVERSED" } });
      void reversal;
    }

    for (const payment of cash) {
      const reversal = await tx.cashTransaction.create({
        data: {
          kind: payment.kind,
          status: "REVERSED",
          flowSection: payment.flowSection,
          amount: payment.amount,
          currency: payment.currency,
          occurredAt: now,
          fromAccountId: payment.fromAccountId,
          toAccountId: payment.toAccountId,
          categoryId: payment.categoryId,
          costCenterId: payment.costCenterId,
          obligationId: payment.obligationId,
          workOrderId: payment.workOrderId,
          clientId: payment.clientId,
          supplierId: payment.supplierId,
          locationId: payment.locationId,
          sourceEntity: "EXPENSE_PAYMENT_REVERSAL",
          sourceEntityId: `${expenseId}:${payment.id}`.slice(0, 96),
          description: `Сторно: ${payment.description || current.number}`,
          metadata: toPrismaJson({ expenseId, reversalReason }),
          reversalOfId: payment.id,
          createdById: actor.id,
          postedAt: now,
        },
      });
      await tx.cashTransaction.update({ where: { id: payment.id }, data: { status: "REVERSED" } });
      void reversal;
    }

    for (const obligation of obligations) {
      await tx.financialObligation.update({ where: { id: obligation.id }, data: { status: "CANCELLED", settledAt: now, metadata: toPrismaJson({ reversedExpenseId: expenseId, reversalReason }) } });
    }

    const updated = await tx.expenseDocument.update({ where: { id: expenseId }, data: { status: "REVERSED", reversedAt: now, reversalReason } });
    await tx.auditEvent.create({ data: { actorId: actor.id, actorName: actor.name, entityType: "ExpenseDocument", entityId: expenseId, action: "EXPENSE_REVERSED", before: toPrismaJson({ status: current.status, paidAmount: current.paidAmount.toString() }), after: toPrismaJson({ status: updated.status, reversalReason, financialEvents: events.length, cashTransactions: cash.length, obligations: obligations.length }) } });
    return { expense: updated, reversedEvents: events.length, reversedCashTransactions: cash.length, cancelledObligations: obligations.length, reused: false };
  });
}

export async function listExpenseAttachments(expenseDocumentId: string) {
  const prisma = getPrisma();
  return prisma.expenseAttachment.findMany({ where: { expenseDocumentId }, orderBy: { createdAt: "desc" } });
}
