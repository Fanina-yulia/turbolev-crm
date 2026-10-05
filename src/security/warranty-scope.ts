import "server-only";

import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import type { AccessContext } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";

type WarrantyPermission = typeof PERMISSIONS.WARRANTY_READ | typeof PERMISSIONS.WARRANTY_WRITE;

function warrantyLocationIds(context: AccessContext, permission: WarrantyPermission) {
  if (context.enforcementMode !== "ENFORCED") return null;
  const scope = context.permissions[permission] as AccessScopeCode | undefined;
  if (scope === "ALL") return null;
  if (scope === "LOCATION" || scope === "TEAM") {
    return [...new Set(context.locationIds.filter(Boolean))];
  }
  return [] as string[];
}

export async function canAccessWarrantyWorkOrder(
  context: AccessContext,
  permission: WarrantyPermission,
  workOrderId: string,
) {
  const locationIds = warrantyLocationIds(context, permission);
  if (locationIds === null) return true;
  if (!locationIds.length || !workOrderId) return false;

  const rows = await getPrisma().$queryRaw<Array<{ allowed: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM "ServiceAppointment" sa
      WHERE sa."workOrderId" = ${workOrderId}
        AND sa."locationId" IN (${Prisma.join(locationIds)})
    ) AS allowed
  `);
  return rows[0]?.allowed === true;
}

export async function findWarrantyLineIdsForRead(args: {
  context: AccessContext;
  q?: string | null;
  requestedWorkOrderId?: string | null;
  exactWorkOrderId?: string | null;
  limit?: number;
}) {
  const locationIds = warrantyLocationIds(args.context, PERMISSIONS.WARRANTY_READ);
  if (locationIds === null) return null;
  if (!locationIds.length) return [] as string[];

  const q = String(args.q || "").trim();
  const phoneQuery = q.replace(/\D+/g, "") || q;
  const requestedSql = args.requestedWorkOrderId
    ? Prisma.sql`AND wol."workOrderId" = ${args.requestedWorkOrderId}`
    : Prisma.sql``;
  const searchSql = q
    ? Prisma.sql`
        AND (
          ${args.exactWorkOrderId ? Prisma.sql`wol."workOrderId" = ${args.exactWorkOrderId} OR` : Prisma.sql``}
          wol."description" ILIKE ${`%${q}%`}
          OR c."name" ILIKE ${`%${q}%`}
          OR c."phone" LIKE ${`%${phoneQuery}%`}
          OR v."plateNumber" ILIKE ${`%${q}%`}
          OR v."vin" ILIKE ${`%${q}%`}
          OR v."brand" ILIKE ${`%${q}%`}
          OR v."model" ILIKE ${`%${q}%`}
        )
      `
    : Prisma.sql``;
  const limit = Math.max(1, Math.min(500, Math.trunc(args.limit || 500)));

  const rows = await getPrisma().$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT wol."id"
    FROM "WorkOrderLine" wol
    JOIN "WorkOrder" wo ON wo."id" = wol."workOrderId"
    JOIN "Client" c ON c."id" = wo."clientId"
    JOIN "Vehicle" v ON v."id" = wo."vehicleId"
    WHERE wol."type" = 'LABOR'
      AND wol."status" = 'COMPLETED'
      AND wo."closedAt" IS NOT NULL
      AND (wol."warrantyKm" > 0 OR wol."warrantyDays" > 0)
      AND EXISTS (
        SELECT 1
        FROM "ServiceAppointment" sa
        WHERE sa."workOrderId" = wol."workOrderId"
          AND sa."locationId" IN (${Prisma.join(locationIds)})
      )
      ${requestedSql}
      ${searchSql}
    ORDER BY wol."warrantyEndsAt" ASC NULLS LAST, wol."completedAt" DESC NULLS LAST
    LIMIT ${limit}
  `);
  return rows.map((row) => row.id);
}
