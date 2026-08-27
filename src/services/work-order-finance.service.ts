import { Prisma } from "@/src/generated/prisma/client";
import {
  allocateNetRevenue,
  calculateWorkOrderFinance,
  parseOptionalDate,
  type WorkOrderFinanceCalculation,
  type WorkOrderFinanceInput,
} from "@/src/domain/work-order-finance";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

const SOURCE_FINALIZATION = "WORK_ORDER_FINANCE";
const SOURCE_PAYMENT = "WORK_ORDER_PAYMENT";

export class WorkOrderFinanceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkOrderFinanceError";
    this.code = code;
  }
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return toPrismaJson(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toDecimal(value: unknown) {
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(String(value ?? 0));
}

function decimalJson(value: Prisma.Decimal | null | undefined) {
  return value == null ? null : value.toFixed(2);
}

function calculationMetadata(calculation: WorkOrderFinanceCalculation, extra: Record<string, unknown> = {}) {
  return jsonSafe({
    version: 2,
    fingerprint: calculation.fingerprint,
    grossRevenueBeforeDiscounts: calculation.grossRevenueBeforeDiscounts.toFixed(2),
    ...extra,
  });
}

async function resolveWorkOrderContext(tx: Prisma.TransactionClient, workOrderId: string) {
  const workOrder = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      client: true,
      vehicle: true,
      diagnosticRequest: true,
    },
  });
  if (!workOrder) throw new WorkOrderFinanceError("WORK_ORDER_NOT_FOUND", "WorkOrder not found");

  const appointment = await tx.serviceAppointment.findFirst({
    where: {
      OR: [
        { workOrderId },
        ...(workOrder.diagnosticRequest.leadId ? [{ leadId: workOrder.diagnosticRequest.leadId }] : []),
        { clientId: workOrder.clientId, vehicleId: workOrder.vehicleId, actualArrivalAt: { not: null } },
      ],
    },
    orderBy: [{ actualArrivalAt: "desc" }, { plannedStartAt: "desc" }],
    select: { id: true, locationId: true },
  });

  const locationId = appointment?.locationId ?? null;
  const costCenter = locationId
    ? await tx.costCenter.findFirst({ where: { locationId, isActive: true }, orderBy: { sortOrder: "asc" } })
    : await tx.costCenter.findUnique({ where: { code: "STO_GLEVAKHA" } });

  return { workOrder, appointment, locationId, costCenter };
}

async function ensureCategory(
  tx: Prisma.TransactionClient,
  code: string,
  name: string,
  pnlSection: "REVENUE" | "COGS" | null,
  cashFlowSection: "OPERATING" | null,
  sortOrder: number,
) {
  return tx.financialCategory.upsert({
    where: { code },
    update: { name, pnlSection, cashFlowSection, isActive: true },
    create: { code, name, pnlSection, cashFlowSection, isSystem: true, isActive: true, sortOrder },
  });
}

async function ensurePostingCategoryMap(tx: Prisma.TransactionClient) {
  const definitions = [
    ["REV_LABOR", "Роботи", "REVENUE", "OPERATING", 10],
    ["REV_PARTS", "Продаж запчастин", "REVENUE", "OPERATING", 20],
    ["REV_EXTERNAL", "Сторонні роботи — продаж", "REVENUE", "OPERATING", 40],
    ["REV_OTHER", "Інші операційні доходи", "REVENUE", "OPERATING", 50],
    ["COGS_PARTS", "Собівартість запчастин", "COGS", "OPERATING", 110],
    ["COGS_LABOR", "Пряма оплата праці механіків", "COGS", "OPERATING", 120],
    ["COGS_EXTERNAL", "Сторонні роботи — собівартість", "COGS", "OPERATING", 130],
    ["COGS_CONSUMABLES", "Витратні матеріали", "COGS", "OPERATING", 140],
    ["COGS_OTHER", "Інші прямі витрати", "COGS", "OPERATING", 150],
  ] as const;

  const rows = await Promise.all(
    definitions.map(([code, name, pnl, cash, sort]) => ensureCategory(tx, code, name, pnl, cash, sort)),
  );
  return Object.fromEntries(rows.map((row) => [row.code, row]));
}

async function ensureEvent(
  tx: Prisma.TransactionClient,
  key: string,
  data: Prisma.FinancialEventUncheckedCreateInput,
) {
  const existing = await tx.financialEvent.findFirst({
    where: { sourceEntity: SOURCE_FINALIZATION, sourceEntityId: key },
  });
  if (existing) return existing;
  return tx.financialEvent.create({ data });
}

async function ensureReceivable(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  calculation: WorkOrderFinanceCalculation,
  context: Awaited<ReturnType<typeof resolveWorkOrderContext>>,
  issuedAt: Date,
  dueAt: Date | null,
) {
  const sourceEntityId = `${workOrderId}:receivable`;
  const existing = await tx.financialObligation.findFirst({
    where: { sourceEntity: SOURCE_FINALIZATION, sourceEntityId, direction: "RECEIVABLE" },
  });

  if (calculation.grossRevenue.isZero()) return existing;

  if (existing) {
    if (!toDecimal(existing.amount).equals(calculation.grossRevenue)) {
      throw new WorkOrderFinanceError(
        "RECEIVABLE_AMOUNT_CONFLICT",
        "Existing WorkOrder receivable has a different amount and must be corrected explicitly",
      );
    }
    return existing;
  }

  return tx.financialObligation.create({
    data: {
      direction: "RECEIVABLE",
      status: "OPEN",
      amount: calculation.grossRevenue,
      settledAmount: 0,
      currency: calculation.currency,
      issuedAt,
      dueAt,
      costCenterId: context.costCenter?.id ?? null,
      workOrderId,
      clientId: context.workOrder.clientId,
      locationId: context.locationId,
      counterpartyName: context.workOrder.client.name,
      sourceEntity: SOURCE_FINALIZATION,
      sourceEntityId,
      description: `До оплати за комерційною пропозицією ${workOrderId}`,
      metadata: calculationMetadata(calculation, { workOrderId }),
    },
  });
}

export async function savePlannedWorkOrderFinance(
  workOrderId: string,
  input: WorkOrderFinanceInput,
  actorName = "CRM / Сервіс-менеджер",
) {
  const calculation = calculateWorkOrderFinance(input);
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`wo-finance-plan:${workOrderId}`}))`;
    const context = await resolveWorkOrderContext(tx, workOrderId);
    const actual = await tx.workOrderFinanceSnapshot.findUnique({
      where: { workOrderId_kind: { workOrderId, kind: "ACTUAL" } },
    });
    if (actual?.lockedAt) {
      throw new WorkOrderFinanceError("ACTUAL_ALREADY_LOCKED", "Actual WorkOrder finance is already finalized");
    }

    const before = await tx.workOrderFinanceSnapshot.findUnique({
      where: { workOrderId_kind: { workOrderId, kind: "PLANNED" } },
    });
    const now = new Date();
    const snapshot = await tx.workOrderFinanceSnapshot.upsert({
      where: { workOrderId_kind: { workOrderId, kind: "PLANNED" } },
      update: {
        currency: calculation.currency,
        laborRevenue: calculation.laborRevenue,
        partsRevenue: calculation.partsRevenue,
        externalRevenue: calculation.externalRevenue,
        otherRevenue: calculation.otherRevenue,
        discountAmount: calculation.discountAmount,
        refundAmount: calculation.refundAmount,
        partsCost: calculation.partsCost,
        laborCost: calculation.laborCost,
        externalCost: calculation.externalCost,
        consumablesCost: calculation.consumablesCost,
        otherDirectCost: calculation.otherDirectCost,
        grossRevenue: calculation.grossRevenue,
        directCost: calculation.directCost,
        grossProfit: calculation.grossProfit,
        grossMarginPercent: calculation.grossMarginPercent,
        calculatedAt: now,
        metadata: calculationMetadata(calculation, { locationId: context.locationId, actorName }),
      },
      create: {
        workOrderId,
        kind: "PLANNED",
        currency: calculation.currency,
        laborRevenue: calculation.laborRevenue,
        partsRevenue: calculation.partsRevenue,
        externalRevenue: calculation.externalRevenue,
        otherRevenue: calculation.otherRevenue,
        discountAmount: calculation.discountAmount,
        refundAmount: calculation.refundAmount,
        partsCost: calculation.partsCost,
        laborCost: calculation.laborCost,
        externalCost: calculation.externalCost,
        consumablesCost: calculation.consumablesCost,
        otherDirectCost: calculation.otherDirectCost,
        grossRevenue: calculation.grossRevenue,
        directCost: calculation.directCost,
        grossProfit: calculation.grossProfit,
        grossMarginPercent: calculation.grossMarginPercent,
        calculatedAt: now,
        metadata: calculationMetadata(calculation, { locationId: context.locationId, actorName }),
      },
    });

    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: "FINANCE_PLAN_UPDATED",
        before: before ? jsonSafe(before) : undefined,
        after: jsonSafe(snapshot),
        metadata: calculationMetadata(calculation, { locationId: context.locationId }),
      },
    });

    return { workOrder: context.workOrder, snapshot, calculation };
  });
}

export async function finalizeWorkOrderFinance(
  workOrderId: string,
  input: WorkOrderFinanceInput,
  actorName = "CRM / Сервіс-менеджер",
) {
  const calculation = calculateWorkOrderFinance(input);
  const recognizedAt = parseOptionalDate(input.recognizedAt, "recognizedAt") ?? new Date();
  const dueAt = parseOptionalDate(input.dueAt, "dueAt");
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`wo-finance-finalize:${workOrderId}`}))`;
    const context = await resolveWorkOrderContext(tx, workOrderId);
    const existingActual = await tx.workOrderFinanceSnapshot.findUnique({
      where: { workOrderId_kind: { workOrderId, kind: "ACTUAL" } },
    });

    if (existingActual?.lockedAt) {
      const fingerprint = isRecord(existingActual.metadata) ? existingActual.metadata.fingerprint : null;
      if (fingerprint !== calculation.fingerprint) {
        throw new WorkOrderFinanceError(
          "ACTUAL_ALREADY_LOCKED",
          "Actual WorkOrder finance is locked. Corrections require a separate reversal workflow.",
        );
      }
    }

    const now = new Date();
    const snapshot = existingActual?.lockedAt
      ? existingActual
      : await tx.workOrderFinanceSnapshot.upsert({
          where: { workOrderId_kind: { workOrderId, kind: "ACTUAL" } },
          update: {
            currency: calculation.currency,
            laborRevenue: calculation.laborRevenue,
            partsRevenue: calculation.partsRevenue,
            externalRevenue: calculation.externalRevenue,
            otherRevenue: calculation.otherRevenue,
            discountAmount: calculation.discountAmount,
            refundAmount: calculation.refundAmount,
            partsCost: calculation.partsCost,
            laborCost: calculation.laborCost,
            externalCost: calculation.externalCost,
            consumablesCost: calculation.consumablesCost,
            otherDirectCost: calculation.otherDirectCost,
            grossRevenue: calculation.grossRevenue,
            directCost: calculation.directCost,
            grossProfit: calculation.grossProfit,
            grossMarginPercent: calculation.grossMarginPercent,
            calculatedAt: now,
            lockedAt: now,
            metadata: calculationMetadata(calculation, { recognizedAt: recognizedAt.toISOString(), locationId: context.locationId }),
          },
          create: {
            workOrderId,
            kind: "ACTUAL",
            currency: calculation.currency,
            laborRevenue: calculation.laborRevenue,
            partsRevenue: calculation.partsRevenue,
            externalRevenue: calculation.externalRevenue,
            otherRevenue: calculation.otherRevenue,
            discountAmount: calculation.discountAmount,
            refundAmount: calculation.refundAmount,
            partsCost: calculation.partsCost,
            laborCost: calculation.laborCost,
            externalCost: calculation.externalCost,
            consumablesCost: calculation.consumablesCost,
            otherDirectCost: calculation.otherDirectCost,
            grossRevenue: calculation.grossRevenue,
            directCost: calculation.directCost,
            grossProfit: calculation.grossProfit,
            grossMarginPercent: calculation.grossMarginPercent,
            calculatedAt: now,
            lockedAt: now,
            metadata: calculationMetadata(calculation, { recognizedAt: recognizedAt.toISOString(), locationId: context.locationId }),
          },
        });

    const categories = await ensurePostingCategoryMap(tx);
    const common = {
      status: "POSTED" as const,
      currency: calculation.currency,
      recognizedAt,
      costCenterId: context.costCenter?.id ?? null,
      workOrderId,
      clientId: context.workOrder.clientId,
      vehicleId: context.workOrder.vehicleId,
      locationId: context.locationId,
      sourceEntity: SOURCE_FINALIZATION,
      postedAt: now,
      createdById: null,
      metadata: calculationMetadata(calculation, { snapshotId: snapshot.id }),
    };

    for (const allocation of allocateNetRevenue(calculation)) {
      const category = categories[allocation.code];
      await ensureEvent(tx, `${workOrderId}:revenue:${allocation.code}`, {
        ...common,
        pnlSection: "REVENUE",
        amount: allocation.amount,
        categoryId: category.id,
        sourceEntityId: `${workOrderId}:revenue:${allocation.code}`,
        description: `${allocation.label} · WorkOrder ${workOrderId}`,
      });
    }

    const costLines = [
      ["COGS_PARTS", "Собівартість запчастин", calculation.partsCost],
      ["COGS_LABOR", "Пряма вартість праці", calculation.laborCost],
      ["COGS_EXTERNAL", "Сторонні роботи", calculation.externalCost],
      ["COGS_CONSUMABLES", "Витратні матеріали", calculation.consumablesCost],
      ["COGS_OTHER", "Інші прямі витрати", calculation.otherDirectCost],
    ] as const;

    for (const [code, label, amount] of costLines) {
      if (!amount.greaterThan(0)) continue;
      const category = categories[code];
      await ensureEvent(tx, `${workOrderId}:cogs:${code}`, {
        ...common,
        pnlSection: "COGS",
        amount,
        categoryId: category.id,
        sourceEntityId: `${workOrderId}:cogs:${code}`,
        description: `${label} · WorkOrder ${workOrderId}`,
      });
    }

    const receivable = await ensureReceivable(tx, workOrderId, calculation, context, recognizedAt, dueAt);

    if (!existingActual?.lockedAt) {
      await tx.auditEvent.create({
        data: {
          actorName,
          entityType: "WorkOrder",
          entityId: workOrderId,
          action: "FINANCE_ACTUAL_FINALIZED",
          before: existingActual ? jsonSafe(existingActual) : undefined,
          after: jsonSafe(snapshot),
          metadata: calculationMetadata(calculation, {
            recognizedAt: recognizedAt.toISOString(),
            receivableId: receivable?.id ?? null,
            locationId: context.locationId,
          }),
        },
      });
    }

    return { workOrder: context.workOrder, snapshot, receivable, calculation, reused: Boolean(existingActual?.lockedAt) };
  });
}

export type WorkOrderPaymentInput = {
  amount?: unknown;
  moneyAccountId?: unknown;
  occurredAt?: unknown;
  idempotencyKey?: unknown;
};

function paymentAmount(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new WorkOrderFinanceError("INVALID_PAYMENT_AMOUNT", "Payment amount is required");
  }
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(String(value)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  } catch {
    throw new WorkOrderFinanceError("INVALID_PAYMENT_AMOUNT", "Payment amount is invalid");
  }
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw new WorkOrderFinanceError("INVALID_PAYMENT_AMOUNT", "Payment amount must be greater than zero");
  }
  return amount;
}

export async function recordWorkOrderPayment(
  workOrderId: string,
  input: WorkOrderPaymentInput,
  actorName = "CRM / Каса",
) {
  const amount = paymentAmount(input.amount);
  const moneyAccountId = typeof input.moneyAccountId === "string" ? input.moneyAccountId.trim() : "";
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  const occurredAt = parseOptionalDate(input.occurredAt, "occurredAt") ?? new Date();

  if (!moneyAccountId) throw new WorkOrderFinanceError("MONEY_ACCOUNT_REQUIRED", "Money account is required");
  if (!idempotencyKey || idempotencyKey.length > 64) {
    throw new WorkOrderFinanceError("IDEMPOTENCY_KEY_REQUIRED", "A stable idempotency key up to 64 characters is required");
  }

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`wo-payment:${workOrderId}:${idempotencyKey}`}))`;

    const existingPayment = await tx.cashTransaction.findFirst({
      where: { sourceEntity: SOURCE_PAYMENT, sourceEntityId: idempotencyKey, workOrderId },
    });
    if (existingPayment) {
      const obligation = existingPayment.obligationId
        ? await tx.financialObligation.findUnique({ where: { id: existingPayment.obligationId } })
        : null;
      return { payment: existingPayment, obligation, reused: true };
    }

    const context = await resolveWorkOrderContext(tx, workOrderId);
    const obligation = await tx.financialObligation.findFirst({
      where: {
        workOrderId,
        direction: "RECEIVABLE",
        sourceEntity: SOURCE_FINALIZATION,
        sourceEntityId: `${workOrderId}:receivable`,
        status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!obligation) {
      throw new WorkOrderFinanceError("RECEIVABLE_NOT_FOUND", "Finalize WorkOrder finance before registering payment");
    }

    const outstanding = toDecimal(obligation.amount).minus(toDecimal(obligation.settledAmount));
    if (amount.greaterThan(outstanding)) {
      throw new WorkOrderFinanceError("PAYMENT_EXCEEDS_OUTSTANDING", "Payment exceeds outstanding receivable");
    }

    const account = await tx.moneyAccount.findUnique({ where: { id: moneyAccountId } });
    if (!account || !account.isActive) {
      throw new WorkOrderFinanceError("MONEY_ACCOUNT_NOT_FOUND", "Active money account not found");
    }
    if (account.currency !== obligation.currency) {
      throw new WorkOrderFinanceError("CURRENCY_MISMATCH", "Payment account currency does not match receivable currency");
    }

    const category = await ensureCategory(tx, "CUSTOMER_PAYMENT", "Оплата клієнта", null, "OPERATING", 60);
    const payment = await tx.cashTransaction.create({
      data: {
        kind: "INFLOW",
        status: "POSTED",
        flowSection: "OPERATING",
        amount,
        currency: obligation.currency,
        occurredAt,
        toAccountId: account.id,
        categoryId: category.id,
        costCenterId: obligation.costCenterId,
        obligationId: obligation.id,
        workOrderId,
        clientId: context.workOrder.clientId,
        locationId: obligation.locationId ?? context.locationId,
        sourceEntity: SOURCE_PAYMENT,
        sourceEntityId: idempotencyKey,
        description: `Оплата клієнта · WorkOrder ${workOrderId}`,
        metadata: jsonSafe({ idempotencyKey, outstandingBefore: outstanding.toFixed(2) }),
        postedAt: occurredAt,
      },
    });

    const nextSettled = toDecimal(obligation.settledAmount).plus(amount);
    const fullyPaid = nextSettled.equals(toDecimal(obligation.amount));
    const updatedObligation = await tx.financialObligation.update({
      where: { id: obligation.id },
      data: {
        settledAmount: nextSettled,
        status: fullyPaid ? "PAID" : "PARTIALLY_PAID",
        settledAt: fullyPaid ? occurredAt : null,
      },
    });

    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: "PAYMENT_POSTED",
        before: jsonSafe(obligation),
        after: jsonSafe(updatedObligation),
        metadata: jsonSafe({ paymentId: payment.id, moneyAccountId: account.id, amount: amount.toFixed(2), idempotencyKey }),
      },
    });

    return { payment, obligation: updatedObligation, reused: false };
  });
}

export async function getWorkOrderFinance(workOrderId: string) {
  const prisma = getPrisma();
  const workOrder = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: { client: true, vehicle: true, diagnosticRequest: true },
  });
  if (!workOrder) throw new WorkOrderFinanceError("WORK_ORDER_NOT_FOUND", "WorkOrder not found");

  const [snapshots, events, obligations, payments] = await Promise.all([
    prisma.workOrderFinanceSnapshot.findMany({ where: { workOrderId }, orderBy: { kind: "asc" } }),
    prisma.financialEvent.findMany({
      where: { workOrderId, sourceEntity: SOURCE_FINALIZATION },
      orderBy: [{ recognizedAt: "asc" }, { createdAt: "asc" }],
      include: { category: { select: { code: true, name: true } } },
    }),
    prisma.financialObligation.findMany({ where: { workOrderId }, orderBy: { createdAt: "asc" } }),
    prisma.cashTransaction.findMany({
      where: { workOrderId, sourceEntity: SOURCE_PAYMENT },
      orderBy: { occurredAt: "asc" },
      include: { toAccount: { select: { id: true, name: true, type: true } } },
    }),
  ]);

  const receivable = obligations.find((item) => item.direction === "RECEIVABLE" && item.status !== "CANCELLED") ?? null;
  const outstanding = receivable
    ? toDecimal(receivable.amount).minus(toDecimal(receivable.settledAmount))
    : new Prisma.Decimal(0);

  return {
    workOrder,
    snapshots,
    events,
    obligations,
    payments,
    summary: {
      receivable: receivable ? decimalJson(toDecimal(receivable.amount)) : null,
      paid: receivable ? decimalJson(toDecimal(receivable.settledAmount)) : "0.00",
      outstanding: decimalJson(outstanding),
      fullyPaid: Boolean(receivable && outstanding.isZero()),
      actualFinalized: snapshots.some((item) => item.kind === "ACTUAL" && Boolean(item.lockedAt)),
    },
  };
}