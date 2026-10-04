import "server-only";

import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";

function normalizeLocationIds(locationIds: string[]) {
  return [...new Set(locationIds.map((id) => String(id || "").trim()).filter(Boolean))];
}

export async function findLocationScopedOpenWorkOrderIds(locationIds: string[], limit = 1000) {
  const ids = normalizeLocationIds(locationIds);
  if (!ids.length) return [] as string[];
  const take = Math.max(1, Math.min(10_000, Math.floor(limit)));
  const rows = await getPrisma().$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT wo."id"
    FROM "WorkOrder" wo
    WHERE wo."status" <> 'CLOSED'
      AND LEFT(wo."id", 5) <> 'demo_'
      AND EXISTS (
        SELECT 1
        FROM "ServiceAppointment" sa
        WHERE sa."workOrderId" = wo."id"
          AND sa."locationId" IN (${Prisma.join(ids)})
          AND LEFT(sa."id", 5) <> 'demo_'
      )
    LIMIT ${take}
  `);
  return rows.map((row) => row.id);
}

export async function findLocationScopedClosedWorkOrders(
  locationIds: string[],
  from: Date,
  to: Date,
) {
  const ids = normalizeLocationIds(locationIds);
  if (!ids.length) return [] as Array<{ id: string; clientId: string; closedAt: Date | null }>;
  return getPrisma().$queryRaw<Array<{ id: string; clientId: string; closedAt: Date | null }>>(Prisma.sql`
    SELECT wo."id", wo."clientId", wo."closedAt"
    FROM "WorkOrder" wo
    WHERE wo."status" = 'CLOSED'
      AND wo."closedAt" >= ${from}
      AND wo."closedAt" < ${to}
      AND LEFT(wo."id", 5) <> 'demo_'
      AND EXISTS (
        SELECT 1
        FROM "ServiceAppointment" sa
        WHERE sa."workOrderId" = wo."id"
          AND sa."locationId" IN (${Prisma.join(ids)})
          AND LEFT(sa."id", 5) <> 'demo_'
      )
  `);
}

export async function findLocationScopedClosedClientIdsBefore(
  locationIds: string[],
  before: Date,
  clientIds?: string[],
) {
  const ids = normalizeLocationIds(locationIds);
  if (!ids.length) return [] as string[];
  const clients = clientIds ? [...new Set(clientIds.filter(Boolean))] : null;
  if (clients && !clients.length) return [];

  const clientFilter = clients
    ? Prisma.sql`AND wo."clientId" IN (${Prisma.join(clients)})`
    : Prisma.sql``;

  const rows = await getPrisma().$queryRaw<Array<{ clientId: string }>>(Prisma.sql`
    SELECT DISTINCT wo."clientId"
    FROM "WorkOrder" wo
    WHERE wo."status" = 'CLOSED'
      AND wo."closedAt" < ${before}
      AND LEFT(wo."id", 5) <> 'demo_'
      ${clientFilter}
      AND EXISTS (
        SELECT 1
        FROM "ServiceAppointment" sa
        WHERE sa."workOrderId" = wo."id"
          AND sa."locationId" IN (${Prisma.join(ids)})
          AND LEFT(sa."id", 5) <> 'demo_'
      )
  `);
  return rows.map((row) => row.clientId);
}

export async function findLocationScopedCompletedLaborLines(
  locationIds: string[],
  from: Date,
  to: Date,
) {
  const ids = normalizeLocationIds(locationIds);
  if (!ids.length) return [] as Array<{ mechanicId: string | null; workOrderId: string; laborHours: Prisma.Decimal | null }>;
  return getPrisma().$queryRaw<Array<{ mechanicId: string | null; workOrderId: string; laborHours: Prisma.Decimal | null }>>(Prisma.sql`
    SELECT wl."mechanicId", wl."workOrderId", wl."laborHours"
    FROM "WorkOrderLine" wl
    WHERE wl."type" = 'LABOR'
      AND wl."status" = 'COMPLETED'
      AND wl."completedAt" >= ${from}
      AND wl."completedAt" < ${to}
      AND wl."mechanicId" IS NOT NULL
      AND LEFT(wl."workOrderId", 5) <> 'demo_'
      AND EXISTS (
        SELECT 1
        FROM "ServiceAppointment" sa
        WHERE sa."workOrderId" = wl."workOrderId"
          AND sa."locationId" IN (${Prisma.join(ids)})
          AND LEFT(sa."id", 5) <> 'demo_'
      )
  `);
}
