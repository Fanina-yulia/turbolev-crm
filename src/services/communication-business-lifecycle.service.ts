import "server-only";
import type { QueryResultRow } from "pg";
import { getSqlPool } from "@/src/lib/sql";

export type AutomaticCommunicationLifecycleState = "NEW" | "IN_WORK" | "CLOSED";

export type AutomaticCommunicationLifecycle = {
  state: AutomaticCommunicationLifecycleState;
  changedAt: Date;
};

type AutomaticLifecycleRow = QueryResultRow & {
  id: string;
  automaticState: AutomaticCommunicationLifecycleState;
  automaticChangedAt: Date;
};

/**
 * Resolves the communication status from the real service workflow in one batch.
 *
 * CLOSED means that a linked work order was physically issued (WorkOrder.CLOSED)
 * after the inquiry was received and has no outstanding customer receivable.
 * IN_WORK covers a booking, diagnostics, an open work order, or any other active
 * workshop stage. A manual lifecycle choice is handled by the lifecycle service;
 * this function deliberately returns only the automatic source of truth.
 */
export async function getAutomaticCommunicationLifecycles(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const result = new Map<string, AutomaticCommunicationLifecycle>();
  if (!uniqueIds.length) return result;

  const pool = getSqlPool();
  const query = await pool.query<AutomaticLifecycleRow>(
    `WITH targets AS (
       SELECT i."id",
              i."leadId",
              CASE
                WHEN i."phoneNormalized" ~ '^3800[0-9]{9}$' THEN '38' || SUBSTRING(i."phoneNormalized" FROM 4)
                ELSE i."phoneNormalized"
              END AS "phoneNormalized",
              i."plateNormalized",
              i."receivedAt"
         FROM "CommunicationInquiry" i
        WHERE i."id" = ANY($1::text[])
     ), client_context AS (
       SELECT t.*,
              ARRAY(
                SELECT matched."id"
                  FROM (
                    SELECT c."id"
                      FROM "Client" c
                     WHERE t."phoneNormalized" IS NOT NULL
                       AND c."phoneNormalized" = t."phoneNormalized"
                    UNION
                    SELECT cp."clientId" AS "id"
                      FROM "ClientPhone" cp
                     WHERE t."phoneNormalized" IS NOT NULL
                       AND cp."phoneNormalized" = t."phoneNormalized"
                  ) matched
              )::text[] AS "clientIds"
         FROM targets t
     ), context AS (
       SELECT c.*,
              ARRAY(
                SELECT v."id"
                  FROM "Vehicle" v
                 WHERE (c."plateNormalized" IS NOT NULL AND v."plateNormalized" = c."plateNormalized")
                    OR (c."plateNormalized" IS NULL AND v."clientId" = ANY(c."clientIds"))
              )::text[] AS "vehicleIds"
         FROM client_context c
     )
     SELECT c."id",
            CASE
              WHEN closed."changedAt" IS NOT NULL THEN 'CLOSED'
              WHEN active."changedAt" IS NOT NULL THEN 'IN_WORK'
              ELSE 'NEW'
            END AS "automaticState",
            GREATEST(c."receivedAt", closed."changedAt", active."changedAt") AS "automaticChangedAt"
       FROM context c
       LEFT JOIN LATERAL (
         SELECT MAX(wo."closedAt") AS "changedAt"
           FROM "WorkOrder" wo
           JOIN "DiagnosticRequest" dr ON dr."id" = wo."diagnosticRequestId"
          WHERE UPPER(wo."status") = 'CLOSED'
            AND wo."closedAt" IS NOT NULL
            AND wo."closedAt" >= c."receivedAt"
            AND (
              (c."leadId" IS NOT NULL AND dr."leadId" = c."leadId")
              OR (c."plateNormalized" IS NOT NULL AND wo."vehicleId" = ANY(c."vehicleIds"))
              OR (c."plateNormalized" IS NULL AND wo."clientId" = ANY(c."clientIds"))
            )
            AND NOT EXISTS (
              SELECT 1
                FROM "FinancialObligation" obligation
               WHERE obligation."workOrderId" = wo."id"
                 AND obligation."direction" = 'RECEIVABLE'
                 AND obligation."status" <> 'CANCELLED'
                 AND obligation."settledAmount" < obligation."amount"
            )
       ) closed ON TRUE
       LEFT JOIN LATERAL (
         SELECT MAX(events."changedAt") AS "changedAt"
           FROM (
             SELECT MAX(appointment."updatedAt") AS "changedAt"
               FROM "ServiceAppointment" appointment
              WHERE appointment."status" NOT IN ('COMPLETED', 'NO_SHOW', 'CANCELLED', 'RESERVE')
                AND (
                  (c."leadId" IS NOT NULL AND appointment."leadId" = c."leadId")
                  OR (
                    c."plateNormalized" IS NOT NULL
                    AND (
                      appointment."vehicleId" = ANY(c."vehicleIds")
                      OR UPPER(REGEXP_REPLACE(COALESCE(appointment."plateNumber", ''), '[^[:alnum:]]', '', 'g')) = c."plateNormalized"
                    )
                  )
                  OR (c."plateNormalized" IS NULL AND appointment."clientId" = ANY(c."clientIds"))
                  OR (
                    c."phoneNormalized" IS NOT NULL
                    AND CASE
                      WHEN REGEXP_REPLACE(COALESCE(appointment."phone", ''), '[^0-9]', '', 'g') ~ '^0[0-9]{9}$'
                        THEN '38' || REGEXP_REPLACE(appointment."phone", '[^0-9]', '', 'g')
                      WHEN REGEXP_REPLACE(COALESCE(appointment."phone", ''), '[^0-9]', '', 'g') ~ '^80[0-9]{9}$'
                        THEN '3' || REGEXP_REPLACE(appointment."phone", '[^0-9]', '', 'g')
                      ELSE REGEXP_REPLACE(COALESCE(appointment."phone", ''), '[^0-9]', '', 'g')
                    END = c."phoneNormalized"
                  )
                )
             UNION ALL
             SELECT MAX(diagnostic."updatedAt") AS "changedAt"
               FROM "DiagnosticRequest" diagnostic
              WHERE diagnostic."status" IN ('PENDING', 'IN_PROGRESS', 'CONFIRMED')
                AND (
                  (c."leadId" IS NOT NULL AND diagnostic."leadId" = c."leadId")
                  OR (c."plateNormalized" IS NOT NULL AND diagnostic."vehicleId" = ANY(c."vehicleIds"))
                  OR (c."plateNormalized" IS NULL AND diagnostic."clientId" = ANY(c."clientIds"))
                )
                AND NOT EXISTS (
                  SELECT 1
                    FROM "WorkOrder" diagnostic_order
                   WHERE diagnostic_order."diagnosticRequestId" = diagnostic."id"
                     AND UPPER(diagnostic_order."status") IN ('CLOSED', 'CANCELLED')
                )
             UNION ALL
             SELECT MAX(work_order."updatedAt") AS "changedAt"
               FROM "WorkOrder" work_order
               JOIN "DiagnosticRequest" work_order_diagnostic ON work_order_diagnostic."id" = work_order."diagnosticRequestId"
              WHERE UPPER(work_order."status") NOT IN ('CLOSED', 'CANCELLED')
                AND (
                  (c."leadId" IS NOT NULL AND work_order_diagnostic."leadId" = c."leadId")
                  OR (c."plateNormalized" IS NOT NULL AND work_order."vehicleId" = ANY(c."vehicleIds"))
                  OR (c."plateNormalized" IS NULL AND work_order."clientId" = ANY(c."clientIds"))
                )
           ) events
       ) active ON TRUE`,
    [uniqueIds],
  );

  for (const row of query.rows) {
    result.set(row.id, {
      state: row.automaticState,
      changedAt: row.automaticChangedAt,
    });
  }
  return result;
}
