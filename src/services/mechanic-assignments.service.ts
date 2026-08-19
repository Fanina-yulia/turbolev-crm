import { getPrisma } from "@/src/lib/prisma";

export type ActiveMechanicAssignment = {
  id: string;
  caseKey: string;
  vehicleId: string | null;
  workOrderId: string | null;
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
        a.status::text AS "appointmentStatus",
        wo.status AS "workOrderStatus",
        a."vehicleLabel",
        a."plateNumber",
        a.problem,
        a."plannedStartAt",
        a."plannedEndAt",
        p.name AS "postName",
        a."updatedAt",
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(NULLIF(a."workOrderId", ''), a.id)
          ORDER BY a."updatedAt" DESC, a."plannedStartAt" DESC, a.id DESC
        ) AS rn
      FROM "ServiceAppointment" a
      LEFT JOIN "WorkOrder" wo ON wo.id = a."workOrderId"
      LEFT JOIN "ServicePost" p ON p.id = a."postId"
      WHERE a."mechanicId" = ${mechanicId}
        AND a.status::text NOT IN ('CANCELLED', 'RESERVE', 'NO_SHOW')
        AND (
          (a."workOrderId" IS NULL AND a.status::text <> 'COMPLETED')
          OR (a."workOrderId" IS NOT NULL AND wo.id IS NOT NULL AND wo.status NOT IN ('CLOSED', 'CANCELLED'))
          OR (a."workOrderId" IS NOT NULL AND wo.id IS NULL AND a.status::text <> 'COMPLETED')
        )
    )
    SELECT
      id,
      "caseKey",
      "vehicleId",
      "workOrderId",
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
      CASE
        WHEN "workOrderStatus" = 'IN_REPAIR' OR "appointmentStatus" = 'IN_REPAIR' THEN 10
        WHEN "workOrderStatus" = 'REWORK' THEN 20
        WHEN "workOrderStatus" IN ('WAITING_PARTS', 'WAITING_APPROVAL', 'WAITING_QC', 'WAITING_PAYMENT') THEN 30
        WHEN "appointmentStatus" = 'ARRIVED' THEN 40
        WHEN "workOrderStatus" = 'READY_FOR_PICKUP' OR "appointmentStatus" = 'READY_FOR_PICKUP' THEN 80
        ELSE 60
      END,
      "plannedStartAt" ASC,
      id ASC
  `;
}

export function effectiveAssignmentStatus(assignment: Pick<ActiveMechanicAssignment, "appointmentStatus" | "workOrderStatus">) {
  return assignment.workOrderStatus || assignment.appointmentStatus;
}
