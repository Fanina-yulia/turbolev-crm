import "server-only";

import { getPrisma } from "@/src/lib/prisma";
import { writeAuditEvent } from "@/src/services/audit.service";

const OWNER_RECENT_LOGIN_WINDOW_MS = 60 * 60 * 1000;

export class SecurityAdminError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "SecurityAdminError";
    this.code = code;
    this.status = status;
  }
}

type RoleAssignmentInput = {
  roleCode: string;
  locationId?: string | null;
  isPrimary?: boolean;
  reason?: string | null;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeRoleAssignments(items: RoleAssignmentInput[]) {
  const map = new Map<string, RoleAssignmentInput>();
  for (const item of items) {
    const roleCode = String(item.roleCode || "").trim().toUpperCase();
    if (!roleCode) continue;
    const locationId = item.locationId ? String(item.locationId) : null;
    map.set(`${roleCode}:${locationId ?? "GLOBAL"}`, {
      roleCode,
      locationId,
      isPrimary: Boolean(item.isPrimary),
      reason: item.reason ? String(item.reason).slice(0, 240) : null,
    });
  }
  return Array.from(map.values());
}

export async function getSecurityCatalog() {
  const prisma = getPrisma();
  const [config, roles, permissions, users] = await Promise.all([
    prisma.securityConfig.findUnique({ where: { id: "default" } }),
    prisma.accessRole.findMany({
      where: { isActive: true },
      include: {
        permissions: {
          include: { permission: true },
          orderBy: { permission: { code: "asc" } },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
    prisma.permission.findMany({ orderBy: [{ module: "asc" }, { action: "asc" }] }),
    prisma.user.findMany({
      include: {
        employeeProfile: { select: { id: true, firstName: true, lastName: true, position: true, isActive: true } },
        accessRoles: {
          where: { isActive: true },
          include: { role: true, location: { select: { id: true, name: true } } },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
        permissionOverrides: {
          where: { isActive: true },
          include: { permission: true, location: { select: { id: true, name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
  ]);

  return {
    config,
    roles: roles.map((role) => ({
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      permissions: role.permissions.map((grant) => ({
        code: grant.permission.code,
        scope: grant.scope,
        sensitive: grant.permission.isSensitive,
      })),
    })),
    permissions,
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      authLinked: Boolean(user.authUserId),
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      lastSeenAt: user.lastSeenAt,
      employee: user.employeeProfile
        ? {
            id: user.employeeProfile.id,
            name: `${user.employeeProfile.firstName} ${user.employeeProfile.lastName}`.trim(),
            position: user.employeeProfile.position,
            isActive: user.employeeProfile.isActive,
          }
        : null,
      roles: user.accessRoles.map((assignment) => ({
        id: assignment.id,
        code: assignment.role.code,
        name: assignment.role.name,
        location: assignment.location,
        isPrimary: assignment.isPrimary,
        startsAt: assignment.startsAt,
        endsAt: assignment.endsAt,
      })),
      overrides: user.permissionOverrides.map((override) => ({
        id: override.id,
        code: override.permission.code,
        effect: override.effect,
        scope: override.scope,
        location: override.location,
        expiresAt: override.expiresAt,
        reason: override.reason,
      })),
    })),
  };
}

export async function provisionAccessUser(args: {
  email: string;
  name: string;
  employeeId?: string | null;
  roles: RoleAssignmentInput[];
}) {
  const prisma = getPrisma();
  const email = normalizeEmail(args.email);
  const name = String(args.name || "").trim();
  const assignments = normalizeRoleAssignments(args.roles);
  if (!email || !email.includes("@")) throw new SecurityAdminError("INVALID_EMAIL", "Вкажіть коректний email.");
  if (!name) throw new SecurityAdminError("INVALID_NAME", "Вкажіть ім’я користувача.");
  if (!assignments.length) throw new SecurityAdminError("ROLE_REQUIRED", "Призначте хоча б одну роль доступу.");

  const result = await prisma.$transaction(async (tx) => {
    const roles = await tx.accessRole.findMany({
      where: { code: { in: assignments.map((item) => item.roleCode) }, isActive: true },
    });
    const roleByCode = new Map(roles.map((role) => [role.code, role]));
    const missing = assignments.filter((item) => !roleByCode.has(item.roleCode)).map((item) => item.roleCode);
    if (missing.length) throw new SecurityAdminError("UNKNOWN_ROLE", `Невідомі ролі: ${missing.join(", ")}`);

    let user = await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
    if (!user) {
      user = await tx.user.create({ data: { name, email, isActive: true } });
    } else if (user.name !== name || !user.isActive) {
      user = await tx.user.update({ where: { id: user.id }, data: { name, isActive: true } });
    }

    if (args.employeeId) {
      const employee = await tx.employeeProfile.findUnique({ where: { id: args.employeeId } });
      if (!employee) throw new SecurityAdminError("EMPLOYEE_NOT_FOUND", "Кадровий профіль не знайдено.", 404);
      if (employee.userId && employee.userId !== user.id) {
        throw new SecurityAdminError("EMPLOYEE_ALREADY_LINKED", "Цей працівник уже прив’язаний до іншого CRM-користувача.", 409);
      }
      await tx.employeeProfile.update({ where: { id: employee.id }, data: { userId: user.id } });
    }

    for (const assignment of assignments) {
      const role = roleByCode.get(assignment.roleCode)!;
      const existing = await tx.userAccessRole.findFirst({
        where: { userId: user.id, roleId: role.id, locationId: assignment.locationId ?? null },
      });
      if (existing) {
        await tx.userAccessRole.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            isPrimary: assignment.isPrimary ?? existing.isPrimary,
            endsAt: null,
            reason: assignment.reason ?? existing.reason,
          },
        });
      } else {
        await tx.userAccessRole.create({
          data: {
            userId: user.id,
            roleId: role.id,
            locationId: assignment.locationId ?? null,
            isPrimary: Boolean(assignment.isPrimary),
            reason: assignment.reason ?? null,
          },
        });
      }
    }

    return tx.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { accessRoles: { where: { isActive: true }, include: { role: true } } },
    });
  });

  await writeAuditEvent({
    entityType: "User",
    entityId: result.id,
    action: "SECURITY_USER_PROVISIONED",
    after: {
      email: result.email,
      roles: result.accessRoles.map((assignment) => assignment.role.code),
      employeeId: args.employeeId ?? null,
    },
  });
  return result;
}

async function assertAtLeastOneActiveOwnerAfterChange(tx: any, userId: string, nextRoleCodes: string[]) {
  const ownerRole = await tx.accessRole.findUnique({ where: { code: "OWNER" }, select: { id: true } });
  if (!ownerRole) throw new SecurityAdminError("OWNER_ROLE_MISSING", "Системна роль OWNER відсутня.", 500);

  const target = await tx.user.findUnique({
    where: { id: userId },
    include: { accessRoles: { where: { roleId: ownerRole.id, isActive: true } } },
  });
  const targetIsOwner = Boolean(target?.accessRoles.length);
  const targetWillBeOwner = nextRoleCodes.includes("OWNER");
  if (!targetIsOwner || targetWillBeOwner) return;

  const otherOwners = await tx.userAccessRole.count({
    where: {
      roleId: ownerRole.id,
      isActive: true,
      userId: { not: userId },
      user: { isActive: true },
      startsAt: { lte: new Date() },
      OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
    },
  });
  if (otherOwners < 1) {
    throw new SecurityAdminError("LAST_OWNER_PROTECTED", "Не можна забрати роль у останнього активного OWNER.", 409);
  }
}

export async function replaceUserAccessRoles(args: { userId: string; roles: RoleAssignmentInput[] }) {
  const prisma = getPrisma();
  const assignments = normalizeRoleAssignments(args.roles);
  if (!assignments.length) throw new SecurityAdminError("ROLE_REQUIRED", "У користувача має залишитися хоча б одна роль.");

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: args.userId } });
    if (!user) throw new SecurityAdminError("USER_NOT_FOUND", "Користувача не знайдено.", 404);

    const roleRows = await tx.accessRole.findMany({
      where: { code: { in: assignments.map((item) => item.roleCode) }, isActive: true },
    });
    const roleByCode = new Map(roleRows.map((role) => [role.code, role]));
    if (roleRows.length !== new Set(assignments.map((item) => item.roleCode)).size) {
      throw new SecurityAdminError("UNKNOWN_ROLE", "Одна або більше ролей не існує.");
    }

    await assertAtLeastOneActiveOwnerAfterChange(tx, args.userId, assignments.map((item) => item.roleCode));

    await tx.userAccessRole.updateMany({ where: { userId: args.userId, isActive: true }, data: { isActive: false, endsAt: new Date() } });
    for (const assignment of assignments) {
      const role = roleByCode.get(assignment.roleCode)!;
      const existing = await tx.userAccessRole.findFirst({
        where: { userId: args.userId, roleId: role.id, locationId: assignment.locationId ?? null },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        await tx.userAccessRole.update({
          where: { id: existing.id },
          data: { isActive: true, startsAt: new Date(), endsAt: null, isPrimary: Boolean(assignment.isPrimary), reason: assignment.reason ?? null },
        });
      } else {
        await tx.userAccessRole.create({
          data: {
            userId: args.userId,
            roleId: role.id,
            locationId: assignment.locationId ?? null,
            isPrimary: Boolean(assignment.isPrimary),
            reason: assignment.reason ?? null,
          },
        });
      }
    }

    return tx.user.findUniqueOrThrow({
      where: { id: args.userId },
      include: { accessRoles: { where: { isActive: true }, include: { role: true } } },
    });
  });

  await writeAuditEvent({
    entityType: "User",
    entityId: result.id,
    action: "SECURITY_ROLES_REPLACED",
    after: { roles: result.accessRoles.map((assignment) => assignment.role.code) },
  });
  return result;
}

export async function setSecurityEnforcementMode(mode: "SHADOW" | "ENFORCED") {
  const prisma = getPrisma();
  if (mode === "ENFORCED") {
    const recentCutoff = new Date(Date.now() - OWNER_RECENT_LOGIN_WINDOW_MS);
    const owner = await prisma.user.findFirst({
      where: {
        isActive: true,
        authUserId: { not: null },
        lastSeenAt: { gte: recentCutoff },
        accessRoles: {
          some: {
            isActive: true,
            startsAt: { lte: new Date() },
            OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
            role: { code: "OWNER", isActive: true },
          },
        },
      },
      select: { id: true, name: true, email: true, lastSeenAt: true },
    });
    if (!owner) {
      throw new SecurityAdminError(
        "RECENT_OWNER_LOGIN_REQUIRED",
        "ENFORCED можна ввімкнути лише після успішного входу активного OWNER протягом останньої години.",
        409,
      );
    }
  }

  const config = await prisma.securityConfig.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      enforcementMode: mode,
      bootstrapCompleted: mode === "ENFORCED",
      allowSelfRegistration: false,
    },
    update: {
      enforcementMode: mode,
      ...(mode === "ENFORCED" ? { bootstrapCompleted: true } : {}),
      allowSelfRegistration: false,
    },
  });

  await writeAuditEvent({
    entityType: "SecurityConfig",
    entityId: "default",
    action: "SECURITY_ENFORCEMENT_CHANGED",
    after: { enforcementMode: config.enforcementMode, bootstrapCompleted: config.bootstrapCompleted },
  });
  return config;
}
