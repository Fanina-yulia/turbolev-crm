import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

const WALK_IN_SOURCE = "WALK_IN";
const WALK_IN_MARKER = "WALK_IN_DIAGNOSTIC:";
const FINANCE_SOURCE = "WALK_IN_DIAGNOSTIC";
const PAYMENT_SOURCE = "WALK_IN_DIAGNOSTIC_PAYMENT";

export type WalkInPaymentMethod = "CASH" | "TERMINAL" | "ONLINE";

export class WalkInDiagnosticSettlementError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "WalkInDiagnosticSettlementError";
    this.code = code;
    this.status = status;
  }
}

function decimal(value: Prisma.Decimal | string | number | null | undefined) {
  return value == null ? new Prisma.Decimal(0) : new Prisma.Decimal(String(value));
}

async function mechanicContext(userId: string, diagnosticRequestId: string) {
  const prisma = getPrisma();
  const mechanic = await prisma.serviceMechanic.findFirst({
    where: { userId, isActive: true },
    select: { id: true, name: true, locationId: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!mechanic) throw new WalkInDiagnosticSettlementError("MECHANIC_NOT_LINKED", "Профіль механіка не прив’язаний до станції.", 403);

  const assignment = await prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId } });
  if (!assignment || assignment.mechanicId !== mechanic.id) {
    throw new WalkInDiagnosticSettlementError("DIAGNOSTIC_NOT_ASSIGNED", "Ця діагностика не призначена вам.", 403);
  }
  return { mechanic, assignment };
}

async function findWalkInAppointment(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const link = await prisma.diagnosticVisitLink.findUnique({
    where: { diagnosticRequestId },
    select: { appointmentId: true, source: true },
  });

  // The visit link is the canonical relation. The comment lookup remains as a
  // compatibility fallback for walk-ins created before the link was persisted.
  if (link?.source === WALK_IN_SOURCE) {
    const linked = await prisma.serviceAppointment.findFirst({
      where: { id: link.appointmentId, source: WALK_IN_SOURCE, status: { not: "CANCELLED" } },
    });
    if (linked) return linked;
  }

  return prisma.serviceAppointment.findFirst({
    where: {
      source: WALK_IN_SOURCE,
      comment: { contains: `${WALK_IN_MARKER}${diagnosticRequestId}` },
      status: { not: "CANCELLED" },
    },
    orderBy: [{ actualArrivalAt: "desc" }, { createdAt: "desc" }],
  });
}

async function resolveDiagnosticPrice() {
  const prisma = getPrisma();
  const exact = await prisma.serviceCatalogItem.findFirst({
    where: {
      code: "DIAGNOSTIC_BASE",
      itemType: "DIAGNOSTIC",
      isActive: true,
      reviewStatus: "READY",
      basePrice: { not: null },
    },
    orderBy: { updatedAt: "desc" },
  });
  const item = exact ?? await prisma.serviceCatalogItem.findFirst({
    where: {
      itemType: "DIAGNOSTIC",
      isActive: true,
      reviewStatus: "READY",
      basePrice: { not: null },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!item?.basePrice || decimal(item.basePrice).lessThanOrEqualTo(0)) return null;
  return {
    itemId: item.id,
    code: item.code,
    label: item.displayName,
    amount: decimal(item.basePrice),
    currency: item.currency,
  };
}

async function resolveMoneyAccount(locationId: string, method: WalkInPaymentMethod) {
  const accounts = await getPrisma().moneyAccount.findMany({
    where: {
      isActive: true,
      currency: "UAH",
      OR: [{ locationId }, { locationId: null }],
      type: method === "CASH" ? "CASH" : { in: ["ACQUIRING", "CARD", "BANK"] },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const typeRank = method === "CASH"
    ? new Map([["CASH", 0]])
    : new Map([["ACQUIRING", 0], ["CARD", 1], ["BANK", 2]]);
  return [...accounts].sort((a, b) => {
    const locationA = a.locationId === locationId ? 0 : 1;
    const locationB = b.locationId === locationId ? 0 : 1;
    if (locationA !== locationB) return locationA - locationB;
    return (typeRank.get(a.type) ?? 9) - (typeRank.get(b.type) ?? 9) || a.sortOrder - b.sortOrder;
  })[0] || null;
}

async function ensureCategory(
  tx: Prisma.TransactionClient,
  code: string,
  name: string,
  pnlSection: "REVENUE" | null,
  cashFlowSection: "OPERATING" | null,
  sortOrder: number,
) {
  return tx.financialCategory.upsert({
    where: { code },
    update: { name, pnlSection, cashFlowSection, isActive: true },
    create: { code, name, pnlSection, cashFlowSection, isSystem: true, isActive: true, sortOrder },
  });
}

export async function markWalkInDiagnosticCompleted(userId: string, diagnosticRequestId: string) {
  const { mechanic } = await mechanicContext(userId, diagnosticRequestId);
  const prisma = getPrisma();
  const appointment = await findWalkInAppointment(diagnosticRequestId);
  if (!appointment) return { walkIn: false as const };

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`walk-in-complete:${diagnosticRequestId}`}))`;
    const existingAudit = await tx.auditEvent.findFirst({
      where: { entityType: "DiagnosticRequest", entityId: diagnosticRequestId, action: "WALK_IN_DIAGNOSTIC_COMPLETED" },
      select: { id: true },
    });
    await tx.serviceAppointment.updateMany({
      where: { id: appointment.id, source: WALK_IN_SOURCE, status: { in: ["ARRIVED", "DIAGNOSTICS"] } },
      data: { status: "WAITING_PAYMENT" },
    });
    if (!existingAudit) {
      await tx.auditEvent.create({
        data: {
          actorId: userId,
          actorName: mechanic.name,
          entityType: "DiagnosticRequest",
          entityId: diagnosticRequestId,
          action: "WALK_IN_DIAGNOSTIC_COMPLETED",
          metadata: toPrismaJson({ appointmentId: appointment.id, locationId: mechanic.locationId }),
        },
      });
    }
  });
  return { walkIn: true as const, appointmentId: appointment.id };
}

export async function getWalkInDiagnosticSettlement(userId: string, diagnosticRequestId: string) {
  const { mechanic } = await mechanicContext(userId, diagnosticRequestId);
  const prisma = getPrisma();
  const appointment = await findWalkInAppointment(diagnosticRequestId);
  if (!appointment) return { walkIn: false as const };

  const [diagnostic, review, payment, obligation, price] = await Promise.all([
    prisma.diagnosticRequest.findUnique({
      where: { id: diagnosticRequestId },
      include: {
        client: { select: { id: true, name: true, phone: true } },
        vehicle: { select: { id: true, plateNumber: true, brand: true, model: true, year: true, mileageKm: true } },
      },
    }),
    prisma.diagnosticReview.findUnique({ where: { diagnosticRequestId } }),
    prisma.cashTransaction.findFirst({
      where: { sourceEntity: PAYMENT_SOURCE, sourceEntityId: `${diagnosticRequestId}:payment`, status: "POSTED" },
      include: { toAccount: { select: { id: true, name: true, type: true } } },
    }),
    prisma.financialObligation.findFirst({
      where: { sourceEntity: FINANCE_SOURCE, sourceEntityId: `${diagnosticRequestId}:receivable`, direction: "RECEIVABLE", status: { not: "CANCELLED" } },
    }),
    resolveDiagnosticPrice(),
  ]);
  if (!diagnostic) throw new WalkInDiagnosticSettlementError("DIAGNOSTIC_NOT_FOUND", "Діагностику не знайдено.", 404);

  const submitted = review?.state === "SUBMITTED" || review?.state === "CONFIRMED";
  const paid = Boolean(payment) || obligation?.status === "PAID";
  const amount = obligation ? decimal(obligation.amount) : price?.amount ?? null;
  const currency = obligation?.currency || price?.currency || "UAH";

  return {
    walkIn: true as const,
    diagnosticId: diagnosticRequestId,
    appointmentId: appointment.id,
    appointmentStatus: appointment.status,
    submitted,
    paid,
    completed: appointment.status === "COMPLETED",
    sentToRepair: appointment.status === "WAITING_CALCULATION",
    price: amount ? {
      amount: amount.toFixed(2),
      currency,
      label: price?.label || "Позапланова діагностика",
      configured: Boolean(price || obligation),
    } : null,
    payment: payment ? {
      id: payment.id,
      amount: decimal(payment.amount).toFixed(2),
      occurredAt: payment.occurredAt,
      account: payment.toAccount,
    } : null,
    vehicle: diagnostic.vehicle,
    client: diagnostic.client,
    mechanic: { id: mechanic.id, name: mechanic.name },
    // The mechanic enters the final amount in the cabinet. A configured price
    // is only a suggested default and is not a prerequisite for a walk-in.
    canPay: submitted && !paid,
    canChooseRoute: submitted && paid && appointment.status === "WAITING_PAYMENT",
  };
}

export async function payWalkInDiagnostic(
  userId: string,
  diagnosticRequestId: string,
  method: WalkInPaymentMethod,
  amountInput?: unknown,
) {
  if (method !== "CASH" && method !== "TERMINAL" && method !== "ONLINE") {
    throw new WalkInDiagnosticSettlementError("PAYMENT_METHOD_REQUIRED", "Оберіть готівку або термінал.");
  }
  const { mechanic } = await mechanicContext(userId, diagnosticRequestId);
  const prisma = getPrisma();
  const appointment = await findWalkInAppointment(diagnosticRequestId);
  if (!appointment) throw new WalkInDiagnosticSettlementError("NOT_WALK_IN", "Це не позаплановий заїзд.", 404);

  const [diagnostic, review, price] = await Promise.all([
    prisma.diagnosticRequest.findUnique({ where: { id: diagnosticRequestId }, include: { client: true, vehicle: true } }),
    prisma.diagnosticReview.findUnique({ where: { diagnosticRequestId } }),
    resolveDiagnosticPrice(),
  ]);
  if (!diagnostic) throw new WalkInDiagnosticSettlementError("DIAGNOSTIC_NOT_FOUND", "Діагностику не знайдено.", 404);
  if (review?.state !== "SUBMITTED" && review?.state !== "CONFIRMED") {
    throw new WalkInDiagnosticSettlementError("DIAGNOSTIC_NOT_COMPLETED", "Спочатку завершіть діагностику.", 409);
  }
  const enteredAmount = typeof amountInput === "number"
    ? amountInput
    : typeof amountInput === "string" && amountInput.trim()
      ? Number(amountInput.replace(",", "."))
      : null;
  const amount = enteredAmount == null
    ? price?.amount ?? null
    : Number.isFinite(enteredAmount) && enteredAmount > 0
      ? new Prisma.Decimal(enteredAmount.toFixed(2))
      : null;
  if (!amount || amount.lessThanOrEqualTo(0)) {
    throw new WalkInDiagnosticSettlementError("DIAGNOSTIC_AMOUNT_REQUIRED", "Введіть суму оплати більше 0 грн.", 409);
  }
  const currency = price?.currency || "UAH";
  if (currency !== "UAH") {
    throw new WalkInDiagnosticSettlementError("DIAGNOSTIC_CURRENCY_UNSUPPORTED", "Оплата позапланової діагностики зараз підтримує прайс у гривні.", 409);
  }
  const account = await resolveMoneyAccount(mechanic.locationId, method);
  if (!account) {
    throw new WalkInDiagnosticSettlementError(
      "MONEY_ACCOUNT_NOT_CONFIGURED",
      method === "CASH" ? "Не налаштована активна каса для цієї станції." : "Не налаштований активний рахунок для термінала.",
      409,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`walk-in-payment:${diagnosticRequestId}`}))`;

    const existingPayment = await tx.cashTransaction.findFirst({
      where: { sourceEntity: PAYMENT_SOURCE, sourceEntityId: `${diagnosticRequestId}:payment`, status: "POSTED" },
    });
    if (existingPayment) return;

    const revenueCategory = await ensureCategory(tx, "REV_DIAGNOSTIC", "Діагностика", "REVENUE", "OPERATING", 15);
    const paymentCategory = await ensureCategory(tx, "CUSTOMER_PAYMENT", "Оплата клієнта", null, "OPERATING", 60);
    const costCenter = await tx.costCenter.findFirst({
      where: { isActive: true, OR: [{ locationId: mechanic.locationId }, { code: "STO_GLEVAKHA" }] },
      orderBy: [{ locationId: "desc" }, { sortOrder: "asc" }],
    });
    const now = new Date();

    let event = await tx.financialEvent.findFirst({
      where: { sourceEntity: FINANCE_SOURCE, sourceEntityId: `${diagnosticRequestId}:revenue` },
    });
    if (!event) {
      event = await tx.financialEvent.create({
        data: {
          status: "POSTED",
          pnlSection: "REVENUE",
          amount,
          currency,
          recognizedAt: now,
          categoryId: revenueCategory.id,
          costCenterId: costCenter?.id || null,
          clientId: diagnostic.clientId,
          vehicleId: diagnostic.vehicleId,
          locationId: mechanic.locationId,
          sourceEntity: FINANCE_SOURCE,
          sourceEntityId: `${diagnosticRequestId}:revenue`,
          description: `Позапланова діагностика · ${diagnostic.vehicle.plateNumber || diagnosticRequestId}`,
          metadata: toPrismaJson({ diagnosticRequestId, appointmentId: appointment.id, serviceCatalogItemId: price?.itemId || null, amountEntered: enteredAmount != null }),
          createdById: userId,
          postedAt: now,
        },
      });
    }

    let obligation = await tx.financialObligation.findFirst({
      where: { sourceEntity: FINANCE_SOURCE, sourceEntityId: `${diagnosticRequestId}:receivable`, direction: "RECEIVABLE" },
    });
    if (!obligation) {
      obligation = await tx.financialObligation.create({
        data: {
          direction: "RECEIVABLE",
          status: "OPEN",
          amount,
          settledAmount: 0,
          currency,
          issuedAt: now,
          dueAt: now,
          categoryId: revenueCategory.id,
          costCenterId: costCenter?.id || null,
          sourceEventId: event.id,
          clientId: diagnostic.clientId,
          locationId: mechanic.locationId,
          counterpartyName: diagnostic.client.name,
          sourceEntity: FINANCE_SOURCE,
          sourceEntityId: `${diagnosticRequestId}:receivable`,
          description: `До оплати за позапланову діагностику ${diagnostic.vehicle.plateNumber || "авто"}`,
          metadata: toPrismaJson({ diagnosticRequestId, appointmentId: appointment.id, serviceCatalogItemId: price?.itemId || null, amountEntered: enteredAmount != null }),
        },
      });
    }
    if (!decimal(obligation.amount).equals(amount)) {
      throw new WalkInDiagnosticSettlementError("AMOUNT_CONFLICT", "Сума діагностики вже зафіксована. Перевірте оплату або зверніться до сервіс-менеджера.", 409);
    }

    const payment = await tx.cashTransaction.create({
      data: {
        kind: "INFLOW",
        status: "POSTED",
        flowSection: "OPERATING",
        amount,
        currency,
        occurredAt: now,
        toAccountId: account.id,
        categoryId: paymentCategory.id,
        costCenterId: costCenter?.id || null,
        obligationId: obligation.id,
        clientId: diagnostic.clientId,
        locationId: mechanic.locationId,
        sourceEntity: PAYMENT_SOURCE,
        sourceEntityId: `${diagnosticRequestId}:payment`,
        description: `Оплата позапланової діагностики · ${diagnostic.vehicle.plateNumber || diagnosticRequestId}`,
        metadata: toPrismaJson({ diagnosticRequestId, appointmentId: appointment.id, paymentMethod: method === "ONLINE" ? "TERMINAL" : method, serviceCatalogItemId: price?.itemId || null }),
        createdById: userId,
        postedAt: now,
      },
    });

    const updatedObligation = await tx.financialObligation.update({
      where: { id: obligation.id },
      data: { settledAmount: amount, status: "PAID", settledAt: now },
    });
    await tx.serviceAppointment.updateMany({
      where: { id: appointment.id, source: WALK_IN_SOURCE, status: { in: ["DIAGNOSTICS", "WAITING_PAYMENT"] } },
      data: { status: "WAITING_PAYMENT" },
    });
    await tx.auditEvent.create({
      data: {
        actorId: userId,
        actorName: mechanic.name,
        entityType: "DiagnosticRequest",
        entityId: diagnosticRequestId,
        action: "WALK_IN_DIAGNOSTIC_PAYMENT_POSTED",
        before: toPrismaJson(obligation),
        after: toPrismaJson(updatedObligation),
        metadata: toPrismaJson({ paymentId: payment.id, appointmentId: appointment.id, amount: amount.toFixed(2), method: method === "ONLINE" ? "TERMINAL" : method, moneyAccountId: account.id }),
      },
    });
  });

  return getWalkInDiagnosticSettlement(userId, diagnosticRequestId);
}

export async function chooseWalkInPostPaymentRoute(
  userId: string,
  diagnosticRequestId: string,
  action: "COMPLETE_VISIT" | "SEND_TO_REPAIR_FLOW",
) {
  const { mechanic } = await mechanicContext(userId, diagnosticRequestId);
  const prisma = getPrisma();
  const appointment = await findWalkInAppointment(diagnosticRequestId);
  if (!appointment) throw new WalkInDiagnosticSettlementError("NOT_WALK_IN", "Це не позаплановий заїзд.", 404);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`walk-in-route:${diagnosticRequestId}`}))`;
    const payment = await tx.cashTransaction.findFirst({
      where: { sourceEntity: PAYMENT_SOURCE, sourceEntityId: `${diagnosticRequestId}:payment`, status: "POSTED" },
    });
    if (!payment) throw new WalkInDiagnosticSettlementError("PAYMENT_REQUIRED", "Спочатку зафіксуйте оплату діагностики.", 409);

    const fresh = await tx.serviceAppointment.findUnique({ where: { id: appointment.id } });
    if (!fresh) throw new WalkInDiagnosticSettlementError("APPOINTMENT_NOT_FOUND", "Позаплановий візит не знайдено.", 404);

    if (action === "COMPLETE_VISIT") {
      if (fresh.status !== "COMPLETED") {
        await tx.serviceAppointment.update({
          where: { id: fresh.id },
          data: { status: "COMPLETED", actualEndAt: new Date() },
        });
        await tx.auditEvent.create({
          data: {
            actorId: userId,
            actorName: mechanic.name,
            entityType: "ServiceAppointment",
            entityId: fresh.id,
            action: "WALK_IN_VISIT_COMPLETED",
            metadata: toPrismaJson({ diagnosticRequestId, paymentId: payment.id }),
          },
        });
      }
    } else if (action === "SEND_TO_REPAIR_FLOW") {
      if (fresh.status !== "WAITING_CALCULATION") {
        await tx.serviceAppointment.update({ where: { id: fresh.id }, data: { status: "WAITING_CALCULATION" } });
        await tx.auditEvent.create({
          data: {
            actorId: userId,
            actorName: mechanic.name,
            entityType: "DiagnosticRequest",
            entityId: diagnosticRequestId,
            action: "WALK_IN_SENT_TO_REPAIR_FLOW",
            metadata: toPrismaJson({ appointmentId: fresh.id, paymentId: payment.id, hardGate: "WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS" }),
          },
        });
      }
    } else {
      throw new WalkInDiagnosticSettlementError("INVALID_ROUTE", "Оберіть наступний маршрут.");
    }

    return { ok: true, action, appointmentId: fresh.id };
  });
}
