import { getPrisma } from "@/src/lib/prisma";

export type ActiveMechanicAssignment = {
  id: string;
  caseKey: string;
  vehicleId: string | null;
  workOrderId: string | null;
  diagnosticRequestId: string | null;
  purpose: "DIAGNOSTICS" | "REPAIR" | null;
  appointmentStatus: string;
  workOrderStatus: string | null;
  vehicleLabel: string | null;
  plateNumber: string | null;
  problem: string | null;
  plannedStartAt: Date;
  plannedEndAt: Date;
  postName: string | null;
  updatedAt: Date;
};

/**
 * Canonical definition of a mechanic's active service cases.
 *
 * A case remains assigned until the related WorkOrder is closed/cancelled. Before a
 * WorkOrder exists, the appointment itself is the case and remains active until it
 * is completed/cancelled/no-show. Multiple appointments linked to one WorkOrder are
 * collapsed to one case; separate appointments for the same vehicle remain separate.
 */
export async function listActiveMechanicAssignments(mechanicId: string) {
  const prisma = getPrisma();
  return prisma.$queryRaw<ActiveMechanicAssignment[]>`
    WITH ranked AS (
      SELECT
        a.id,
        COALESCE(NULLIF(a."workOrderId", ''), a.id) AS "caseKey",
        a."vehicleId",
        a."workOrderId",
        dvl."diagnosticRequestId",
        a.purpose::text AS "purpose",
        a.status::text AS "appointmentStatus",
        wo.status AS "workOrderStatus",
        a."vehicleLabel",
        a."plateNumber",
        a.problem,
        a."plannedStartAt",
        a."plannedEndAt",
        p.name AS "postName",
        a."updatedAt",
        CASE
          WHEN wo.status = 'IN_REPAIR' OR a.status::text = 'IN_REPAIR' THEN 10
          WHEN wo.status = 'REWORK' THEN 20
          WHEN wo.status IN ('WAITING_PARTS', 'WAITING_APPROVAL', 'WAITING_QC', 'WAITING_PAYMENT') THEN 30
          WHEN a.status::text = 'WAITING_PAYMENT' THEN 30
          WHEN a.status::text = 'ARRIVED' THEN 40
          WHEN wo.status = 'READY_FOR_PICKUP' OR a.status::text = 'READY_FOR_PICKUP' THEN 80
          ELSE 60
        END AS "sortRank",
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(NULLIF(a."workOrderId", ''), a.id)
          ORDER BY a."updatedAt" DESC, a."plannedStartAt" DESC, a.id DESC
        ) AS rn
      FROM "ServiceAppointment" a
      LEFT JOIN "WorkOrder" wo ON wo.id = a."workOrderId"
      LEFT JOIN "ServicePost" p ON p.id = a."postId"
      LEFT JOIN "DiagnosticVisitLink" dvl ON dvl."appointmentId" = a.id
      WHERE a."mechanicId" = ${mechanicId}
        AND a.status::text NOT IN ('CANCELLED', 'RESERVE', 'NO_SHOW')
        AND (
          (a."workOrderId" IS NULL AND a.status::text <> 'COMPLETED')
          OR (a."workOrderId" IS NOT NULL AND wo.id IS NOT NULL AND wo.status NOT IN ('CLOSED', 'CANCELLED'))
          OR (a."workOrderId" IS NOT NULL AND wo.id IS NULL AND a.status::text <> 'COMPLETED')
        )
        AND (
          a.source IS NULL OR a.source <> 'WALK_IN'
          OR a.status::text NOT IN ('ARRIVED', 'DIAGNOSTICS')
          OR NOT EXISTS (
            SELECT 1
            FROM "DiagnosticRequest" dr
            INNER JOIN "DiagnosticReview" review ON review."diagnosticRequestId" = dr.id
            WHERE review.state::text IN ('SUBMITTED', 'CONFIRMED')
              AND dr."createdAt" >= a."createdAt"
              AND (
                (a."leadId" IS NOT NULL AND dr."leadId" = a."leadId")
                OR (a."vehicleId" IS NOT NULL AND dr."vehicleId" = a."vehicleId")
              )
          )
        )
    )
    SELECT
      id,
      "caseKey",
      "vehicleId",
      "workOrderId",
      "diagnosticRequestId",
      "purpose",
      "appointmentStatus",
      "workOrderStatus",
      "vehicleLabel",
      "plateNumber",
      problem,
      "plannedStartAt",
      "plannedEndAt",
      "postName",
      "updatedAt"
    FROM ranked
    WHERE rn = 1
    ORDER BY
      "sortRank" ASC,
      "plannedStartAt" ASC,
      id ASC
  `;
}

/**
 * Returns every active planner appointment for a mechanic.
 * Unlike listActiveMechanicAssignments, this intentionally does not collapse
 * multiple appointments linked to the same work order: the mechanic's cabinet
 * must show every real future or overdue planner entry.
 */
export async function listAllActiveMechanicAppointments(mechanicId: string) {
  const prisma = getPrisma();
  return prisma.$queryRaw<ActiveMechanicAssignment[]>`
    SELECT
      a.id,
      COALESCE(NULLIF(a."workOrderId", ''), a.id) AS "caseKey",
      a."vehicleId",
      a."workOrderId",
      dvl."diagnosticRequestId",
      a.purpose::text AS "purpose",
      a.status::text AS "appointmentStatus",
      wo.status AS "workOrderStatus",
      a."vehicleLabel",
      a."plateNumber",
      a.problem,
      a."plannedStartAt",
      a."plannedEndAt",
      p.name AS "postName",
      a."updatedAt"
    FROM "ServiceAppointment" a
    LEFT JOIN "WorkOrder" wo ON wo.id = a."workOrderId"
    LEFT JOIN "ServicePost" p ON p.id = a."postId"
    LEFT JOIN "DiagnosticVisitLink" dvl ON dvl."appointmentId" = a.id
    WHERE a."mechanicId" = ${mechanicId}
      AND a.status::text NOT IN ('CANCELLED', 'RESERVE', 'NO_SHOW')
      AND (
        (a."workOrderId" IS NULL AND a.status::text <> 'COMPLETED')
        OR (a."workOrderId" IS NOT NULL AND wo.id IS NOT NULL AND wo.status NOT IN ('CLOSED', 'CANCELLED'))
        OR (a."workOrderId" IS NOT NULL AND wo.id IS NULL AND a.status::text <> 'COMPLETED')
      )
      AND (
        a.source IS NULL OR a.source <> 'WALK_IN'
        OR a.status::text NOT IN ('ARRIVED', 'DIAGNOSTICS')
        OR NOT EXISTS (
          SELECT 1
          FROM "DiagnosticRequest" dr
          INNER JOIN "DiagnosticReview" review ON review."diagnosticRequestId" = dr.id
          WHERE review.state::text IN ('SUBMITTED', 'CONFIRMED')
            AND dr."createdAt" >= a."createdAt"
            AND (
              (a."leadId" IS NOT NULL AND dr."leadId" = a."leadId")
              OR (a."vehicleId" IS NOT NULL AND dr."vehicleId" = a."vehicleId")
            )
        )
      )
    ORDER BY
      CASE
        WHEN wo.status = 'IN_REPAIR' OR a.status::text = 'IN_REPAIR' THEN 10
        WHEN wo.status = 'REWORK' THEN 20
        WHEN wo.status IN ('WAITING_PARTS', 'WAITING_APPROVAL', 'WAITING_QC', 'WAITING_PAYMENT') THEN 30
        WHEN a.status::text = 'WAITING_PAYMENT' THEN 30
        WHEN a.status::text = 'ARRIVED' THEN 40
        ELSE 60
      END,
      "plannedStartAt" ASC,
      id ASC
  `;
}

export function effectiveAssignmentStatus(assignment: Pick<ActiveMechanicAssignment, "appointmentStatus" | "workOrderStatus">) {
  return assignment.workOrderStatus || assignment.appointmentStatus;
}
