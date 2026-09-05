import type { AuthorizationResult } from "@/src/security/authorize";
import { getPrisma } from "@/src/lib/prisma";

/**
 * Row-level access for diagnostic documents. Permission checks happen in the
 * route with authorize(); this helper makes sure the selected diagnostic also
 * belongs to the caller's mechanic assignment or visible service location.
 */
export async function assertDiagnosticScope(access: AuthorizationResult, diagnosticRequestId: string) {
  if (!access.context.user) return false;
  const prisma = getPrisma();
  const [diagnostic, assignment] = await Promise.all([
    prisma.diagnosticRequest.findUnique({ where: { id: diagnosticRequestId }, select: { id: true, vehicleId: true, leadId: true } }),
    prisma.diagnosticAssignment.findUnique({ where: { diagnosticRequestId }, select: { mechanicId: true, locationId: true } }),
  ]);
  if (!diagnostic) return false;

  if (access.context.roles.some((role) => role.code === "MECHANIC")) {
    const mechanic = await prisma.serviceMechanic.findFirst({ where: { userId: access.context.user.id, isActive: true }, select: { id: true } });
    if (assignment) return Boolean(mechanic && assignment.mechanicId === mechanic.id);
    if (!mechanic) return false;
    const appointment = await prisma.serviceAppointment.findFirst({
      where: {
        mechanicId: mechanic.id,
        status: { notIn: ["CANCELLED", "NO_SHOW", "RESERVE", "COMPLETED"] },
        OR: [
          ...(diagnostic.vehicleId ? [{ vehicleId: diagnostic.vehicleId }] : []),
          ...(diagnostic.leadId ? [{ leadId: diagnostic.leadId }] : []),
        ],
      },
      select: { id: true },
    });
    return Boolean(appointment);
  }

  if (access.shadowBypass || access.grantedScope === "ALL") return true;
  return Boolean(assignment?.locationId && access.context.locationIds.includes(assignment.locationId));
}
