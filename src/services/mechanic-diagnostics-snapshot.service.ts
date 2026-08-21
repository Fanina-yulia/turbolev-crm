import {
  DiagnosticRequestStatus,
  DiagnosticReviewState,
  PlannerAppointmentStatus,
} from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";

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
 * This avoids resolving the same mechanic resource again inside one consolidated
 * cabinet request while preserving the legacy diagnostics response shape.
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
      leadId: true,
      vehicleId: true,
      plannedStartAt: true,
      plannedEndAt: true,
      problem: true,
      post: { select: { name: true } },
    },
    orderBy: { plannedStartAt: "asc" },
    take: 40,
  });

  const vehicleIds = Array.from(new Set(appointments.flatMap((row) => row.vehicleId ? [row.vehicleId] : [])));
  const leadIds = Array.from(new Set(appointments.flatMap((row) => row.leadId ? [row.leadId] : [])));
  if (!appointments.length || (!vehicleIds.length && !leadIds.length)) return { items: [] };

  const diagnostics = await prisma.diagnosticRequest.findMany({
    where: {
      status: { not: DiagnosticRequestStatus.CANCELLED },
      OR: [
        ...(vehicleIds.length ? [{ vehicleId: { in: vehicleIds } }] : []),
        ...(leadIds.length ? [{ leadId: { in: leadIds } }] : []),
      ],
    },
    include: {
      client: { select: { id: true, name: true, phone: true } },
      vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true, mileageKm: true } },
      lead: { select: { id: true, need: true, comment: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  const diagnosticByAppointment = new Map<string, string>();
  for (const appointment of appointments) {
    const diagnostic = diagnostics.find((row) => Boolean(appointment.leadId && row.leadId === appointment.leadId))
      || diagnostics.find((row) => Boolean(appointment.vehicleId && row.vehicleId === appointment.vehicleId));
    if (diagnostic) diagnosticByAppointment.set(appointment.id, diagnostic.id);
  }

  const ids = Array.from(new Set(diagnosticByAppointment.values()));
  const reviews = ids.length
    ? await prisma.diagnosticReview.findMany({ where: { diagnosticRequestId: { in: ids } } })
    : [];
  const byId = new Map(diagnostics.map((row) => [row.id, row]));
  const reviewById = new Map(reviews.map((row) => [row.diagnosticRequestId, row]));

  const items = appointments.flatMap((appointment) => {
    const id = diagnosticByAppointment.get(appointment.id);
    const row = id ? byId.get(id) : undefined;
    if (!row) return [];
    const review = reviewById.get(row.id);
    const workflowState = review?.state === DiagnosticReviewState.SUBMITTED
      ? "SUBMITTED"
      : review?.state === DiagnosticReviewState.RETURNED
        ? "RETURNED"
        : row.status;
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
