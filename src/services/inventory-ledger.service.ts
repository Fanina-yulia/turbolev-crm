import "server-only";

import {
  InventoryLedgerDirection as PrismaInventoryLedgerDirection,
  InventoryLedgerReason as PrismaInventoryLedgerReason,
  InventoryReservationStatus as PrismaInventoryReservationStatus,
  Prisma,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";

export const INVENTORY_DIRECTIONS = ["IN", "OUT"] as const;
export type InventoryDirection = (typeof INVENTORY_DIRECTIONS)[number];

export const INVENTORY_REASONS = [
  "RECEIPT",
  "ISSUE",
  "RETURN",
  "ADJUSTMENT",
  "TRANSFER",
  "RESERVATION_CONSUME",
] as const;
export type InventoryReason = (typeof INVENTORY_REASONS)[number];

export const INVENTORY_RESERVATION_STATUSES = ["ACTIVE", "RELEASED", "CONSUMED", "CANCELLED"] as const;
export type InventoryReservationStatus = (typeof INVENTORY_RESERVATION_STATUSES)[number];

type CommonStockInput = {
  warehouseKey?: string | null;
  serviceLocationId?: string | null;
  stockKey: string;
  productId?: string | null;
  article?: string | null;
  brand?: string | null;
  description?: string | null;
  unit?: string | null;
  currency?: string | null;
};

export type PostInventoryMovementInput = CommonStockInput & {
  direction: InventoryDirection;
  reason: InventoryReason;
  quantity: string | number;
  unitCost?: string | number | null;
  referenceType?: string | null;
  referenceId?: string | null;
  workOrderId?: string | null;
  workOrderLineId?: string | null;
  supplierOrderId?: string | null;
  supplierId?: string | null;
  reasonNote?: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
  idempotencyKey?: string | null;
  allowNegative?: boolean;
  occurredAt?: Date;
  metadata?: unknown;
};

function clean(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function decimal(value: unknown, code: string) {
  try {
    const result = new Prisma.Decimal(String(value));
    if (!result.isFinite() || result.lte(0)) throw new Error(code);
    return result;
  } catch {
    throw new Error(code);
  }
}

function parseEnum<T extends readonly string[]>(value: unknown, values: T) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (values as readonly string[]).includes(normalized) ? normalized as T[number] : null;
}

export function parseInventoryDirection(value: unknown): InventoryDirection | null {
  return parseEnum(value, INVENTORY_DIRECTIONS);
}

export function parseInventoryReason(value: unknown): InventoryReason | null {
  return parseEnum(value, INVENTORY_REASONS);
}

export function parseInventoryReservationStatus(value: unknown): InventoryReservationStatus | null {
  return parseEnum(value, INVENTORY_RESERVATION_STATUSES);
}

function stockValues(input: CommonStockInput) {
  const warehouseKey = clean(input.warehouseKey, 64) || "MAIN";
  const stockKey = clean(input.stockKey, 180);
  if (!stockKey) throw new Error("INVENTORY_STOCK_KEY_REQUIRED");
  return {
    warehouseKey,
    serviceLocationId: clean(input.serviceLocationId, 64),
    stockKey,
    productId: clean(input.productId, 64),
    article: clean(input.article, 120),
    brand: clean(input.brand, 120),
    description: clean(input.description, 320),
    unit: clean(input.unit, 32) || "шт",
    currency: (clean(input.currency, 3) || "UAH").toUpperCase(),
  };
}

async function lockStock(tx: Prisma.TransactionClient, warehouseKey: string, stockKey: string) {
  await tx.$queryRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    "inventory:" + warehouseKey + ":" + stockKey,
  );
}

async function getBalanceTx(tx: Prisma.TransactionClient, input: CommonStockInput) {
  const values = stockValues(input);
  return tx.inventoryBalance.upsert({
    where: { warehouseKey_stockKey: { warehouseKey: values.warehouseKey, stockKey: values.stockKey } },
    create: {
      ...values,
      onHand: new Prisma.Decimal(0),
      reserved: new Prisma.Decimal(0),
    },
    update: {},
  });
}

function movementReason(value: InventoryReason) {
  return value as PrismaInventoryLedgerReason;
}

function movementDirection(value: InventoryDirection) {
  return value as PrismaInventoryLedgerDirection;
}

async function postMovementTx(
  tx: Prisma.TransactionClient,
  input: PostInventoryMovementInput,
) {
  const direction = parseInventoryDirection(input.direction);
  const reason = parseInventoryReason(input.reason);
  if (!direction || !reason) throw new Error("INVENTORY_MOVEMENT_ENUM_INVALID");
  const values = stockValues(input);
  const quantity = decimal(input.quantity, "INVENTORY_QUANTITY_INVALID");
  const unitCost = input.unitCost == null || input.unitCost === ""
    ? null
    : decimal(input.unitCost, "INVENTORY_UNIT_COST_INVALID");
  const actorUserId = clean(input.actorUserId, 64);
  const actorName = clean(input.actorName, 160);
  const idempotencyKey = clean(input.idempotencyKey, 160);

  await lockStock(tx, values.warehouseKey, values.stockKey);
  if (idempotencyKey) {
    const replay = await tx.inventoryLedgerEntry.findUnique({ where: { idempotencyKey } });
    if (replay) {
      const balance = await tx.inventoryBalance.findUnique({
        where: { warehouseKey_stockKey: { warehouseKey: values.warehouseKey, stockKey: values.stockKey } },
      });
      return { entry: replay, balance, changed: false as const, replayed: true as const };
    }
  }

  const balance = await getBalanceTx(tx, input);
  const available = balance.onHand.minus(balance.reserved);
  const nextOnHand = direction === "IN"
    ? balance.onHand.plus(quantity)
    : balance.onHand.minus(quantity);
  if (direction === "OUT" && !input.allowNegative && (nextOnHand.isNegative() || available.lt(quantity))) {
    throw new Error("INVENTORY_INSUFFICIENT");
  }

  const entry = await tx.inventoryLedgerEntry.create({
    data: {
      ...values,
      direction: movementDirection(direction),
      reason: movementReason(reason),
      quantity,
      unitCost,
      balanceAfter: nextOnHand,
      referenceType: clean(input.referenceType, 48),
      referenceId: clean(input.referenceId, 96),
      workOrderId: clean(input.workOrderId, 64),
      workOrderLineId: clean(input.workOrderLineId, 64),
      supplierOrderId: clean(input.supplierOrderId, 64),
      supplierId: clean(input.supplierId, 64),
      reasonNote: clean(input.reasonNote, 4000),
      actorUserId,
      actorName,
      idempotencyKey,
      occurredAt: input.occurredAt || new Date(),
      metadata: input.metadata === undefined ? undefined : toPrismaJson(input.metadata),
    },
  });
  const updatedBalance = await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: { onHand: nextOnHand, updatedAt: new Date() },
  });
  await tx.auditEvent.create({
    data: {
      actorId: actorUserId,
      actorName,
      entityType: "InventoryLedgerEntry",
      entityId: entry.id,
      action: "INVENTORY_MOVEMENT_POSTED",
      after: toPrismaJson(entry),
      metadata: toPrismaJson({
        warehouseKey: values.warehouseKey,
        stockKey: values.stockKey,
        direction,
        reason,
        balanceAfter: nextOnHand.toString(),
      }),
    },
  });
  return { entry, balance: updatedBalance, changed: true as const, replayed: false as const };
}

export async function postInventoryMovement(input: PostInventoryMovementInput) {
  return getPrisma().$transaction((tx) => postMovementTx(tx, input));
}

export type ReserveInventoryInput = CommonStockInput & {
  quantity: string | number;
  workOrderId?: string | null;
  workOrderLineId?: string | null;
  sourceType: string;
  sourceId: string;
  actorUserId?: string | null;
  actorName?: string | null;
  idempotencyKey?: string | null;
  metadata?: unknown;
};

export async function reserveInventory(input: ReserveInventoryInput) {
  const values = stockValues(input);
  const quantity = decimal(input.quantity, "INVENTORY_QUANTITY_INVALID");
  const sourceType = clean(input.sourceType, 40);
  const sourceId = clean(input.sourceId, 96);
  if (!sourceType || !sourceId) throw new Error("INVENTORY_RESERVATION_SOURCE_REQUIRED");
  const actorUserId = clean(input.actorUserId, 64);
  const actorName = clean(input.actorName, 160);
  const idempotencyKey = clean(input.idempotencyKey, 160);

  return getPrisma().$transaction(async (tx) => {
    await lockStock(tx, values.warehouseKey, values.stockKey);
    if (idempotencyKey) {
      const replay = await tx.inventoryReservation.findUnique({ where: { idempotencyKey } });
      if (replay) return { reservation: replay, balance: await getBalanceTx(tx, input), changed: false as const, replayed: true as const };
    }
    const balance = await getBalanceTx(tx, input);
    const active = input.workOrderLineId
      ? await tx.inventoryReservation.findFirst({
          where: {
            workOrderLineId: clean(input.workOrderLineId, 64),
            warehouseKey: values.warehouseKey,
            stockKey: values.stockKey,
            status: PrismaInventoryReservationStatus.ACTIVE,
          },
          orderBy: { createdAt: "desc" },
        })
      : null;
    const previousQuantity = active?.quantity || new Prisma.Decimal(0);
    const delta = quantity.minus(previousQuantity);
    const available = balance.onHand.minus(balance.reserved);
    if (delta.gt(0) && available.lt(delta)) throw new Error("INVENTORY_INSUFFICIENT");

    const reservation = active
      ? await tx.inventoryReservation.update({
          where: { id: active.id },
          data: {
            quantity,
            serviceLocationId: values.serviceLocationId,
            productId: values.productId,
            article: values.article,
            brand: values.brand,
            actorUserId,
            actorName,
            metadata: input.metadata === undefined ? undefined : toPrismaJson(input.metadata),
            updatedAt: new Date(),
          },
        })
      : await tx.inventoryReservation.create({
          data: {
            ...values,
            quantity,
            workOrderId: clean(input.workOrderId, 64),
            workOrderLineId: clean(input.workOrderLineId, 64),
            sourceType,
            sourceId,
            actorUserId,
            actorName,
            idempotencyKey,
            metadata: input.metadata === undefined ? undefined : toPrismaJson(input.metadata),
          },
        });
    const updatedBalance = delta.isZero()
      ? balance
      : await tx.inventoryBalance.update({
          where: { id: balance.id },
          data: { reserved: balance.reserved.plus(delta), updatedAt: new Date() },
        });
    if (!delta.isZero()) {
      await tx.auditEvent.create({
        data: {
          actorId: actorUserId,
          actorName,
          entityType: "InventoryReservation",
          entityId: reservation.id,
          action: active ? "INVENTORY_RESERVATION_UPDATED" : "INVENTORY_RESERVED",
          before: active ? toPrismaJson(active) : undefined,
          after: toPrismaJson(reservation),
          metadata: toPrismaJson({ delta: delta.toString(), stockKey: values.stockKey, warehouseKey: values.warehouseKey }),
        },
      });
    }
    return { reservation, balance: updatedBalance, changed: !delta.isZero() as boolean, replayed: false as const };
  });
}

export type InventoryReservationAction = "RELEASE" | "CONSUME" | "CANCEL";

export async function transitionInventoryReservation(input: {
  id: string;
  action: InventoryReservationAction;
  actorUserId?: string | null;
  actorName?: string | null;
  reasonNote?: string | null;
}) {
  const action = input.action.trim().toUpperCase() as InventoryReservationAction;
  if (!["RELEASE", "CONSUME", "CANCEL"].includes(action)) throw new Error("INVENTORY_RESERVATION_ACTION_INVALID");
  const actorUserId = clean(input.actorUserId, 64);
  const actorName = clean(input.actorName, 160);
  return getPrisma().$transaction(async (tx) => {
    const current = await tx.inventoryReservation.findUnique({ where: { id: input.id } });
    if (!current) throw new Error("INVENTORY_RESERVATION_NOT_FOUND");
    await lockStock(tx, current.warehouseKey, current.stockKey);
    if (current.status !== PrismaInventoryReservationStatus.ACTIVE) {
      throw new Error("INVENTORY_RESERVATION_NOT_ACTIVE");
    }
    const balance = await tx.inventoryBalance.findUnique({
      where: { warehouseKey_stockKey: { warehouseKey: current.warehouseKey, stockKey: current.stockKey } },
    });
    if (!balance) throw new Error("INVENTORY_BALANCE_NOT_FOUND");
    const now = new Date();
    if (action === "CONSUME") {
      if (balance.onHand.lt(current.quantity)) throw new Error("INVENTORY_INSUFFICIENT");
      const nextOnHand = balance.onHand.minus(current.quantity);
      const nextReserved = balance.reserved.minus(current.quantity);
      const entry = await tx.inventoryLedgerEntry.create({
        data: {
          warehouseKey: current.warehouseKey,
          serviceLocationId: current.serviceLocationId,
          stockKey: current.stockKey,
          productId: current.productId,
          article: current.article,
          brand: current.brand,
          direction: PrismaInventoryLedgerDirection.OUT,
          reason: PrismaInventoryLedgerReason.RESERVATION_CONSUME,
          quantity: current.quantity,
          balanceAfter: nextOnHand,
          referenceType: "INVENTORY_RESERVATION",
          referenceId: current.id,
          workOrderId: current.workOrderId,
          workOrderLineId: current.workOrderLineId,
          actorUserId,
          actorName,
          reasonNote: clean(input.reasonNote, 4000),
          occurredAt: now,
        },
      });
      await tx.inventoryBalance.update({
        where: { id: balance.id },
        data: { onHand: nextOnHand, reserved: nextReserved, updatedAt: now },
      });
      const reservation = await tx.inventoryReservation.update({
        where: { id: current.id },
        data: { status: PrismaInventoryReservationStatus.CONSUMED, consumedAt: now, actorUserId, actorName, updatedAt: now },
      });
      await tx.auditEvent.create({
        data: {
          actorId: actorUserId,
          actorName,
          entityType: "InventoryReservation",
          entityId: current.id,
          action: "INVENTORY_RESERVATION_CONSUMED",
          before: toPrismaJson(current),
          after: toPrismaJson(reservation),
          metadata: toPrismaJson({ ledgerEntryId: entry.id }),
        },
      });
      return { reservation, ledgerEntry: entry, balance: await tx.inventoryBalance.findUnique({ where: { id: balance.id } }) };
    }
    const nextStatus = action === "RELEASE"
      ? PrismaInventoryReservationStatus.RELEASED
      : PrismaInventoryReservationStatus.CANCELLED;
    const reservation = await tx.inventoryReservation.update({
      where: { id: current.id },
      data: { status: nextStatus, releasedAt: now, actorUserId, actorName, updatedAt: now },
    });
    await tx.inventoryBalance.update({
      where: { id: balance.id },
      data: { reserved: balance.reserved.minus(current.quantity), updatedAt: now },
    });
    await tx.auditEvent.create({
      data: {
        actorId: actorUserId,
        actorName,
        entityType: "InventoryReservation",
        entityId: current.id,
        action: action === "RELEASE" ? "INVENTORY_RESERVATION_RELEASED" : "INVENTORY_RESERVATION_CANCELLED",
        before: toPrismaJson(current),
        after: toPrismaJson(reservation),
      },
    });
    return { reservation, ledgerEntry: null, balance: await tx.inventoryBalance.findUnique({ where: { id: balance.id } }) };
  });
}

export async function listInventoryLedger(input: {
  warehouseKey?: string | null;
  serviceLocationId?: string | null;
  stockKey?: string | null;
  workOrderId?: string | null;
  workOrderLineId?: string | null;
  limit?: number;
} = {}) {
  const warehouseKey = clean(input.warehouseKey, 64);
  const serviceLocationId = clean(input.serviceLocationId, 64);
  const stockKey = clean(input.stockKey, 180);
  const where = {
    ...(warehouseKey ? { warehouseKey } : {}),
    ...(serviceLocationId ? { serviceLocationId } : {}),
    ...(stockKey ? { stockKey } : {}),
    ...(input.workOrderId ? { workOrderId: input.workOrderId } : {}),
    ...(input.workOrderLineId ? { workOrderLineId: input.workOrderLineId } : {}),
  };
  const take = Math.min(Math.max(Math.trunc(input.limit || 100), 1), 500);
  const prisma = getPrisma();
  const [entries, balances, reservations] = await Promise.all([
    prisma.inventoryLedgerEntry.findMany({ where, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }], take }),
    prisma.inventoryBalance.findMany({ where: { ...(warehouseKey ? { warehouseKey } : {}), ...(serviceLocationId ? { serviceLocationId } : {}), ...(stockKey ? { stockKey } : {}) }, orderBy: [{ updatedAt: "desc" }], take }),
    prisma.inventoryReservation.findMany({ where: { ...(warehouseKey ? { warehouseKey } : {}), ...(serviceLocationId ? { serviceLocationId } : {}), ...(stockKey ? { stockKey } : {}), ...(input.workOrderId ? { workOrderId: input.workOrderId } : {}), ...(input.workOrderLineId ? { workOrderLineId: input.workOrderLineId } : {}) }, orderBy: [{ updatedAt: "desc" }], take }),
  ]);
  return { entries, balances, reservations };
}

export async function listInventoryReservations(input: {
  warehouseKey?: string | null;
  serviceLocationId?: string | null;
  workOrderId?: string | null;
  workOrderLineId?: string | null;
  status?: InventoryReservationStatus | null;
  limit?: number;
} = {}) {
  const take = Math.min(Math.max(Math.trunc(input.limit || 100), 1), 500);
  return getPrisma().inventoryReservation.findMany({
    where: {
      ...(clean(input.warehouseKey, 64) ? { warehouseKey: clean(input.warehouseKey, 64)! } : {}),
      ...(clean(input.serviceLocationId, 64) ? { serviceLocationId: clean(input.serviceLocationId, 64)! } : {}),
      ...(input.workOrderId ? { workOrderId: input.workOrderId } : {}),
      ...(input.workOrderLineId ? { workOrderLineId: input.workOrderLineId } : {}),
      ...(input.status ? { status: input.status as PrismaInventoryReservationStatus } : {}),
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take,
  });
}
