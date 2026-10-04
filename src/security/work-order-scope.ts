import "server-only";

import { Prisma } from "@/src/generated/prisma/client";
import { getWorkflowStatus, normalizeWorkflowStatus } from "@/src/domain/workflow";
import { getPrisma } from "@/src/lib/prisma";
import type { AccessContext } from "@/src/security/access-context";
import type { AccessScopeCode } from "@/src/security/permissions";

const MAX_VISIBLE_WORK_ORDER_IDS = 10_000;

type VisibleWorkOrderOptions = {
  limit?: number;
  status?: string | null;
  workOrderId?: string | null;
};

function boundedLimit(value?: number) {
  if (!Number.isFinite(value)) return MAX_VISIBLE_WORK_ORDER_IDS;
  return Math.max(1, Math.min(MAX_VISIBLE_WORK_ORDER_IDS, Math.floor(value!)));
}

function canonicalStatus(value?: string | null) {
  const raw = value?.trim().toUpperCase() || null;
  if (!raw) return { requested: false, value: null as string | null };
  const normalized = normalizeWorkflowStatus("WORK_ORDER", raw);
  return { requested: true, value: getWorkflowStatus("WORK_ORDER", normalized) ? normalized : null };
}

async function queryVisibleWorkOrderIds(
  context: AccessContext,
  scope: Exclude<AccessScopeCode, "ALL">,
  options: VisibleWorkOrderOptions = {},
) {
  const prisma = getPrisma();
  const limit = boundedLimit(options.limit);
  const status = canonicalStatus(options.status);
  if (status.requested && !status.value) return [] as string[];

  const statusSql = status.value ? Prisma.sql`AND wo."status" = ${status.value}` : Prisma.sql``;
  const idSql = options.workOrderId ? Prisma.sql`AND wo."id" = ${options.workOrderId}` : Prisma.sql``;

  if (scope === "LOCATION") {
    if (!context.locationIds.length) return [];
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT wo."id"
      FROM "WorkOrder" wo
      WHERE EXISTS (
        SELECT 1
        FROM "ServiceAppointment" sa
        WHERE sa."workOrderId" = wo."id"
          AND sa."locationId" IN (${Prisma.join(context.locationIds)})
      )
      ${statusSql}
      ${idSql}
      ORDER BY wo."closedAt" ASC NULLS LAST, wo."updatedAt" DESC
      LIMIT ${limit}
    `);
    return rows.map((row) => row.id);
  }

  if (scope === "ASSIGNED" || scope === "SELF" || scope === "TEAM") {
    const userId = context.user?.id;
    if (!userId) return [];
    const mechanicLocationSql = context.locationIds.length
      ? Prisma.sql`AND sm."locationId" IN (${Prisma.join(context.locationIds)})`
      : Prisma.sql``;

    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT wo."id"
      FROM "WorkOrder" wo
      WHERE (
        EXISTS (
          SELECT 1
          FROM "ServiceAppointment" sa
          WHERE sa."workOrderId" = wo."id"
            AND (
              sa."createdById" = ${userId}
              OR EXISTS (
                SELECT 1
                FROM "Lead" l
                WHERE l."id" = sa."leadId"
                  AND l."assignedUserId" = ${userId}
              )
              OR EXISTS (
                SELECT 1
                FROM "ServiceMechanic" sm
                WHERE sm."id" = sa."mechanicId"
                  AND sm."userId" = ${userId}
                  AND sm."isActive" = TRUE
                  ${mechanicLocationSql}
              )
            )
        )
        OR EXISTS (
          SELECT 1
          FROM "DiagnosticRequest" dr
          JOIN "Lead" dl ON dl."id" = dr."leadId"
          WHERE dr."id" = wo."diagnosticRequestId"
            AND dl."assignedUserId" = ${userId}
        )
      )
      ${statusSql}
      ${idSql}
      ORDER BY wo."closedAt" ASC NULLS LAST, wo."updatedAt" DESC
      LIMIT ${limit}
    `);
    return rows.map((row) => row.id);
  }

  return [];
}

/**
 * Returns null for unrestricted ALL access. Restricted scopes are resolved by
 * one PostgreSQL query using EXISTS predicates, rather than DB -> Node ID lists
 * -> DB WHERE IN(...) round-trips.
 */
export async function resolveVisibleWorkOrderIds(
  context: AccessContext,
  scope: AccessScopeCode | null,
  options: VisibleWorkOrderOptions = {},
) {
  if (scope === "ALL") return null;
  if (!scope) return [];
  return queryVisibleWorkOrderIds(context, scope, options);
}

/**
 * Single-row authorization probe. This deliberately never materializes the
 * caller's complete visible WorkOrder set.
 */
export async function canAccessWorkOrder(
  context: AccessContext,
  scope: AccessScopeCode | null,
  workOrderId: string,
) {
  if (scope === "ALL") return true;
  if (!scope || !workOrderId) return false;
  const visible = await queryVisibleWorkOrderIds(context, scope, { workOrderId, limit: 1 });
  return visible.length === 1;
}
