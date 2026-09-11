import { Prisma } from "@/src/generated/prisma/client";
import { toPrismaJson } from "@/src/lib/prisma-json";

type Tx = Prisma.TransactionClient;

function amount(line: {
  plannedQuantity: Prisma.Decimal;
  plannedUnitPrice: Prisma.Decimal;
  plannedDiscount: Prisma.Decimal;
  actualQuantity: Prisma.Decimal | null;
  actualUnitPrice: Prisma.Decimal | null;
  actualDiscount: Prisma.Decimal | null;
}) {
  const quantity = line.actualQuantity ?? line.plannedQuantity;
  const unitPrice = line.actualUnitPrice ?? line.plannedUnitPrice;
  const discount = line.actualDiscount ?? line.plannedDiscount;
  return Prisma.Decimal.max(new Prisma.Decimal(0), quantity.mul(unitPrice).minus(discount)).toDecimalPlaces(2);
}

export async function ensureCompletionActTx(tx: Tx, workOrderId: string, issuedByName = "CRM") {
  const existing = await tx.serviceCompletionAct.findUnique({ where: { workOrderId } });
  if (existing) return existing;

  const workOrder = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, origin: true, vehicleId: true, lines: { where: { status: { not: "CANCELLED" } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");

  const lines = workOrder.lines.map((line) => ({
    id: line.id,
    type: line.type,
    description: line.description,
    code: line.code,
    article: line.article,
    brand: line.brand,
    unit: line.unit,
    currency: line.currency,
    quantity: (line.actualQuantity ?? line.plannedQuantity).toString(),
    unitPrice: (line.actualUnitPrice ?? line.plannedUnitPrice).toString(),
    discount: (line.actualDiscount ?? line.plannedDiscount).toString(),
    total: amount(line).toString(),
    completedAt: line.completedAt?.toISOString() ?? null,
  }));
  const total = workOrder.lines.reduce((sum, line) => sum.plus(amount(line)), new Prisma.Decimal(0)).toDecimalPlaces(2);
  const actNumber = `АВР-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${workOrder.id.slice(-8).toUpperCase()}`;
  const act = await tx.serviceCompletionAct.create({
    data: {
      workOrderId,
      actNumber,
      status: "ISSUED",
      currency: workOrder.lines[0]?.currency ?? "UAH",
      lineSnapshot: toPrismaJson(lines),
      totalAmount: total,
      issuedByName,
    },
  });
  await tx.auditEvent.create({
    data: {
      actorName: issuedByName,
      entityType: "ServiceCompletionAct",
      entityId: act.id,
      action: "SERVICE_COMPLETION_ACT_ISSUED",
      after: toPrismaJson(act),
      metadata: toPrismaJson({ workOrderId, vehicleId: workOrder.vehicleId, origin: workOrder.origin, lineCount: lines.length }),
    },
  });
  return act;
}
