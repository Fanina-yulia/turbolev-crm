import { createHash } from "node:crypto";
import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function snapshotLine(line: {
  id: string;
  type: string;
  status: string;
  description: string;
  code: string | null;
  article: string | null;
  brand: string | null;
  unit: string;
  currency: string;
  requiredForRepair: boolean;
  plannedQuantity: Prisma.Decimal;
  plannedUnitPrice: Prisma.Decimal;
  plannedUnitCost: Prisma.Decimal;
  plannedDiscount: Prisma.Decimal;
  laborHours: Prisma.Decimal | null;
  mechanicId: string | null;
  supplierId: string | null;
  supplierQuoteId: string | null;
  supplierOrderId: string | null;
  catalogItemId: string | null;
  sortOrder: number;
}) {
  return {
    id: line.id,
    type: line.type,
    status: line.status,
    description: line.description,
    code: line.code,
    article: line.article,
    brand: line.brand,
    unit: line.unit,
    currency: line.currency.toUpperCase(),
    requiredForRepair: line.requiredForRepair,
    plannedQuantity: line.plannedQuantity.toFixed(3),
    plannedUnitPrice: line.plannedUnitPrice.toFixed(2),
    plannedUnitCost: line.plannedUnitCost.toFixed(2),
    plannedDiscount: line.plannedDiscount.toFixed(2),
    laborHours: line.laborHours?.toFixed(2) ?? null,
    mechanicId: line.mechanicId,
    supplierId: line.supplierId,
    supplierQuoteId: line.supplierQuoteId,
    supplierOrderId: line.supplierOrderId,
    catalogItemId: line.catalogItemId,
    sortOrder: line.sortOrder,
  };
}

export async function normalizeApprovedEstimateFingerprint(
  workOrderId: string,
  estimateId: string,
  actorName = "CRM / Сервіс-менеджер",
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`wo-commercial:${workOrderId}`}))`;
    const estimate = await tx.workOrderEstimate.findFirst({
      where: { id: estimateId, workOrderId, status: "APPROVED" },
    });
    if (!estimate) return null;

    const lines = await tx.workOrderLine.findMany({
      where: { workOrderId, status: { in: ["DRAFT", "APPROVED", "IN_PROGRESS", "COMPLETED"] } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
    const snapshot = lines.map(snapshotLine);
    const lineFingerprint = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    if (estimate.lineFingerprint === lineFingerprint) return estimate;

    const updated = await tx.workOrderEstimate.update({
      where: { id: estimate.id },
      data: { lineFingerprint, lineSnapshot: jsonSafe(snapshot) },
    });
    await tx.auditEvent.create({
      data: {
        actorName,
        entityType: "WorkOrderEstimate",
        entityId: estimate.id,
        action: "ESTIMATE_APPROVED_SNAPSHOT_NORMALIZED",
        before: jsonSafe({ lineFingerprint: estimate.lineFingerprint }),
        after: jsonSafe({ lineFingerprint }),
        metadata: jsonSafe({ workOrderId, lineCount: lines.length }),
      },
    });
    return updated;
  });
}
