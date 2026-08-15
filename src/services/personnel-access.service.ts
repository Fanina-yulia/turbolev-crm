import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import type { AccessContext } from "@/src/security/access-context";
import type { AccessScopeCode } from "@/src/security/permissions";
import { writeAuditEvent } from "@/src/services/audit.service";

const SYSTEM_ROLE_CODES = [
  "OWNER",
  "EXECUTIVE_DIRECTOR",
  "HEAD_OF_SALES",
  "SALES",
  "PARTS_SPECIALIST",
  "STATION_MANAGER",
  "MECHANIC",
  "ACCOUNTANT",
  "ADMINISTRATOR",
] as const;

type SystemRoleCode = (typeof SYSTEM_ROLE_CODES)[number];
type Tx = Prisma.TransactionClient;

const GLOBAL_ROLES = new Set<SystemRoleCode>(["OWNER", "EXECUTIVE_DIRECTOR", "HEAD_OF_SALES", "ACCOUNTANT"]);
const STATION_MANAGER_DELEGATION = new Set<SystemRoleCode>(["MECHANIC", "PARTS_SPECIALIST", "ADMINISTRATOR"]);

export class PersonnelAccessError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "PersonnelAccessError";
    this.code = code;
    this.status = status;
  }
}

function isSystemRoleCode(value: string): value is SystemRoleCode {
  return (SYSTEM_ROLE_CODES as readonly string[]).includes(value);
}

function normalizeRoleCode(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function roleCodes(context: AccessContext) {
  return new Set(context.roles.map((role) => role.code));
}

export function delegatableRoleCodes(context: AccessContext): SystemRoleCode[] {
  const roles = roleCodes(context);
  if (roles.has("OWNER")) return [...SYSTEM_ROLE_CODES];
  if (roles.has("EXECUTIVE_DIRECTOR")) return SYSTEM_ROLE_CODES.filter((code) => code !== "OWNER");
  if (roles.has("STATION_MANAGER")) return SYSTEM_ROLE_CODES.filter((code) => STATION_MANAGER_DELEGATION.has(code));
  return [];
}

function hasGlobalPersonnelAuthority(context: AccessContext, grantedScope: AccessScopeCode | null) {
  const roles = roleCodes(context);
  return grantedScope === "ALL" && (roles.has("OWNER") || roles.has("EXECUTIVE_DIRECTOR"));
}

function allowedLocationIds(context: AccessContext, grantedScope: AccessScopeCode | null) {
  return grantedScope === "ALL" ? null : context.locationIds;
}

function assertRoleDelegation(context: AccessContext, roleCode: string) {
  if (!isSystemRoleCode(roleCode)) throw new PersonnelAccessError("UNKNOWN_ROLE", "Невідома системна посада.");
  if (!delegatableRoleCodes(context).includes(roleCode)) {
    throw new PersonnelAccessError("ROLE_DELEGATION_FORBIDDEN", "Ваша роль не може призначати цю посаду.", 403);
  }
  return roleCode;
}

async function assertLocation(tx: Tx, context: AccessContext, grantedScope: AccessScopeCode | null, roleCode: SystemRoleCode, locationId: string | null) {
  if (GLOBAL_ROLES.has(roleCode)) return null;
  if (!locationId) throw new PersonnelAccessError("LOCATION_REQUIRED", "Для цієї посади оберіть станцію.");
  const location = await tx.serviceLocation.findFirst({ where: { id: locationId, isActive: true }, select: { id: true, name: true } });
  if (!location) throw new PersonnelAccessError("LOCATION_NOT_FOUND", "Станцію не знайдено.", 404);
  const allowed = allowedLocationIds(context, grantedScope);
  if (allowed && !allowed.includes(locationId)) {
    throw new PersonnelAccessError("LOCATION_FORBIDDEN", "Можна керувати працівниками лише своєї станції.", 403);
  }
  return location;
}

export function personnelScopeWhere(context: AccessContext, grantedScope: AccessScopeCode | null) {
  const now = new Date();
  if (grantedScope === "ALL") return {};
  if (grantedScope === "LOCATION") {
    if (!context.locationIds.length) return { id: "__NO_LOCATION__" };
    return {
      roleAssignments: {
        some: {
          locationId: { in: context.locationIds },
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      },
    };
  }
  return context.user?.employeeId ? { id: context.user.employeeId } : { id: "__NO_EMPLOYEE__" };
}

export async function getPersonnelAccessCatalog(context: AccessContext, grantedScope: AccessScopeCode | null) {
  const prisma = getPrisma();
  const allowedCodes = delegatableRoleCodes(context);
  if (!allowedCodes.length) throw new PersonnelAccessError("PERSONNEL_DELEGATION_FORBIDDEN", "Для Вашої ролі не налаштовано делеговане додавання працівників.", 403);
  const locationFilter = allowedLocationIds(context, grantedScope);
  const [staffRoles, accessRoles, locations, mechanics] = await Promise.all([
    prisma.staffRole.findMany({ where: { code: { in: allowedCodes }, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.accessRole.findMany({ where: { code: { in: allowedCodes }, isActive: true }, select: { code: true, name: true, description: true } }),
    prisma.serviceLocation.findMany({ where: { isActive: true, ...(locationFilter ? { id: { in: locationFilter } } : {}) }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.serviceMechanic.findMany({
      where: {
        isActive: true,
        userId: null,
        ...(locationFilter ? { locationId: { in: locationFilter } } : {}),
      },
      select: { id: true, name: true, locationId: true },
      orderBy: [{ locationId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);
  const accessByCode = new Map(accessRoles.map((role) => [role.code, role]));
  return {
    grantedScope,
    managerRoles: context.roles.map((role) => role.code),
    roles: staffRoles.filter((role) => accessByCode.has(role.code)).map((role) => ({
      code: role.code,
      name: role.name,
      category: role.category,
      requiresLocation: !GLOBAL_ROLES.has(role.code as SystemRoleCode),
      accessDescription: accessByCode.get(role.code)?.description ?? null,
    })),
    locations,
    unlinkedMechanics: mechanics,
  };
}

async function currentPrimaryRole(tx: Tx, employeeId: string) {
  const now = new Date();
  return tx.employeeRoleAssignment.findFirst({
    where: {
      employeeId,
      isPrimary: true,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    include: { role: true, location: { select: { id: true, name: true } } },
    orderBy: { startsAt: "desc" },
  });
}

async function assertTargetWithinManagerScope(tx: Tx, employeeId: string, context: AccessContext, grantedScope: AccessScopeCode | null) {
  if (hasGlobalPersonnelAuthority(context, grantedScope)) return;
  const assignment = await currentPrimaryRole(tx, employeeId);
  if (!assignment) return;
  if (!assignment.locationId || !context.locationIds.includes(assignment.locationId)) {
    throw new PersonnelAccessError("EMPLOYEE_SCOPE_FORBIDDEN", "Цей працівник належить до іншої станції.", 403);
  }
}

async function syncPrimaryStaffRole(tx: Tx, employeeId: string, roleCode: SystemRoleCode, locationId: string | null) {
  const role = await tx.staffRole.findUnique({ where: { code: roleCode } });
  if (!role || !role.isActive) throw new PersonnelAccessError("STAFF_ROLE_NOT_FOUND", "Системну посаду не знайдено.", 404);
  const now = new Date();
  const active = await tx.employeeRoleAssignment.findMany({
    where: { employeeId, isPrimary: true, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
  });
  const same = active.find((item) => item.roleId === role.id && (item.locationId ?? null) === locationId);
  for (const assignment of active) {
    if (same && assignment.id === same.id) continue;
    await tx.employeeRoleAssignment.update({ where: { id: assignment.id }, data: { endsAt: now, isPrimary: false } });
  }
  if (!same) {
    await tx.employeeRoleAssignment.create({ data: { employeeId, roleId: role.id, locationId, startsAt: now, isPrimary: true } });
  } else if (!same.isPrimary || same.endsAt) {
    await tx.employeeRoleAssignment.update({ where: { id: same.id }, data: { isPrimary: true, endsAt: null } });
  }
  await tx.employeeProfile.update({ where: { id: employeeId }, data: { position: role.name } });
  return role;
}

async function ensureNotLastOwner(tx: Tx, userId: string, nextRoleCode: SystemRoleCode | null, nextActive: boolean) {
  const ownerRole = await tx.accessRole.findUnique({ where: { code: "OWNER" }, select: { id: true } });
  if (!ownerRole) return;
  const currentOwner = await tx.userAccessRole.findFirst({ where: { userId, roleId: ownerRole.id, isActive: true }, select: { id: true } });
  if (!currentOwner) return;
  if (nextActive && nextRoleCode === "OWNER") return;
  const otherOwners = await tx.userAccessRole.count({
    where: {
      roleId: ownerRole.id,
      userId: { not: userId },
      isActive: true,
      user: { isActive: true },
      startsAt: { lte: new Date() },
      OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
    },
  });
  if (!otherOwners) throw new PersonnelAccessError("LAST_OWNER_PROTECTED", "Не можна забрати доступ у останнього активного Власника.", 409);
}

async function ensureUserForEmployee(tx: Tx, employee: { id: string; userId: string | null; firstName: string; lastName: string; email: string | null }, roleCode: SystemRoleCode, locationId: string | null) {
  const email = String(employee.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) throw new PersonnelAccessError("EMAIL_REQUIRED_FOR_CABINET", "Щоб відкрити кабінет, вкажіть коректний e-mail працівника.");
  const name = `${employee.firstName} ${employee.lastName}`.trim();
  let user = employee.userId ? await tx.user.findUnique({ where: { id: employee.userId }, include: { employeeProfile: true } }) : null;
  if (!user) {
    user = await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, include: { employeeProfile: true } });
  }
  if (user?.employeeProfile && user.employeeProfile.id !== employee.id) {
    throw new PersonnelAccessError("EMAIL_ALREADY_USED", "Цей e-mail уже належить іншому працівнику CRM.", 409);
  }
  if (!user) {
    user = await tx.user.create({ data: { name, email, isActive: true }, include: { employeeProfile: true } });
  } else {
    const emailChanged = String(user.email || "").trim().toLowerCase() !== email;
    user = await tx.user.update({
      where: { id: user.id },
      data: { name, email, isActive: true, ...(emailChanged && user.authUserId ? { authUserId: null, lastLoginAt: null, lastSeenAt: null } : {}) },
      include: { employeeProfile: true },
    });
  }
  if (employee.userId !== user.id) await tx.employeeProfile.update({ where: { id: employee.id }, data: { userId: user.id } });

  const accessRole = await tx.accessRole.findUnique({ where: { code: roleCode } });
  if (!accessRole || !accessRole.isActive) throw new PersonnelAccessError("ACCESS_ROLE_NOT_FOUND", "Для цієї посади ще не налаштована роль доступу.", 409);
  await ensureNotLastOwner(tx, user.id, roleCode, true);
  const now = new Date();
  const primary = await tx.userAccessRole.findMany({ where: { userId: user.id, isPrimary: true, isActive: true } });
  const same = primary.find((item) => item.roleId === accessRole.id && (item.locationId ?? null) === locationId);
  for (const assignment of primary) {
    if (same && assignment.id === same.id) continue;
    await tx.userAccessRole.update({ where: { id: assignment.id }, data: { isActive: false, isPrimary: false, endsAt: now } });
  }
  if (same) {
    await tx.userAccessRole.update({ where: { id: same.id }, data: { isActive: true, isPrimary: true, startsAt: same.startsAt ?? now, endsAt: null, reason: "Personnel management" } });
  } else {
    const existing = await tx.userAccessRole.findFirst({ where: { userId: user.id, roleId: accessRole.id, locationId } });
    if (existing) {
      await tx.userAccessRole.update({ where: { id: existing.id }, data: { isActive: true, isPrimary: true, startsAt: now, endsAt: null, reason: "Personnel management" } });
    } else {
      await tx.userAccessRole.create({ data: { userId: user.id, roleId: accessRole.id, locationId, isPrimary: true, isActive: true, reason: "Personnel management" } });
    }
  }
  return user;
}

async function syncMechanicResource(tx: Tx, userId: string, employeeName: string, roleCode: SystemRoleCode, locationId: string | null, mechanicResourceId?: string | null) {
  const existingByUser = await tx.serviceMechanic.findFirst({ where: { userId } });
  if (roleCode !== "MECHANIC") {
    if (existingByUser?.isActive) await tx.serviceMechanic.update({ where: { id: existingByUser.id }, data: { isActive: false } });
    return null;
  }
  if (!locationId) throw new PersonnelAccessError("LOCATION_REQUIRED", "Для автомеханіка потрібна станція.");
  if (mechanicResourceId) {
    const resource = await tx.serviceMechanic.findUnique({ where: { id: mechanicResourceId } });
    if (!resource) throw new PersonnelAccessError("MECHANIC_RESOURCE_NOT_FOUND", "Ресурс механіка не знайдено.", 404);
    if (resource.locationId !== locationId) throw new PersonnelAccessError("MECHANIC_LOCATION_MISMATCH", "Ресурс механіка належить іншій станції.", 409);
    if (resource.userId && resource.userId !== userId) throw new PersonnelAccessError("MECHANIC_RESOURCE_BUSY", "Цей ресурс уже прив’язаний до іншого працівника.", 409);
    if (existingByUser && existingByUser.id !== resource.id) await tx.serviceMechanic.update({ where: { id: existingByUser.id }, data: { isActive: false, userId: null } });
    return tx.serviceMechanic.update({ where: { id: resource.id }, data: { userId, name: employeeName, isActive: true } });
  }
  if (existingByUser) {
    return tx.serviceMechanic.update({ where: { id: existingByUser.id }, data: { locationId, name: employeeName, isActive: true } });
  }
  return tx.serviceMechanic.create({ data: { id: randomUUID(), locationId, userId, name: employeeName, isActive: true } });
}

export async function configureEmployeeAccess(args: {
  employeeId: string;
  roleCode: string;
  locationId?: string | null;
  cabinetEnabled: boolean;
  mechanicResourceId?: string | null;
  context: AccessContext;
  grantedScope: AccessScopeCode | null;
}) {
  const prisma = getPrisma();
  const roleCode = assertRoleDelegation(args.context, normalizeRoleCode(args.roleCode));
  const locationId = GLOBAL_ROLES.has(roleCode) ? null : (args.locationId ? String(args.locationId) : null);

  const result = await prisma.$transaction(async (tx) => {
    const employee = await tx.employeeProfile.findUnique({ where: { id: args.employeeId } });
    if (!employee) throw new PersonnelAccessError("EMPLOYEE_NOT_FOUND", "Працівника не знайдено.", 404);
    await assertTargetWithinManagerScope(tx, employee.id, args.context, args.grantedScope);
    await assertLocation(tx, args.context, args.grantedScope, roleCode, locationId);
    const staffRole = await syncPrimaryStaffRole(tx, employee.id, roleCode, locationId);

    let user = employee.userId ? await tx.user.findUnique({ where: { id: employee.userId } }) : null;
    let mechanic = null;
    if (args.cabinetEnabled) {
      user = await ensureUserForEmployee(tx, employee, roleCode, locationId);
      mechanic = await syncMechanicResource(tx, user.id, `${employee.firstName} ${employee.lastName}`.trim(), roleCode, locationId, args.mechanicResourceId);
    } else if (user) {
      await ensureNotLastOwner(tx, user.id, roleCode, false);
      user = await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
      const existingMechanic = await tx.serviceMechanic.findFirst({ where: { userId: user.id } });
      if (existingMechanic?.isActive) await tx.serviceMechanic.update({ where: { id: existingMechanic.id }, data: { isActive: false } });
    }

    const location = locationId ? await tx.serviceLocation.findUnique({ where: { id: locationId }, select: { id: true, name: true } }) : null;
    return { employee, staffRole, location, user, mechanic };
  });

  await writeAuditEvent({
    entityType: "EmployeeProfile",
    entityId: args.employeeId,
    action: "PERSONNEL_ACCESS_CONFIGURED",
    after: {
      roleCode,
      locationId,
      cabinetEnabled: args.cabinetEnabled,
      userId: result.user?.id ?? null,
      mechanicResourceId: result.mechanic?.id ?? null,
    },
  });
  return result;
}

export async function deactivateEmployeeAccess(employeeId: string, context: AccessContext, grantedScope: AccessScopeCode | null) {
  const prisma = getPrisma();
  const result = await prisma.$transaction(async (tx) => {
    const employee = await tx.employeeProfile.findUnique({ where: { id: employeeId } });
    if (!employee) throw new PersonnelAccessError("EMPLOYEE_NOT_FOUND", "Працівника не знайдено.", 404);
    await assertTargetWithinManagerScope(tx, employee.id, context, grantedScope);
    const primary = await currentPrimaryRole(tx, employee.id);
    if (primary) assertRoleDelegation(context, primary.role.code);
    const now = new Date();
    await tx.employeeProfile.update({ where: { id: employee.id }, data: { isActive: false } });
    await tx.employeeRoleAssignment.updateMany({ where: { employeeId: employee.id, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, data: { endsAt: now, isPrimary: false } });
    if (employee.userId) {
      await ensureNotLastOwner(tx, employee.userId, null, false);
      await tx.user.update({ where: { id: employee.userId }, data: { isActive: false } });
      await tx.userAccessRole.updateMany({ where: { userId: employee.userId, isActive: true }, data: { isActive: false, endsAt: now, isPrimary: false } });
      await tx.serviceMechanic.updateMany({ where: { userId: employee.userId, isActive: true }, data: { isActive: false } });
    }
    return employee;
  });
  await writeAuditEvent({ entityType: "EmployeeProfile", entityId: employeeId, action: "PERSONNEL_DEACTIVATED_WITH_ACCESS" });
  return result;
}
