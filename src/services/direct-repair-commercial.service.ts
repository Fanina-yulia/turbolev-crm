import {
  DirectRepairPartsMode,
  PartSupplySource,
  Prisma,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { toPrismaJson } from "@/src/lib/prisma-json";
import {
  createWorkOrderLine,
  rebuildPlannedSnapshotFromLines,
  updateWorkOrderLine,
} from "@/src/services/work-order-lines.service";

type Tx = Prisma.TransactionClient;
type Line = Prisma.WorkOrderLineGetPayload<{}>;

const MUTABLE_DIRECT_REPAIR_STATUSES = new Set([
  "PARTS_REVIEW",
  "WAITING_CALCULATION",
  "WAITING_APPROVAL",
  "WAITING_PARTS_SELECTION",
  "WAITING_PARTS",
  "READY_FOR_REPAIR",
]);

export class DirectRepairCommercialError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DirectRepairCommercialError";
    this.code = code;
    this.details = details;
  }
}

function text(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isMode(value: unknown): value is DirectRepairPartsMode {
  return Object.values(DirectRepairPartsMode).includes(value as DirectRepairPartsMode);
}

function isSource(value: unknown): value is PartSupplySource {
  return Object.values(PartSupplySource).includes(value as PartSupplySource);
}

async function ensureDirectRepairTx(tx: Tx, workOrderId: string, mutation = false) {
  const workOrder = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, origin: true, status: true },
  });
  if (!workOrder) throw new DirectRepairCommercialError("WORK_ORDER_NOT_FOUND", "Замовлення-наряд не знайдено.");
  if (workOrder.origin !== "DIRECT_REPAIR") {
    throw new DirectRepairCommercialError("NOT_DIRECT_REPAIR", "Налаштування джерела запчастин доступне лише для прямого ремонту.");
  }
  if (mutation && !MUTABLE_DIRECT_REPAIR_STATUSES.has(workOrder.status)) {
    throw new DirectRepairCommercialError(
      "DIRECT_REPAIR_ALREADY_STARTED",
      "Після початку ремонту джерело запчастин змінюється тільки через додаткові роботи та нове погодження.",
      { status: workOrder.status },
    );
  }
  if (mutation) {
    const actual = await tx.workOrderFinanceSnapshot.findUnique({
      where: { workOrderId_kind: { workOrderId, kind: "ACTUAL" } },
      select: { lockedAt: true },
    });
    if (actual?.lockedAt) {
      throw new DirectRepairCommercialError("ACTUAL_ALREADY_LOCKED", "Фактичні фінанси вже фіналізовані; конфігурацію прямого ремонту змінювати не можна.");
    }
  }
  return workOrder;
}

async function activePartLinesTx(tx: Tx, workOrderId: string) {
  return tx.workOrderLine.findMany({
    where: {
      workOrderId,
      type: "PART",
      status: { in: ["DRAFT", "APPROVED", "IN_PROGRESS", "COMPLETED"] },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function getDirectRepairPartContextTx(
  tx: Tx,
  workOrderId: string,
  providedLines?: readonly Line[],
) {
  const workOrder = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, origin: true, status: true },
  });
  if (!workOrder) throw new DirectRepairCommercialError("WORK_ORDER_NOT_FOUND", "Замовлення-наряд не знайдено.");
  if (workOrder.origin !== "DIRECT_REPAIR") {
    return {
      isDirectRepair: false,
      mode: null as DirectRepairPartsMode | null,
      modeSelected: true,
      sourceByLineId: new Map<string, PartSupplySource | null>(),
      servicePartLineIds: [] as string[],
      customerPartLineIds: [] as string[],
      customerConfirmedLineIds: [] as string[],
      customerPendingLineIds: [] as string[],
      configurationComplete: true,
      blockers: [] as string[],
    };
  }

  const allLines = providedLines ? [...providedLines] : await tx.workOrderLine.findMany({
    where: { workOrderId, status: { in: ["DRAFT", "APPROVED", "IN_PROGRESS", "COMPLETED"] } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const parts = allLines.filter((line) => line.type === "PART");
  const [config, storedSources] = await Promise.all([
    tx.directRepairCommercialConfig.findUnique({ where: { workOrderId } }),
    parts.length
      ? tx.directRepairPartSource.findMany({ where: { workOrderId, workOrderLineId: { in: parts.map((line) => line.id) } } })
      : Promise.resolve([]),
  ]);
  const mode = config?.partsMode ?? null;
  const storedByLine = new Map(storedSources.map((item) => [item.workOrderLineId, item]));
  const sourceByLineId = new Map<string, PartSupplySource | null>();

  for (const line of parts) {
    const stored = storedByLine.get(line.id);
    let source: PartSupplySource | null = stored?.source ?? null;
    if (!source && mode === "SERVICE_SUPPLIED") source = "SERVICE";
    if (!source && mode === "CUSTOMER_SUPPLIED") source = "CUSTOMER";
    if (!source && mode === "MIXED" && (line.supplierQuoteId || line.supplierId || line.supplierOrderId)) source = "SERVICE";
    sourceByLineId.set(line.id, source);
  }

  const servicePartLineIds = parts.filter((line) => sourceByLineId.get(line.id) === "SERVICE").map((line) => line.id);
  const customerPartLineIds = parts.filter((line) => sourceByLineId.get(line.id) === "CUSTOMER").map((line) => line.id);
  const customerConfirmedLineIds = customerPartLineIds.filter((id) => Boolean(storedByLine.get(id)?.customerPartConfirmedAt));
  const customerPendingLineIds = customerPartLineIds.filter((id) => !storedByLine.get(id)?.customerPartConfirmedAt);

  const blockers: string[] = [];
  if (!mode) blockers.push("Оберіть, як забезпечуються запчастини.");
  if (mode === "NO_PARTS" && parts.length) blockers.push("Для режиму «Запчастини не потрібні» скасуйте активні PART-позиції.");
  if (mode === "SERVICE_SUPPLIED" && parts.some((line) => sourceByLineId.get(line.id) !== "SERVICE")) blockers.push("Усі деталі повинні постачатися СТО.");
  if (mode === "CUSTOMER_SUPPLIED" && parts.some((line) => sourceByLineId.get(line.id) !== "CUSTOMER")) blockers.push("Усі деталі повинні бути позначені як запчастини клієнта.");
  if (mode === "MIXED" && parts.some((line) => !sourceByLineId.get(line.id))) blockers.push("Для кожної деталі у змішаному режимі вкажіть: СТО або клієнт.");

  const invalidCustomerPricing = parts.filter((line) => sourceByLineId.get(line.id) === "CUSTOMER" && (!line.plannedUnitPrice.isZero() || !line.plannedUnitCost.isZero()));
  if (invalidCustomerPricing.length) blockers.push("Запчастини клієнта повинні мати нульову продажну ціну та собівартість.");

  return {
    isDirectRepair: true,
    mode,
    modeSelected: Boolean(mode),
    sourceByLineId,
    servicePartLineIds,
    customerPartLineIds,
    customerConfirmedLineIds,
    customerPendingLineIds,
    configurationComplete: blockers.length === 0,
    blockers,
  };
}

export async function getDirectRepairCommercialConfig(workOrderId: string) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await ensureDirectRepairTx(tx, workOrderId, false);
    const lines = await tx.workOrderLine.findMany({
      where: { workOrderId, status: { in: ["DRAFT", "APPROVED", "IN_PROGRESS", "COMPLETED"] } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    const context = await getDirectRepairPartContextTx(tx, workOrderId, lines);
    return {
      isDirectRepair: context.isDirectRepair,
      partsMode: context.mode,
      modeSelected: context.modeSelected,
      configurationComplete: context.configurationComplete,
      blockers: context.blockers,
      servicePartCount: context.servicePartLineIds.length,
      customerPartCount: context.customerPartLineIds.length,
      customerPartConfirmedCount: context.customerConfirmedLineIds.length,
      customerPartPendingCount: context.customerPendingLineIds.length,
      lines: lines.filter((line) => line.type === "PART").map((line) => ({
        id: line.id,
        description: line.description,
        article: line.article,
        brand: line.brand,
        quantity: line.plannedQuantity.toFixed(3),
        source: context.sourceByLineId.get(line.id) ?? null,
        customerPartConfirmed: context.customerConfirmedLineIds.includes(line.id),
      })),
    };
  });
}

export async function setDirectRepairPartsMode(
  workOrderId: string,
  mode: DirectRepairPartsMode,
  actorName = "CRM / Сервіс-менеджер",
) {
  if (!isMode(mode)) throw new DirectRepairCommercialError("INVALID_PARTS_MODE", "Невідомий режим забезпечення запчастинами.");
  const prisma = getPrisma();
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`direct-repair:${workOrderId}`}))`;
    const workOrder = await ensureDirectRepairTx(tx, workOrderId, true);
    const partLines = await activePartLinesTx(tx, workOrderId);
    if (mode === "NO_PARTS" && partLines.length) {
      throw new DirectRepairCommercialError("PART_LINES_EXIST", "У ремонті вже є запчастини. Скасуйте їх перед вибором «Запчастини не потрібні».", { partLineCount: partLines.length });
    }
    const before = await tx.directRepairCommercialConfig.findUnique({ where: { workOrderId } });
    const config = await tx.directRepairCommercialConfig.upsert({
      where: { workOrderId },
      create: { workOrderId, partsMode: mode },
      update: { partsMode: mode },
    });

    if (mode === "SERVICE_SUPPLIED" || mode === "CUSTOMER_SUPPLIED") {
      for (const line of partLines) {
        await tx.directRepairPartSource.upsert({
          where: { workOrderLineId: line.id },
          create: {
            workOrderLineId: line.id,
            workOrderId,
            source: mode === "SERVICE_SUPPLIED" ? "SERVICE" : "CUSTOMER",
          },
          update: {
            source: mode === "SERVICE_SUPPLIED" ? "SERVICE" : "CUSTOMER",
            customerPartConfirmedAt: mode === "SERVICE_SUPPLIED" ? null : undefined,
          },
        });
        if (mode === "CUSTOMER_SUPPLIED") {
          await tx.workOrderLine.update({
            where: { id: line.id },
            data: {
              plannedUnitPrice: new Prisma.Decimal(0),
              plannedUnitCost: new Prisma.Decimal(0),
              supplierId: null,
              supplierQuoteId: null,
              supplierOrderId: null,
            },
          });
        }
      }
    }

    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrder",
        entityId: workOrderId,
        action: "DIRECT_REPAIR_PARTS_MODE_SET",
        before: before ? toPrismaJson(before) : Prisma.JsonNull,
        after: toPrismaJson(config),
        metadata: toPrismaJson({ workOrderStatus: workOrder.status, partLineCount: partLines.length }),
      },
    });
    return config;
  });
  await rebuildPlannedSnapshotFromLines(workOrderId, actorName);
  return result;
}

export async function setDirectRepairPartSource(
  workOrderId: string,
  lineId: string,
  source: PartSupplySource,
  actorName = "CRM / Сервіс-менеджер",
) {
  if (!isSource(source)) throw new DirectRepairCommercialError("INVALID_PART_SOURCE", "Невідоме джерело запчастини.");
  const prisma = getPrisma();
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`direct-repair:${workOrderId}`}))`;
    await ensureDirectRepairTx(tx, workOrderId, true);
    const [config, line, before] = await Promise.all([
      tx.directRepairCommercialConfig.findUnique({ where: { workOrderId } }),
      tx.workOrderLine.findFirst({ where: { id: lineId, workOrderId, type: "PART", status: { not: "CANCELLED" } } }),
      tx.directRepairPartSource.findUnique({ where: { workOrderLineId: lineId } }),
    ]);
    if (!line) throw new DirectRepairCommercialError("PART_LINE_NOT_FOUND", "Запчастину не знайдено у цьому ремонті.");
    if (!config?.partsMode) throw new DirectRepairCommercialError("PARTS_MODE_REQUIRED", "Спочатку оберіть спосіб забезпечення запчастинами.");
    if (config.partsMode === "NO_PARTS") throw new DirectRepairCommercialError("NO_PARTS_MODE", "У режимі «Запчастини не потрібні» PART-позиції заборонені.");
    if (config.partsMode === "SERVICE_SUPPLIED" && source !== "SERVICE") throw new DirectRepairCommercialError("SOURCE_CONFLICT", "Для цього ремонту всі деталі постачає СТО.");
    if (config.partsMode === "CUSTOMER_SUPPLIED" && source !== "CUSTOMER") throw new DirectRepairCommercialError("SOURCE_CONFLICT", "Для цього ремонту всі деталі надає клієнт.");

    const sourceRow = await tx.directRepairPartSource.upsert({
      where: { workOrderLineId: line.id },
      create: { workOrderLineId: line.id, workOrderId, source },
      update: { source, customerPartConfirmedAt: source === "SERVICE" ? null : before?.customerPartConfirmedAt },
    });
    if (source === "CUSTOMER") {
      await tx.workOrderLine.update({
        where: { id: line.id },
        data: {
          plannedUnitPrice: new Prisma.Decimal(0),
          plannedUnitCost: new Prisma.Decimal(0),
          supplierId: null,
          supplierQuoteId: null,
          supplierOrderId: null,
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrderLine",
        entityId: line.id,
        action: "DIRECT_REPAIR_PART_SOURCE_SET",
        before: before ? toPrismaJson(before) : Prisma.JsonNull,
        after: toPrismaJson(sourceRow),
        metadata: toPrismaJson({ workOrderId, mode: config.partsMode }),
      },
    });
    return sourceRow;
  });
  await rebuildPlannedSnapshotFromLines(workOrderId, actorName);
  return result;
}

export async function confirmCustomerPart(
  workOrderId: string,
  lineId: string,
  confirmed: boolean,
  actorName = "CRM / Сервіс-менеджер",
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`direct-repair:${workOrderId}`}))`;
    await ensureDirectRepairTx(tx, workOrderId, true);
    const context = await getDirectRepairPartContextTx(tx, workOrderId);
    if (context.sourceByLineId.get(lineId) !== "CUSTOMER") {
      throw new DirectRepairCommercialError("NOT_CUSTOMER_PART", "Підтверджувати наявність можна лише для запчастини клієнта.");
    }
    const before = await tx.directRepairPartSource.findUnique({ where: { workOrderLineId: lineId } });
    const after = await tx.directRepairPartSource.upsert({
      where: { workOrderLineId: lineId },
      create: {
        workOrderLineId: lineId,
        workOrderId,
        source: "CUSTOMER",
        customerPartConfirmedAt: confirmed ? new Date() : null,
      },
      update: { source: "CUSTOMER", customerPartConfirmedAt: confirmed ? new Date() : null },
    });
    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrderLine",
        entityId: lineId,
        action: confirmed ? "CUSTOMER_PART_CONFIRMED" : "CUSTOMER_PART_UNCONFIRMED",
        before: before ? toPrismaJson(before) : Prisma.JsonNull,
        after: toPrismaJson(after),
        metadata: toPrismaJson({ workOrderId }),
      },
    });
    return after;
  });
}

export async function createCustomerSuppliedPart(
  workOrderId: string,
  input: { description: string; article?: string; brand?: string; quantity?: string | number },
  actorName = "CRM / Сервіс-менеджер",
) {
  const prisma = getPrisma();
  const config = await prisma.directRepairCommercialConfig.findUnique({ where: { workOrderId } });
  if (!config?.partsMode || !["CUSTOMER_SUPPLIED", "MIXED"].includes(config.partsMode)) {
    throw new DirectRepairCommercialError("CUSTOMER_PART_MODE_REQUIRED", "Оберіть «Запчастини клієнта» або «Змішаний варіант».");
  }
  const description = text(input.description, 500);
  if (!description) throw new DirectRepairCommercialError("DESCRIPTION_REQUIRED", "Вкажіть назву запчастини клієнта.");
  const created = await createWorkOrderLine(workOrderId, {
    type: "PART",
    description,
    article: text(input.article, 120) || undefined,
    brand: text(input.brand, 120) || undefined,
    plannedQuantity: input.quantity ?? 1,
    plannedUnitPrice: 0,
    plannedUnitCost: 0,
    requiredForRepair: true,
    metadata: { source: "CUSTOMER_SUPPLIED_PART" },
  }, actorName);
  try {
    await setDirectRepairPartSource(workOrderId, created.line.id, "CUSTOMER", actorName);
  } catch (error) {
    await updateWorkOrderLine(workOrderId, created.line.id, { status: "CANCELLED" }, actorName).catch(() => undefined);
    throw error;
  }
  return created;
}
