import { NextRequest, NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import type { VehicleStatusItem, VehicleStatusSummary, VehicleStatusTone } from "@/src/lib/contracts/crm-core";
import { getDiagnosticVehicleStatuses } from "@/src/services/diagnostic-vehicle-status.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_IDS = 100;
const ACTIVE_WORK_ORDER_STATUSES = new Set([
  "PARTS_REVIEW",
  "WAITING_APPROVAL",
  "WAITING_PARTS",
  "READY_FOR_REPAIR",
  "IN_REPAIR",
  "PAUSED",
  "REWORK",
  "WAITING_QC",
]);

function item(
  state: string,
  label: string,
  tone: VehicleStatusTone,
  targetId: string | null,
  updatedAt: Date | null | undefined,
): VehicleStatusItem {
  return { state, label, tone, targetId, updatedAt: updatedAt ? updatedAt.toISOString() : null };
}

function proposalStatus(row: {
  id: string;
  status: string;
  updatedAt: Date;
  sentAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
} | null, workOrderId: string | null): VehicleStatusItem {
  if (!row || row.status === "DRAFT" || row.status === "SUPERSEDED" || row.status === "CANCELLED") {
    return item("not_sent", "Не відправлена", "danger", workOrderId, row?.updatedAt);
  }
  if (row.status === "APPROVED" || row.approvedAt) {
    return item("approved", "Погоджена", "success", workOrderId, row.updatedAt);
  }
  if (row.status === "REJECTED" || row.rejectedAt) {
    return item("rejected", "Відхилена", "danger", workOrderId, row.updatedAt);
  }
  if (row.status === "SENT" || row.sentAt) {
    return item("pending", "На розгляді", "warning", workOrderId, row.updatedAt);
  }
  return item("not_sent", "Не відправлена", "danger", workOrderId, row.updatedAt);
}

function workStatus(
  row: { id: string; status: string; closedAt: Date | null; updatedAt: Date } | null,
  obligation: { status: string; amount: unknown; settledAmount: unknown; updatedAt: Date } | null,
): VehicleStatusItem {
  if (!row || row.status === "CANCELLED") {
    return item("not_started", "Не розпочато", "danger", row?.id || null, row?.updatedAt);
  }

  const amount = Number(obligation?.amount ?? 0);
  const settled = Number(obligation?.settledAmount ?? 0);
  const paid = Boolean(obligation && (obligation.status === "PAID" || (amount > 0 && settled >= amount)));
  const closed = row.status === "CLOSED" || row.status === "COMPLETED" || Boolean(row.closedAt);

  if (closed && (paid || !obligation)) {
    return item("paid", "Оплачено", "success", row.id, obligation?.updatedAt || row.updatedAt);
  }
  if (row.status === "READY_FOR_PICKUP" || row.status === "WAITING_PAYMENT" || (closed && !paid)) {
    return item("completed_unpaid", "Очікує оплату", "warning", row.id, obligation?.updatedAt || row.updatedAt);
  }
  if (ACTIVE_WORK_ORDER_STATUSES.has(row.status)) {
    return item("in_progress", "В ремонті", "warning", row.id, row.updatedAt);
  }
  return item("not_started", "Не розпочато", "danger", row.id, row.updatedAt);
}

export async function GET(request: NextRequest) {
  const ids = [...new Set((request.nextUrl.searchParams.get("ids") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean))].slice(0, MAX_IDS);

  if (!ids.length) return NextResponse.json({ ok: true, vehicles: [] });

  try {
    const prisma = getPrisma();
    const [vehicles, diagnosticStatuses] = await Promise.all([
      prisma.vehicle.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          workOrders: {
            orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: {
              id: true,
              status: true,
              closedAt: true,
              updatedAt: true,
              estimates: {
                orderBy: [{ revision: "desc" }, { updatedAt: "desc" }],
                take: 1,
                select: { id: true, status: true, updatedAt: true, sentAt: true, approvedAt: true, rejectedAt: true },
              },
            },
          },
        },
      }),
      getDiagnosticVehicleStatuses(ids),
    ]);

    const workOrderIds = vehicles
      .map((vehicle) => vehicle.workOrders[0]?.id)
      .filter((id): id is string => Boolean(id));
    const obligations = workOrderIds.length
      ? await prisma.financialObligation.findMany({
          where: { workOrderId: { in: workOrderIds }, direction: "RECEIVABLE", status: { not: "CANCELLED" } },
          select: { workOrderId: true, status: true, amount: true, settledAmount: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
        })
      : [];

    const obligationsByWorkOrder = new Map<string, (typeof obligations)[number]>();
    for (const obligation of obligations) {
      if (obligation.workOrderId && !obligationsByWorkOrder.has(obligation.workOrderId)) {
        obligationsByWorkOrder.set(obligation.workOrderId, obligation);
      }
    }

    const result = vehicles.map((vehicle) => {
      const workOrder = vehicle.workOrders[0] || null;
      const estimate = workOrder?.estimates[0] || null;
      const obligation = workOrder ? obligationsByWorkOrder.get(workOrder.id) || null : null;
      const statuses: VehicleStatusSummary = {
        diagnostics: diagnosticStatuses.get(vehicle.id) || item("not_started", "Не було", "danger", null, null),
        proposal: proposalStatus(estimate, workOrder?.id || null),
        work: workStatus(workOrder, obligation),
      };
      return { vehicleId: vehicle.id, statusSummary: statuses };
    });

    return NextResponse.json({ ok: true, vehicles: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("vehicle status summary GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити статуси автомобілів." }, { status: 500 });
  }
}
