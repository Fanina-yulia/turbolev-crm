import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type ProcessState = "OVERDUE" | "PENDING" | "DONE";
type ProcessType = "DIAGNOSTIC" | "REPAIR";

const EXCLUDED_APPOINTMENT_STATUSES = new Set(["CANCELLED", "NO_SHOW", "RESERVE"]);
const REPAIR_DONE_STATUSES = new Set(["WAITING_QC", "WAITING_PAYMENT", "READY_FOR_PICKUP", "COMPLETED", "CLOSED", "DELIVERED"]);
const DIAGNOSTIC_DONE_REVIEW_STATES = new Set(["SUBMITTED", "CONFIRMED"]);

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null } | null | undefined, fallback?: string | null) {
  const canonical = vehicle ? [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") : "";
  return canonical || fallback || "Автомобіль";
}

function processState(done: boolean, plannedStartAt: Date | null): ProcessState {
  if (done) return "DONE";
  if (plannedStartAt && plannedStartAt.getTime() < Date.now()) return "OVERDUE";
  return "PENDING";
}

function stateLabel(state: ProcessState, plannedStartAt: Date | null, type: ProcessType) {
  if (state === "DONE") return type === "DIAGNOSTIC" ? "Діагностика виконана" : "Ремонт виконано";
  if (state === "OVERDUE") return "Протерміновано";
  if (!plannedStartAt) return "Очікує";
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" });
  const today = formatter.format(new Date());
  const planned = formatter.format(plannedStartAt);
  return planned === today ? "Сьогодні" : planned > today ? "Заплановано" : "Очікує";
}

export async function GET(request: Request) {
  try {
    const access = await authorize(PERMISSIONS.PRODUCTION_READ, { request, minimumScope: "ASSIGNED", strict: true });
    if (!access.allowed) return access.response!;
    if (!access.context.user || !access.context.roles.some((role) => role.code === "MECHANIC")) {
      return NextResponse.json({ ok: false, error: "MECHANIC_ROLE_REQUIRED", message: "Доступ доступний лише механіку." }, { status: 403 });
    }

    const prisma = getPrisma();
    const mechanic = await prisma.serviceMechanic.findFirst({
      where: { userId: access.context.user.id, isActive: true },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!mechanic) return NextResponse.json({ ok: true, linked: false, items: [] }, { headers: { "Cache-Control": "no-store" } });

    const mechanicIds = [mechanic.id, access.context.user.id];

    const [assignments, appointments] = await Promise.all([
      prisma.diagnosticAssignment.findMany({
        where: { mechanicId: mechanic.id },
        select: { diagnosticRequestId: true, createdAt: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.serviceAppointment.findMany({
        where: {
          mechanicId: mechanic.id,
          status: { notIn: ["CANCELLED", "NO_SHOW", "RESERVE"] },
        },
        select: {
          id: true,
          leadId: true,
          vehicleId: true,
          workOrderId: true,
          purpose: true,
          status: true,
          vehicleLabel: true,
          plateNumber: true,
          plannedStartAt: true,
          plannedEndAt: true,
          actualEndAt: true,
          updatedAt: true,
        },
        orderBy: { plannedStartAt: "desc" },
      }),
    ]);

    const diagnosticIds = assignments.map((row) => row.diagnosticRequestId);
    const [diagnostics, reviews, links] = await Promise.all([
      diagnosticIds.length
        ? prisma.diagnosticRequest.findMany({
            where: { id: { in: diagnosticIds }, status: { not: "CANCELLED" } },
            select: {
              id: true,
              leadId: true,
              vehicleId: true,
              status: true,
              confirmedAt: true,
              createdAt: true,
              updatedAt: true,
              vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } },
            },
          })
        : [],
      diagnosticIds.length
        ? prisma.diagnosticReview.findMany({
            where: { diagnosticRequestId: { in: diagnosticIds } },
            select: { diagnosticRequestId: true, state: true, submittedAt: true, confirmedAt: true, updatedAt: true },
          })
        : [],
      diagnosticIds.length
        ? prisma.diagnosticVisitLink.findMany({
            where: { diagnosticRequestId: { in: diagnosticIds } },
            select: { diagnosticRequestId: true, appointmentId: true },
          })
        : [],
    ]);

    const appointmentById = new Map(appointments.map((row) => [row.id, row]));
    const reviewByDiagnosticId = new Map(reviews.map((row) => [row.diagnosticRequestId, row]));
    const linkByDiagnosticId = new Map(links.map((row) => [row.diagnosticRequestId, row]));
    const assignmentByDiagnosticId = new Map(assignments.map((row) => [row.diagnosticRequestId, row]));

    const diagnosticCards = diagnostics.map((diagnostic) => {
      const review = reviewByDiagnosticId.get(diagnostic.id);
      const link = linkByDiagnosticId.get(diagnostic.id);
      const linkedAppointment = link ? appointmentById.get(link.appointmentId) ?? null : null;
      const legacyAppointment = linkedAppointment ?? appointments.find((row) => (
        (row.purpose === "DIAGNOSTICS" || row.purpose == null)
        && row.vehicleId === diagnostic.vehicleId
        && Boolean(diagnostic.leadId && row.leadId === diagnostic.leadId)
      )) ?? null;
      const plannedStartAt = legacyAppointment?.plannedStartAt ?? diagnostic.createdAt;
      const plannedEndAt = legacyAppointment?.plannedEndAt ?? null;
      const done = Boolean(
        diagnostic.status === "CONFIRMED"
        || diagnostic.confirmedAt
        || (review && DIAGNOSTIC_DONE_REVIEW_STATES.has(review.state)),
      );
      const state = processState(done, plannedStartAt);
      const routePending = done && legacyAppointment?.status === "WAITING_PAYMENT";

      return {
        id: `diagnostic:${diagnostic.id}`,
        processType: "DIAGNOSTIC" as const,
        processId: diagnostic.id,
        diagnosticId: diagnostic.id,
        workOrderId: null,
        appointmentId: legacyAppointment?.id ?? null,
        vehicle: vehicleLabel(diagnostic.vehicle, legacyAppointment?.vehicleLabel),
        plate: diagnostic.vehicle.plateNumber || legacyAppointment?.plateNumber || "Без держномера",
        plannedStartAt: plannedStartAt.toISOString(),
        plannedEndAt: plannedEndAt?.toISOString() ?? null,
        completedAt: (review?.submittedAt || review?.confirmedAt || diagnostic.confirmedAt)?.toISOString() ?? null,
        state,
        statusLabel: stateLabel(state, plannedStartAt, "DIAGNOSTIC"),
        summary: routePending ? "Діагностика · оберіть подальший маршрут" : "Діагностика",
        workCount: 0,
        taskId: null,
        routePending,
        updatedAt: (review?.updatedAt || diagnostic.updatedAt || assignmentByDiagnosticId.get(diagnostic.id)?.updatedAt || diagnostic.createdAt).toISOString(),
      };
    });

    const repairAppointments = appointments.filter((row) => (
      !EXCLUDED_APPOINTMENT_STATUSES.has(row.status)
      && (row.purpose === "REPAIR" || (row.purpose == null && Boolean(row.workOrderId)))
    ));
    const workOrderIds = Array.from(new Set(repairAppointments.flatMap((row) => row.workOrderId ? [row.workOrderId] : [])));

    const [workOrders, workLines, vehicles] = await Promise.all([
      workOrderIds.length
        ? prisma.workOrder.findMany({
            where: { id: { in: workOrderIds } },
            select: { id: true, status: true, closedAt: true, vehicleId: true, updatedAt: true },
          })
        : [],
      workOrderIds.length
        ? prisma.workOrderLine.findMany({
            where: { workOrderId: { in: workOrderIds }, type: { not: "PART" }, status: { not: "CANCELLED" } },
            select: { id: true, workOrderId: true, status: true, mechanicId: true, completedAt: true, sortOrder: true, createdAt: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          })
        : [],
      repairAppointments.some((row) => row.vehicleId)
        ? prisma.vehicle.findMany({
            where: { id: { in: Array.from(new Set(repairAppointments.flatMap((row) => row.vehicleId ? [row.vehicleId] : []))) } },
            select: { id: true, brand: true, model: true, year: true, plateNumber: true },
          })
        : [],
    ]);

    const workOrderById = new Map(workOrders.map((row) => [row.id, row]));
    const vehicleById = new Map(vehicles.map((row) => [row.id, row]));

    const repairCards = repairAppointments.map((appointment) => {
      const workOrder = appointment.workOrderId ? workOrderById.get(appointment.workOrderId) ?? null : null;
      const lines = appointment.workOrderId ? workLines.filter((line) => line.workOrderId === appointment.workOrderId) : [];
      const assignedLines = lines.filter((line) => !line.mechanicId || mechanicIds.includes(line.mechanicId));
      const relevantLines = assignedLines.length ? assignedLines : lines;
      const allLinesDone = relevantLines.length > 0 && relevantLines.every((line) => line.status === "COMPLETED" || line.status === "DONE");
      const done = Boolean(
        appointment.actualEndAt
        || REPAIR_DONE_STATUSES.has(appointment.status)
        || (workOrder && (REPAIR_DONE_STATUSES.has(workOrder.status) || workOrder.status === "CLOSED" || workOrder.closedAt))
        || allLinesDone,
      );
      const state = processState(done, appointment.plannedStartAt);
      const vehicle = appointment.vehicleId ? vehicleById.get(appointment.vehicleId) ?? null : null;
      const preferredLine = relevantLines.find((line) => !["COMPLETED", "DONE"].includes(line.status)) ?? relevantLines[0] ?? null;

      return {
        id: `repair:${appointment.id}`,
        processType: "REPAIR" as const,
        processId: appointment.id,
        diagnosticId: null,
        workOrderId: appointment.workOrderId,
        appointmentId: appointment.id,
        vehicle: vehicleLabel(vehicle, appointment.vehicleLabel),
        plate: vehicle?.plateNumber || appointment.plateNumber || "Без держномера",
        plannedStartAt: appointment.plannedStartAt.toISOString(),
        plannedEndAt: appointment.plannedEndAt.toISOString(),
        completedAt: (appointment.actualEndAt || workOrder?.closedAt || relevantLines.map((line) => line.completedAt).filter((value): value is Date => Boolean(value)).sort((a, b) => b.getTime() - a.getTime())[0] || null)?.toISOString() ?? null,
        state,
        statusLabel: stateLabel(state, appointment.plannedStartAt, "REPAIR"),
        summary: relevantLines.length ? `Ремонт · Робіт: ${relevantLines.length}` : "Ремонт",
        workCount: relevantLines.length,
        taskId: preferredLine?.id ?? null,
        routePending: false,
        updatedAt: (workOrder?.updatedAt || appointment.updatedAt).toISOString(),
      };
    });

    const stateRank: Record<ProcessState, number> = { OVERDUE: 0, PENDING: 1, DONE: 2 };
    const items = [...diagnosticCards, ...repairCards].sort((a, b) => {
      const stateDiff = stateRank[a.state] - stateRank[b.state];
      if (stateDiff) return stateDiff;
      const aTime = new Date(a.plannedStartAt).getTime();
      const bTime = new Date(b.plannedStartAt).getTime();
      if (a.state === "DONE" && b.state === "DONE") return bTime - aTime;
      return aTime - bTime;
    });

    return NextResponse.json({
      ok: true,
      linked: true,
      mechanic: { id: mechanic.id, name: mechanic.name },
      items,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET mechanic process cards failed", error);
    return NextResponse.json({ ok: false, error: "MECHANIC_PROCESS_CARDS_LOAD_FAILED", message: "Не вдалося завантажити історію діагностик і ремонтів." }, { status: 500 });
  }
}
