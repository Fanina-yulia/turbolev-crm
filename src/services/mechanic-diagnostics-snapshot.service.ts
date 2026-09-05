import {
  DiagnosticRequestStatus,
  DiagnosticReviewState,
  PlannerAppointmentStatus,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { resolveDiagnosticWorkflowState } from "@/src/services/diagnostic-workflow.service";

const ACTIVE_APPOINTMENT_EXCLUSIONS: PlannerAppointmentStatus[] = [
  PlannerAppointmentStatus.CANCELLED,
  PlannerAppointmentStatus.NO_SHOW,
  PlannerAppointmentStatus.RESERVE,
  PlannerAppointmentStatus.COMPLETED,
];

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

/**
 * Snapshot-only diagnostic feed that accepts an already resolved mechanic id.
 *
 * DiagnosticVisitLink is the canonical appointment boundary. The leadId fallback
 * exists only for legacy records that predate the link table; vehicleId alone is
 * intentionally never used because one vehicle can have multiple visits.
 */
export async function listMechanicDiagnosticsForSnapshot(mechanicId: string) {
  const prisma = getPrisma();
  const appointments = await prisma.serviceAppointment.findMany({
    where: {
      mechanicId,
      status: { notIn: ACTIVE_APPOINTMENT_EXCLUSIONS },
    },
    select: {
      id: true,
      purpose: true,
      leadId: true,
      plannedStartAt: true,
      plannedEndAt: true,
      problem: true,
      post: { select: { name: true } },
    },
    orderBy: { plannedStartAt: "asc" },
    take: 40,
  });

  if (!appointments.length) return { items: [] };

  const links = await prisma.diagnosticVisitLink.findMany({
    where: { appointmentId: { in: appointments.map((row) => row.id) } },
    select: { appointmentId: true, diagnosticRequestId: true },
  });
  const diagnosticByAppointment = new Map(links.map((row) => [row.appointmentId, row.diagnosticRequestId]));

  const legacyAppointments = appointments.filter((row) => !diagnosticByAppointment.has(row.id) && row.purpose == null && row.leadId);
  const leadIds = Array.from(new Set(legacyAppointments.flatMap((row) => row.leadId ? [row.leadId] : [])));
  const legacyDiagnostics = leadIds.length
    ? await prisma.diagnosticRequest.findMany({
        where: {
          status: { not: DiagnosticRequestStatus.CANCELLED },
          leadId: { in: leadIds },
        },
        include: {
          client: { select: { id: true, name: true, phone: true } },
          vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true, mileageKm: true } },
          lead: { select: { id: true, need: true, comment: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      })
    : [];

  for (const appointment of legacyAppointments) {
    const diagnostic = legacyDiagnostics.find((row) => row.leadId === appointment.leadId);
    if (diagnostic) diagnosticByAppointment.set(appointment.id, diagnostic.id);
  }

  const ids = Array.from(new Set(diagnosticByAppointment.values()));
  if (!ids.length) return { items: [] };

  const diagnostics = await prisma.diagnosticRequest.findMany({
    where: { id: { in: ids }, status: { not: DiagnosticRequestStatus.CANCELLED } },
    include: {
      client: { select: { id: true, name: true, phone: true } },
      vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true, mileageKm: true } },
      lead: { select: { id: true, need: true, comment: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  const reviews = await prisma.diagnosticReview.findMany({
    where: { diagnosticRequestId: { in: ids } },
    select: { diagnosticRequestId: true, state: true },
  });
  const byId = new Map(diagnostics.map((row) => [row.id, row]));
  const reviewById = new Map(reviews.map((row) => [row.diagnosticRequestId, row]));

  const items = appointments.flatMap((appointment) => {
    const id = diagnosticByAppointment.get(appointment.id);
    const row = id ? byId.get(id) : undefined;
    if (!row) return [];
    const review = reviewById.get(row.id);
    if (review?.state === DiagnosticReviewState.SUBMITTED || review?.state === DiagnosticReviewState.CONFIRMED) return [];
    const workflowState = resolveDiagnosticWorkflowState(row.status, review?.state);
    return [{
      id: row.id,
      status: row.status,
      workflowState,
      reviewState: review?.state || DiagnosticReviewState.DRAFT,
      plannedStartAt: appointment.plannedStartAt,
      plannedEndAt: appointment.plannedEndAt,
      post: appointment.post?.name || null,
      problem: appointment.problem || row.lead?.need || null,
      vehicle: { ...row.vehicle, label: vehicleLabel(row.vehicle) },
      client: row.client,
    }];
  });

  return { items };
}
