import type { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";

export type DiagnosticVisitLinkInput = {
  diagnosticRequestId: string;
  appointmentId: string;
  vehicleId: string;
  source: "PLANNER" | "WALK_IN" | "AUDIT_BACKFILL";
};

export async function linkDiagnosticVisitInTransaction(tx: Prisma.TransactionClient, input: DiagnosticVisitLinkInput) {
  const existing = await tx.diagnosticVisitLink.findUnique({ where: { diagnosticRequestId: input.diagnosticRequestId } });
  if (existing) return existing;

  const appointmentLink = await tx.diagnosticVisitLink.findUnique({ where: { appointmentId: input.appointmentId } });
  if (appointmentLink) {
    if (appointmentLink.diagnosticRequestId === input.diagnosticRequestId) return appointmentLink;
    throw new Error(`DIAGNOSTIC_VISIT_CONFLICT:${input.appointmentId}`);
  }

  return tx.diagnosticVisitLink.create({ data: input });
}

type AuditVisitRow = {
  appointmentId: string | null;
};

export async function ensureDiagnosticVisitLink(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const existing = await prisma.diagnosticVisitLink.findUnique({ where: { diagnosticRequestId } });
  if (existing) return existing;

  const diagnostic = await prisma.diagnosticRequest.findUnique({
    where: { id: diagnosticRequestId },
    select: { id: true, vehicleId: true },
  });
  if (!diagnostic) return null;

  const rows = await prisma.$queryRaw<AuditVisitRow[]>`
    SELECT CASE
      WHEN "entityType" = 'ServiceAppointment' THEN "entityId"
      ELSE NULLIF("metadata" ->> 'appointmentId', '')
    END AS "appointmentId"
    FROM "AuditEvent"
    WHERE (
      "entityType" = 'ServiceAppointment'
      AND "action" IN ('ARRIVAL_WORKFLOW', 'MECHANIC_WALK_IN_CREATED')
      AND "metadata" ->> 'diagnosticRequestId' = ${diagnosticRequestId}
    ) OR (
      "entityType" = 'DiagnosticRequest'
      AND "entityId" = ${diagnosticRequestId}
      AND "action" = 'WALK_IN_DIAGNOSTIC_STARTED'
    )
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;
  const appointmentId = rows[0]?.appointmentId || null;
  if (!appointmentId) return null;

  const appointment = await prisma.serviceAppointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, vehicleId: true },
  });
  if (!appointment || appointment.vehicleId !== diagnostic.vehicleId) return null;

  await prisma.diagnosticVisitLink.createMany({
    data: [{ diagnosticRequestId, appointmentId, vehicleId: diagnostic.vehicleId, source: "AUDIT_BACKFILL" }],
    skipDuplicates: true,
  });
  return prisma.diagnosticVisitLink.findUnique({ where: { diagnosticRequestId } });
}

export async function getDiagnosticVisitContext(diagnosticRequestId: string) {
  const prisma = getPrisma();
  const link = await ensureDiagnosticVisitLink(diagnosticRequestId);
  if (!link) return {
    appointmentId: null,
    plannedStartAt: null,
    plannedEndAt: null,
    actualArrivalAt: null,
    actualStartAt: null,
    actualEndAt: null,
    locationId: null,
    postId: null,
    mechanicId: null,
    problem: null,
    source: null,
  };

  const appointment = await prisma.serviceAppointment.findUnique({
    where: { id: link.appointmentId },
    select: {
      id: true,
      plannedStartAt: true,
      plannedEndAt: true,
      actualArrivalAt: true,
      actualStartAt: true,
      actualEndAt: true,
      locationId: true,
      postId: true,
      mechanicId: true,
      problem: true,
      source: true,
    },
  });
  if (!appointment) return {
    appointmentId: link.appointmentId,
    plannedStartAt: null,
    plannedEndAt: null,
    actualArrivalAt: null,
    actualStartAt: null,
    actualEndAt: null,
    locationId: null,
    postId: null,
    mechanicId: null,
    problem: null,
    source: link.source,
  };

  return {
    appointmentId: appointment.id,
    plannedStartAt: appointment.plannedStartAt,
    plannedEndAt: appointment.plannedEndAt,
    actualArrivalAt: appointment.actualArrivalAt,
    actualStartAt: appointment.actualStartAt,
    actualEndAt: appointment.actualEndAt,
    locationId: appointment.locationId,
    postId: appointment.postId,
    mechanicId: appointment.mechanicId,
    problem: appointment.problem,
    source: appointment.source || link.source,
  };
}
