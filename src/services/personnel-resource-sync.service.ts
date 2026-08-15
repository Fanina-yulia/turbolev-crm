import "server-only";

import type { Prisma } from "@/src/generated/prisma/client";

type Tx = Prisma.TransactionClient;

type SyncArgs = {
  employeeId: string;
  firstName: string;
  lastName: string;
  roleCode: string | null;
  locationId: string | null;
  userId?: string | null;
  isActive: boolean;
  preferredMechanicId?: string | null;
};

export async function syncEmployeePlannerResource(tx: Tx, args: SyncArgs) {
  const fullName = `${args.firstName} ${args.lastName}`.replace(/\s+/g, " ").trim();
  const shouldBeMechanic = args.isActive && args.roleCode === "MECHANIC" && Boolean(args.locationId);

  if (!shouldBeMechanic || !args.locationId) {
    await tx.serviceMechanic.updateMany({
      where: {
        OR: [
          { employeeId: args.employeeId },
          ...(args.userId ? [{ userId: args.userId }] : []),
        ],
        isActive: true,
      },
      data: { isActive: false },
    });
    return null;
  }

  const existingByEmployee = await tx.serviceMechanic.findFirst({
    where: { employeeId: args.employeeId, locationId: args.locationId },
  });
  if (existingByEmployee) {
    return tx.serviceMechanic.update({
      where: { id: existingByEmployee.id },
      data: { name: fullName, userId: args.userId ?? existingByEmployee.userId, isActive: true },
    });
  }

  if (args.preferredMechanicId) {
    const preferred = await tx.serviceMechanic.findUnique({ where: { id: args.preferredMechanicId } });
    if (!preferred) throw new Error("MECHANIC_RESOURCE_NOT_FOUND");
    if (preferred.locationId !== args.locationId) throw new Error("MECHANIC_LOCATION_MISMATCH");
    if (preferred.employeeId && preferred.employeeId !== args.employeeId) throw new Error("MECHANIC_RESOURCE_BUSY");
    if (preferred.userId && args.userId && preferred.userId !== args.userId) throw new Error("MECHANIC_RESOURCE_BUSY");
    return tx.serviceMechanic.update({
      where: { id: preferred.id },
      data: { employeeId: args.employeeId, userId: args.userId ?? preferred.userId, name: fullName, isActive: true },
    });
  }

  if (args.userId) {
    const existingByUser = await tx.serviceMechanic.findFirst({ where: { userId: args.userId, locationId: args.locationId } });
    if (existingByUser && !existingByUser.employeeId) {
      return tx.serviceMechanic.update({
        where: { id: existingByUser.id },
        data: { employeeId: args.employeeId, name: fullName, isActive: true },
      });
    }
  }

  return tx.serviceMechanic.create({
    data: {
      locationId: args.locationId,
      employeeId: args.employeeId,
      userId: args.userId ?? null,
      name: fullName,
      isActive: true,
      sortOrder: 100,
    },
  });
}

export async function deactivateEmployeePlannerResources(tx: Tx, employeeId: string) {
  await tx.serviceMechanic.updateMany({ where: { employeeId, isActive: true }, data: { isActive: false } });
}
