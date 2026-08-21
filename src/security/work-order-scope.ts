import "server-only";

import { getPrisma } from "@/src/lib/prisma";
import type { AccessContext } from "@/src/security/access-context";
import type { AccessScopeCode } from "@/src/security/permissions";

/**
 * Returns null for unrestricted ALL access, otherwise the exact WorkOrder IDs
 * visible to the current user. Visibility is derived from factual CRM links,
 * never from request-provided IDs alone.
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

    const [mechanics, assignedLeads] = await Promise.all([
      prisma.serviceMechanic.findMany({
        where: {
          userId,
          isActive: true,
          ...(context.locationIds.length ? { locationId: { in: context.locationIds } } : {}),
        },
        select: { id: true },
      }),
      prisma.lead.findMany({
        where: { assignedUserId: userId },
        select: { id: true },
        take: 10000,
      }),
    ]);
    const mechanicIds = mechanics.map((row) => row.id);
    const leadIds = assignedLeads.map((row) => row.id);

    const assignmentClauses: Array<Record<string, unknown>> = [{ createdById: userId }];
    if (leadIds.length) assignmentClauses.push({ leadId: { in: leadIds } });
    if (mechanicIds.length) assignmentClauses.push({ mechanicId: { in: mechanicIds } });

    const [appointments, diagnosticWorkOrders] = await Promise.all([
      prisma.serviceAppointment.findMany({
        where: { workOrderId: { not: null }, OR: assignmentClauses },
        select: { workOrderId: true },
        distinct: ["workOrderId"],
        take: 10000,
      }),
      leadIds.length
        ? prisma.workOrder.findMany({
            where: { diagnosticRequest: { leadId: { in: leadIds } } },
            select: { id: true },
            take: 10000,
          })
        : Promise.resolve([]),
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
