import "server-only";

import type { Prisma } from "@/src/generated/prisma/client";

type Tx = Prisma.TransactionClient;

type SyncArgs = {
  employeeId: string;
  firstName: string;
  lastName: string;
  position: string | null;
  staffRoleCode?: string | null;
  locationId?: string | null;
  userId?: string | null;
  isActive: boolean;
};

const POSITION_ROLE_MAP: Record<string, string> = {
  "власник": "OWNER",
  "виконавчий директор": "EXECUTIVE_DIRECTOR",
  "роп": "HEAD_OF_SALES",
  "керівник відділу продажів": "HEAD_OF_SALES",
  "продавець": "SALES",
  "підборщик": "PARTS_SPECIALIST",
  "підборщик запчастин": "PARTS_SPECIALIST",
  "завідувач станцією": "STATION_MANAGER",
  "сервіс-менеджер": "SERVICE_ADVISOR",
  "сервіс менеджер": "SERVICE_ADVISOR",
  "майстер-приймальник": "SERVICE_ADVISOR",
  "майстер приймальник": "SERVICE_ADVISOR",
  "автомеханік": "MECHANIC",
  "майстер": "MECHANIC",
  "бухгалтер": "ACCOUNTANT",
  "it / адміністратор": "ADMINISTRATOR",
  "адміністратор": "ADMINISTRATOR",
};

function clean(value: unknown) {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next || null;
}

export function inferStaffRoleCode(position?: string | null) {
  const normalized = clean(position)?.toLocaleLowerCase("uk-UA") ?? "";
  return POSITION_ROLE_MAP[normalized] ?? null;
}

async function resolveLocationId(tx: Tx, requestedLocationId: string | null, roleCode: string | null) {
  if (requestedLocationId) {
    const location = await tx.serviceLocation.findFirst({
      where: { id: requestedLocationId, isActive: true },
      select: { id: true },
    });
    if (!location) throw new Error("PERSONNEL_LOCATION_NOT_FOUND");
    return location.id;
  }

  if (roleCode !== "MECHANIC") return null;
  const firstLocation = await tx.serviceLocation.findFirst({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  if (!firstLocation) throw new Error("PERSONNEL_LOCATION_REQUIRED");
  return firstLocation.id;
}

export async function syncEmployeeOperationalContext(tx: Tx, args: SyncArgs) {
  const explicitRole = clean(args.staffRoleCode)?.toUpperCase() ?? null;
  const roleCode = explicitRole || inferStaffRoleCode(args.position);
  const locationId = await resolveLocationId(tx, clean(args.locationId), roleCode);
  const now = new Date();

  const currentPrimary = await tx.employeeRoleAssignment.findFirst({
    where: {
      employeeId: args.employeeId,
      isPrimary: true,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    include: { role: { select: { id: true, code: true } } },
    orderBy: { startsAt: "desc" },
  });

  let roleId: string | null = null;
  if (roleCode) {
    const role = await tx.staffRole.findFirst({
      where: { code: roleCode, isActive: true },
      select: { id: true, code: true },
    });
    if (!role) throw new Error("PERSONNEL_ROLE_NOT_FOUND");
    roleId = role.id;

    const unchanged = currentPrimary?.role.code === role.code && currentPrimary.locationId === locationId;
    if (!unchanged) {
      if (currentPrimary) {
        await tx.employeeRoleAssignment.update({ where: { id: currentPrimary.id }, data: { endsAt: now } });
      }
      await tx.employeeRoleAssignment.create({
        data: {
          employeeId: args.employeeId,
          roleId: role.id,
          locationId,
          isPrimary: true,
          startsAt: now,
        },
      });
    }
  } else if (currentPrimary) {
    await tx.employeeRoleAssignment.update({ where: { id: currentPrimary.id }, data: { endsAt: now } });
  }

  const fullName = `${args.firstName} ${args.lastName}`.replace(/\s+/g, " ").trim();
  const shouldBePlannerMechanic = args.isActive && roleCode === "MECHANIC" && Boolean(locationId);

  if (shouldBePlannerMechanic && locationId) {
    await tx.serviceMechanic.updateMany({
      where: { employeeId: args.employeeId, locationId: { not: locationId }, isActive: true },
      data: { isActive: false },
    });

    await tx.serviceMechanic.upsert({
      where: { locationId_employeeId: { locationId, employeeId: args.employeeId } },
      create: {
        locationId,
        employeeId: args.employeeId,
        userId: args.userId ?? null,
        name: fullName,
        isActive: true,
        sortOrder: 100,
      },
      update: {
        userId: args.userId ?? null,
        name: fullName,
        isActive: true,
      },
    });
  } else {
    await tx.serviceMechanic.updateMany({
      where: { employeeId: args.employeeId, isActive: true },
      data: { isActive: false },
    });
  }

  return { roleCode, roleId, locationId, plannerMechanic: shouldBePlannerMechanic };
}

export async function deactivateEmployeePlannerResources(tx: Tx, employeeId: string) {
  await tx.serviceMechanic.updateMany({
    where: { employeeId, isActive: true },
    data: { isActive: false },
  });
}
