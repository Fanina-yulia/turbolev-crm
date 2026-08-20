import "server-only";

import { deriveVehicleLifecycle, type VehicleLifecycleSnapshot } from "@/src/domain/vehicle-lifecycle";
import { getPrisma } from "@/src/lib/prisma";

export type VehicleLifecycleView = VehicleLifecycleSnapshot & {
  appointmentId: string | null;
  diagnosticRequestId: string | null;
  workOrderId: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  arrivalAt: string | null;
  updatedAt: string | null;
};

const APPOINTMENT_TERMINAL = new Set(["COMPLETED", "CANCELLED", "NO_SHOW"]);
const WORK_ORDER_TERMINAL = new Set(["CLOSED", "CANCELLED"]);

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function chooseAppointment<T extends { status: string; plannedStartAt: Date; updatedAt: Date }>(rows: T[], now: Date) {
  if (!rows.length) return null;
  const active = rows.filter((row) => !APPOINTMENT_TERMINAL.has(String(row.status)));
  const current = active
    .filter((row) => !["BOOKED", "RESERVE"].includes(String(row.status)))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  if (current) return current;
  const future = active
    .filter((row) => row.plannedStartAt.getTime() >= now.getTime())
    .sort((a, b) => a.plannedStartAt.getTime() - b.plannedStartAt.getTime())[0];
  if (future) return future;
  return active.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
    || rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
    || null;
}

/**
 * Batch resolver for directory/dashboard views. It deliberately derives one
 * user-facing vehicle status from the existing Appointment, Diagnostic and
 * WorkOrder aggregates instead of introducing another independently mutable DB status.
 */
export async function getVehicleLifecycleMap(vehicleIds: string[], now = new Date()) {
  const ids = [...new Set(vehicleIds.filter(Boolean))];
  const result = new Map<string, VehicleLifecycleView | null>();
  ids.forEach((id) => result.set(id, null));
  if (!ids.length) return result;

  const prisma = getPrisma();
  const [appointments, workOrders, diagnostics] = await Promise.all([
    prisma.serviceAppointment.findMany({
      where: { vehicleId: { in: ids } },
      select: {
        id: true,
        vehicleId: true,
        workOrderId: true,
        status: true,
        plannedStartAt: true,
        plannedEndAt: true,
        actualArrivalAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: "desc" }, { plannedStartAt: "desc" }],
      take: 1000,
    }),
    prisma.workOrder.findMany({
      where: { vehicleId: { in: ids } },
      select: { id: true, vehicleId: true, diagnosticRequestId: true, status: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 1000,
    }),
    prisma.diagnosticRequest.findMany({
      where: { vehicleId: { in: ids } },
      select: { id: true, vehicleId: true, status: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 1000,
    }),
  ]);

  const diagnosticIds = diagnostics.map((row) => row.id);
  const workOrderIds = workOrders.map((row) => row.id);
  const [reviews, shares, estimates] = await Promise.all([
    diagnosticIds.length ? prisma.diagnosticReview.findMany({
      where: { diagnosticRequestId: { in: diagnosticIds } },
      select: { diagnosticRequestId: true, state: true, reviewerUserId: true, updatedAt: true },
    }) : [],
    diagnosticIds.length ? prisma.diagnosticReportShare.findMany({
      where: { diagnosticRequestId: { in: diagnosticIds } },
      select: { diagnosticRequestId: true, revokedAt: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }) : [],
    workOrderIds.length ? prisma.workOrderEstimate.findMany({
      where: { workOrderId: { in: workOrderIds } },
      select: { workOrderId: true, status: true, revision: true, updatedAt: true },
      orderBy: [{ revision: "desc" }, { updatedAt: "desc" }],
    }) : [],
  ]);

  const reviewByDiagnostic = new Map(reviews.map((row) => [row.diagnosticRequestId, row]));
  const shareByDiagnostic = new Map<string, (typeof shares)[number]>();
  for (const row of shares) if (!shareByDiagnostic.has(row.diagnosticRequestId)) shareByDiagnostic.set(row.diagnosticRequestId, row);
  const estimateByWorkOrder = new Map<string, (typeof estimates)[number]>();
  for (const row of estimates) if (!estimateByWorkOrder.has(row.workOrderId)) estimateByWorkOrder.set(row.workOrderId, row);

  for (const vehicleId of ids) {
    const vehicleAppointments = appointments.filter((row) => row.vehicleId === vehicleId);
    const appointment = chooseAppointment(vehicleAppointments, now);
    const vehicleWorkOrders = workOrders.filter((row) => row.vehicleId === vehicleId);
    const workOrder = vehicleWorkOrders.find((row) => !WORK_ORDER_TERMINAL.has(row.status)) || vehicleWorkOrders[0] || null;
    const vehicleDiagnostics = diagnostics.filter((row) => row.vehicleId === vehicleId);
    const diagnostic = vehicleDiagnostics.find((row) => row.status !== "CANCELLED") || vehicleDiagnostics[0] || null;
    const review = diagnostic ? reviewByDiagnostic.get(diagnostic.id) || null : null;
    const share = diagnostic ? shareByDiagnostic.get(diagnostic.id) || null : null;
    const shareActive = Boolean(share && !share.revokedAt && (!share.expiresAt || share.expiresAt.getTime() > now.getTime()));
    const estimate = workOrder ? estimateByWorkOrder.get(workOrder.id) || null : null;

    const linkedBooked = workOrder
      ? vehicleAppointments.find((row) => row.workOrderId === workOrder.id && row.status === "BOOKED" && row.plannedStartAt.getTime() >= now.getTime()) || null
      : null;
    const statusAppointment = linkedBooked || appointment;

    const lifecycle = deriveVehicleLifecycle({
      appointmentStatus: statusAppointment?.status || null,
      appointmentPlannedStartAt: statusAppointment?.plannedStartAt || null,
      appointmentPlannedEndAt: statusAppointment?.plannedEndAt || null,
      appointmentActualArrivalAt: statusAppointment?.actualArrivalAt || null,
      diagnosticStatus: diagnostic?.status || null,
      diagnosticReviewState: review?.state || null,
      diagnosticReviewerUserId: review?.reviewerUserId || null,
      diagnosticCardSent: shareActive,
      workOrderStatus: workOrder?.status || null,
      estimateStatus: estimate?.status || null,
      hasFutureBookedWork: Boolean(linkedBooked),
    }, now);

    if (!lifecycle) continue;
    result.set(vehicleId, {
      ...lifecycle,
      appointmentId: statusAppointment?.id || null,
      diagnosticRequestId: diagnostic?.id || null,
      workOrderId: workOrder?.id || null,
      plannedStartAt: iso(statusAppointment?.plannedStartAt),
      plannedEndAt: iso(statusAppointment?.plannedEndAt),
      arrivalAt: iso(statusAppointment?.actualArrivalAt),
      updatedAt: [statusAppointment?.updatedAt, workOrder?.updatedAt, diagnostic?.updatedAt, review?.updatedAt]
        .filter((value): value is Date => Boolean(value))
        .sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() || null,
    });
  }

  return result;
}

export async function getVehicleLifecycle(vehicleId: string, now = new Date()) {
  return (await getVehicleLifecycleMap([vehicleId], now)).get(vehicleId) || null;
}
