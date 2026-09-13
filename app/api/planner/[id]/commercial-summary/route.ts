import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const APPROVED_STATUSES = new Set(["APPROVED", "IN_PROGRESS", "COMPLETED"]);

function denied(message = "Цей запис не входить до Вашого доступу.") {
  return NextResponse.json({ ok: false, error: "FORBIDDEN", message }, { status: 403 });
}

function lineAmount(line: {
  plannedQuantity: { toString(): string };
  plannedUnitPrice: { toString(): string };
  plannedDiscount: { toString(): string };
}) {
  const quantity = Number(line.plannedQuantity.toString());
  const unitPrice = Number(line.plannedUnitPrice.toString());
  const discount = Number(line.plannedDiscount.toString());
  if (![quantity, unitPrice, discount].every(Number.isFinite)) return 0;
  return Math.max(0, quantity * unitPrice - discount);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const access = await authorize(PERMISSIONS.PLANNER_READ, { strict: true, request, minimumScope: "ASSIGNED" });
  if (!access.allowed) return access.response!;

  const prisma = getPrisma();
  const appointment = await prisma.serviceAppointment.findUnique({
    where: { id },
    select: {
      id: true,
      locationId: true,
      mechanicId: true,
      workOrderId: true,
      estimatedAmount: true,
      purpose: true,
      status: true,
    },
  });
  if (!appointment) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND", message: "Запис планувальника не знайдено." }, { status: 404 });
  }

  if (access.grantedScope !== "ALL" && !access.context.locationIds.includes(appointment.locationId)) {
    return denied();
  }
  if (access.grantedScope === "ASSIGNED") {
    const userId = access.context.user?.id;
    if (!userId || !appointment.mechanicId) return denied("Цей запис не належить до Ваших призначених робіт.");
    const assignedMechanic = await prisma.serviceMechanic.findFirst({
      where: {
        id: appointment.mechanicId,
        userId,
        isActive: true,
        locationId: appointment.locationId,
      },
      select: { id: true },
    });
    if (!assignedMechanic) return denied("Цей запис не належить до Ваших призначених робіт.");
  }

  if (!appointment.workOrderId) {
    return NextResponse.json({
      ok: true,
      appointmentId: appointment.id,
      workOrderId: null,
      editTarget: "APPOINTMENT",
      purpose: appointment.purpose,
      status: appointment.status,
      estimatedAmount: appointment.estimatedAmount == null ? null : Number(appointment.estimatedAmount),
      commercialSummary: null,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const lines = await prisma.workOrderLine.findMany({
    where: { workOrderId: appointment.workOrderId },
    select: {
      id: true,
      status: true,
      currency: true,
      plannedQuantity: true,
      plannedUnitPrice: true,
      plannedDiscount: true,
      sourceEntity: true,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const activeLines = lines.filter((line) => line.status !== "CANCELLED");
  const currencies = Array.from(new Set(activeLines.map((line) => line.currency.toUpperCase())));
  const byCurrency = new Map<string, { approvedAmount: number; pendingAmount: number; approvedCount: number; pendingCount: number }>();

  for (const line of activeLines) {
    const currency = line.currency.toUpperCase();
    const bucket = byCurrency.get(currency) || { approvedAmount: 0, pendingAmount: 0, approvedCount: 0, pendingCount: 0 };
    const amount = lineAmount(line);
    if (APPROVED_STATUSES.has(line.status)) {
      bucket.approvedAmount += amount;
      bucket.approvedCount += 1;
    } else if (line.status === "DRAFT") {
      bucket.pendingAmount += amount;
      bucket.pendingCount += 1;
    }
    byCurrency.set(currency, bucket);
  }

  const mixedCurrency = currencies.length > 1;
  const primaryCurrency = currencies[0] || "UAH";
  const primary = byCurrency.get(primaryCurrency) || { approvedAmount: 0, pendingAmount: 0, approvedCount: 0, pendingCount: 0 };

  return NextResponse.json({
    ok: true,
    appointmentId: appointment.id,
    workOrderId: appointment.workOrderId,
    editTarget: "WORK_ORDER",
    purpose: appointment.purpose,
    status: appointment.status,
    estimatedAmount: appointment.estimatedAmount == null ? null : Number(appointment.estimatedAmount),
    commercialSummary: {
      currency: primaryCurrency,
      mixedCurrency,
      approvedAmount: mixedCurrency ? null : Math.round(primary.approvedAmount * 100) / 100,
      pendingAmount: mixedCurrency ? null : Math.round(primary.pendingAmount * 100) / 100,
      approvedCount: activeLines.filter((line) => APPROVED_STATUSES.has(line.status)).length,
      pendingCount: activeLines.filter((line) => line.status === "DRAFT").length,
      mechanicRequestedPendingCount: activeLines.filter((line) => line.status === "DRAFT" && line.sourceEntity === "MECHANIC_ADDITIONAL_WORK").length,
      byCurrency: Object.fromEntries(Array.from(byCurrency.entries()).map(([currency, value]) => [currency, {
        approvedAmount: Math.round(value.approvedAmount * 100) / 100,
        pendingAmount: Math.round(value.pendingAmount * 100) / 100,
        approvedCount: value.approvedCount,
        pendingCount: value.pendingCount,
      }])),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
