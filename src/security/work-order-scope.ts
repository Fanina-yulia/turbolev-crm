import "server-only";

import { getPrisma } from "@/src/lib/prisma";
import type { AccessContext } from "@/src/security/access-context";
import type { AccessScopeCode } from "@/src/security/permissions";

/**
 * Returns null for unrestricted ALL access, otherwise the exact WorkOrder IDs
 * visible to the current user. The resolver intentionally derives visibility
 * from factual CRM links instead of trusting request query parameters.
 */
export async function resolveVisibleWorkOrderIds(context: AccessContext, scope: AccessScopeCode | null) {
  if (scope === "ALL") return null;
  const prisma = getPrisma();

  if (scope === "LOCATION") {
    if (!context.locationIds.length) return [];
    const appointments = await prisma.serviceAppointment.findMany({
      where: { locationId: { in: context.locationIds }, workOrderId: { not: null } },
      select: { workOrderId: true },
      distinct: ["workOrderId"],
      take: 10000,
    });
    return appointments.map((row) => row.workOrderId).filter((value): value is string => Boolean(value));
  }

  if (scope === "ASSIGNED" || scope === "SELF" || scope === "TEAM") {
    const userId = context.user?.id;
    if (!userId) return [];
    const ids = new Set<string>();

    const mechanics = await prisma.serviceMechanic.findMany({
      where: {
        userId,
        isActive: true,
        ...(context.locationIds.length ? { locationId: { in: context.locationIds } } : {}),
      },
      select: { id: true },
    });
    const mechanicIds = mechanics.map((row) => row.id);

    const [appointments, diagnosticWorkOrders] = await Promise.all([
      prisma.serviceAppointment.findMany({
        where: {
          workOrderId: { not: null },
          OR: [
            { createdById: userId },
            { leadId: { not: null }, AND: { leadId: { in: (await prisma.lead.findMany({ where: { assignedUserId: userId }, select: { id: true }, take: 10000 })).map((lead) => lead.id) } } },
            ...(mechanicIds.length ? [{ mechanicId: { in: mechanicIds } }] : []),
          ],
        },
        select: { workOrderId: true },
        distinct: ["workOrderId"],
        take: 10000,
      }),
      prisma.workOrder.findMany({
        where: { diagnosticRequest: { lead: { assignedUserId: userId } } },
        select: { id: true },
        take: 10000,
      }),
    ]);

    for (const row of appointments) if (row.workOrderId) ids.add(row.workOrderId);
    for (const row of diagnosticWorkOrders) ids.add(row.id);
    return [...ids];
  }

  return [];
}

export async function canAccessWorkOrder(context: AccessContext, scope: AccessScopeCode | null, workOrderId: string) {
  const visibleIds = await resolveVisibleWorkOrderIds(context, scope);
  return visibleIds === null || visibleIds.includes(workOrderId);
}
