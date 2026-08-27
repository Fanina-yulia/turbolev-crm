import { getPrisma } from "@/src/lib/prisma";
import { getDiagnosticCard } from "@/src/services/diagnostic-card.service";
import { getWorkOrderFinance } from "@/src/services/work-order-finance.service";
import { buildWorkOrderLineWarranty } from "@/src/services/work-order-service-warranty.service";
import { getWorkOrder } from "@/src/services/work-orders.service";
import { getServiceTimeline } from "@/src/services/timeline.service";
import { formatWorkOrderNumber } from "@/src/domain/work-order-number";

function numberOf(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function money(value: unknown) {
  return numberOf(value).toFixed(2);
}

function quantity(value: unknown) {
  const number = numberOf(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function lineAmount(line: {
  plannedQuantity: unknown;
  plannedUnitPrice: unknown;
  plannedDiscount: unknown;
  actualQuantity: unknown;
  actualUnitPrice: unknown;
  actualDiscount: unknown;
}) {
  const qty = line.actualQuantity == null ? numberOf(line.plannedQuantity) : numberOf(line.actualQuantity);
  const unitPrice = line.actualUnitPrice == null ? numberOf(line.plannedUnitPrice) : numberOf(line.actualUnitPrice);
  const discount = line.actualDiscount == null ? numberOf(line.plannedDiscount) : numberOf(line.actualDiscount);
  return Math.max(0, qty * unitPrice - discount);
}

export class WorkOrderDocumentPackageError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "WorkOrderDocumentPackageError";
    this.code = code;
    this.status = status;
  }
}

export async function getWorkOrderDocumentPackage(workOrderId: string) {
  const prisma = getPrisma();
  const workOrder = await getWorkOrder(workOrderId);
  if (!workOrder) throw new WorkOrderDocumentPackageError("WORK_ORDER_NOT_FOUND", "Комерційна пропозиція не знайдено.", 404);

  const [numberRow, lines, estimates, cardState, finance, timeline] = await Promise.all([
    prisma.workOrderNumber.findUnique({ where: { workOrderId }, select: { number: true } }),
    prisma.workOrderLine.findMany({
      where: { workOrderId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.workOrderEstimate.findMany({
      where: { workOrderId },
      orderBy: { revision: "desc" },
      select: {
        id: true,
        revision: true,
        status: true,
        currency: true,
        lineSnapshot: true,
        subtotal: true,
        discountAmount: true,
        totalAmount: true,
        laborTotal: true,
        partsTotal: true,
        externalTotal: true,
        consumablesTotal: true,
        otherTotal: true,
        sentAt: true,
        approvedAt: true,
        rejectedAt: true,
        approvedByName: true,
        approvalSource: true,
        approvalNote: true,
        supersededAt: true,
        createdAt: true,
      },
    }),
    getDiagnosticCard(workOrder.diagnosticRequest.id),
    getWorkOrderFinance(workOrderId),
    getServiceTimeline(
      { workOrderId },
      { includeCommercial: true, includePayments: true, includeFinance: true, includeActors: true, take: 220 },
    ),
  ]);

  const latestEstimate = estimates[0] ?? null;
  const approvedEstimate = estimates.find((estimate) => estimate.status === "APPROVED") ?? null;
  const actualSnapshot = finance.snapshots.find((snapshot) => snapshot.kind === "ACTUAL" && snapshot.lockedAt) ?? null;
  const plannedSnapshot = finance.snapshots.find((snapshot) => snapshot.kind === "PLANNED") ?? null;
  const invoiceSnapshot = actualSnapshot ?? plannedSnapshot;

  const customerLines = lines
    .filter((line) => line.status !== "CANCELLED")
    .map((line) => {
      const actual = line.actualQuantity != null || line.actualUnitPrice != null || line.actualDiscount != null;
      const qty = actual && line.actualQuantity != null ? line.actualQuantity : line.plannedQuantity;
      const unitPrice = actual && line.actualUnitPrice != null ? line.actualUnitPrice : line.plannedUnitPrice;
      const discount = actual && line.actualDiscount != null ? line.actualDiscount : line.plannedDiscount;
      return {
        id: line.id,
        type: line.type,
        status: line.status,
        description: line.description,
        code: line.code,
        article: line.article,
        brand: line.brand,
        unit: line.unit,
        currency: line.currency,
        quantity: quantity(qty),
        unitPrice: money(unitPrice),
        discount: money(discount),
        total: money(lineAmount(line)),
        requiredForRepair: line.requiredForRepair,
        approvedAt: iso(line.approvedAt),
        startedAt: iso(line.startedAt),
        completedAt: iso(line.completedAt),
      };
    });

  const completedLines = customerLines.filter((line) => line.status === "COMPLETED" || Boolean(line.completedAt));
  const actTotal = completedLines.reduce((sum, line) => sum + numberOf(line.total), 0);
  const warranties = lines.map((line) => buildWorkOrderLineWarranty(line)).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const finalCard = cardState?.final?.snapshot as Record<string, unknown> | undefined;
  const recommendations = finalCard && typeof finalCard.recommendations === "object" && finalCard.recommendations
    ? finalCard.recommendations
    : { works: [], parts: [] };

  const invoiceTotal = invoiceSnapshot ? money(invoiceSnapshot.grossRevenue) : latestEstimate ? money(latestEstimate.totalAmount) : money(customerLines.reduce((sum, line) => sum + numberOf(line.total), 0));

  return {
    generatedAt: new Date().toISOString(),
    workOrder: {
      id: workOrder.id,
      number: numberRow?.number ?? null,
      displayNumber: formatWorkOrderNumber(numberRow?.number ?? null),
      status: workOrder.status,
      statusLabel: workOrder.statusLabel,
      createdAt: iso(workOrder.createdAt),
      closedAt: iso(workOrder.closedAt),
      client: { id: workOrder.client.id, name: workOrder.client.name, phone: workOrder.client.phone },
      vehicle: {
        id: workOrder.vehicle.id,
        brand: workOrder.vehicle.brand,
        model: workOrder.vehicle.model,
        year: workOrder.vehicle.year,
        plateNumber: workOrder.vehicle.plateNumber,
        vin: workOrder.vehicle.vin,
        mileageKm: workOrder.vehicle.mileageKm,
      },
      station: workOrder.appointment?.locationId ? { id: workOrder.appointment.locationId } : null,
    },
    documents: {
      diagnosticCard: cardState?.final ? {
        available: true,
        number: cardState.card.number,
        revision: cardState.final.revision,
        finalizedAt: iso(cardState.card.finalizedAt),
        snapshot: cardState.final.snapshot,
      } : {
        available: false,
        number: cardState?.card.number ?? null,
        revision: null,
        finalizedAt: null,
        snapshot: null,
      },
      recommendations: {
        available: Boolean(cardState?.final),
        source: cardState?.final ? "DIAGNOSTIC_CARD_FINAL" : null,
        items: recommendations,
      },
      estimate: latestEstimate ? {
        available: true,
        id: latestEstimate.id,
        revision: latestEstimate.revision,
        status: latestEstimate.status,
        currency: latestEstimate.currency,
        subtotal: money(latestEstimate.subtotal),
        discountAmount: money(latestEstimate.discountAmount),
        totalAmount: money(latestEstimate.totalAmount),
        laborTotal: money(latestEstimate.laborTotal),
        partsTotal: money(latestEstimate.partsTotal),
        externalTotal: money(latestEstimate.externalTotal),
        consumablesTotal: money(latestEstimate.consumablesTotal),
        otherTotal: money(latestEstimate.otherTotal),
        lineSnapshot: latestEstimate.lineSnapshot,
        sentAt: iso(latestEstimate.sentAt),
        approvedAt: iso(latestEstimate.approvedAt),
        rejectedAt: iso(latestEstimate.rejectedAt),
        approvedByName: latestEstimate.approvedByName,
        approvalSource: latestEstimate.approvalSource,
        approvalNote: latestEstimate.approvalNote,
        createdAt: iso(latestEstimate.createdAt),
      } : { available: false },
      invoice: {
        available: customerLines.length > 0 || Boolean(latestEstimate),
        state: actualSnapshot ? "FINAL" : "DRAFT",
        currency: invoiceSnapshot?.currency ?? latestEstimate?.currency ?? "UAH",
        totalAmount: invoiceTotal,
        receivable: finance.summary.receivable,
        paid: finance.summary.paid,
        outstanding: finance.summary.outstanding,
        fullyPaid: finance.summary.fullyPaid,
        actualFinalized: finance.summary.actualFinalized,
        lines: customerLines,
      },
      act: {
        available: completedLines.length > 0,
        state: workOrder.closedAt ? "FINAL" : "DRAFT",
        currency: completedLines[0]?.currency ?? "UAH",
        totalAmount: money(actTotal),
        completedAt: iso(workOrder.closedAt) ?? completedLines.map((line) => line.completedAt).filter(Boolean).sort().at(-1) ?? null,
        lines: completedLines,
      },
      warranty: {
        available: warranties.length > 0,
        items: warranties,
      },
      history: {
        available: timeline.length > 0,
        items: timeline.map((event) => ({
          id: event.id,
          occurredAt: iso(event.occurredAt),
          kind: event.kind,
          title: event.title,
          detail: event.detail ?? null,
          actor: event.actor ?? null,
          amount: event.amount ?? null,
          currency: event.currency ?? null,
        })),
      },
    },
    sourceOfTruth: {
      diagnostic: cardState?.final ? "DIAGNOSTIC_CARD_FINAL" : "NOT_FINALIZED",
      estimate: approvedEstimate ? `WORK_ORDER_ESTIMATE_APPROVED_R${approvedEstimate.revision}` : latestEstimate ? `WORK_ORDER_ESTIMATE_R${latestEstimate.revision}` : "NONE",
      invoice: actualSnapshot ? "WORK_ORDER_FINANCE_ACTUAL" : plannedSnapshot ? "WORK_ORDER_FINANCE_PLANNED" : latestEstimate ? "WORK_ORDER_ESTIMATE" : "WORK_ORDER_LINES",
      act: "COMPLETED_WORK_ORDER_LINES",
      warranty: "WORK_ORDER_LINE_WARRANTY_SNAPSHOT",
      history: "SERVICE_TIMELINE",
    },
  };
}
