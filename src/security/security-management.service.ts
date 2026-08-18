import "server-only";

import type { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { writeAuditEvent } from "@/src/services/audit.service";
import { SecurityAdminError } from "@/src/security/security-admin.service";
import type { AccessScopeCode } from "@/src/security/permissions";

const VALID_SCOPES = new Set<AccessScopeCode>(["SELF", "ASSIGNED", "TEAM", "LOCATION", "ALL"]);

type RoleGrantInput = { code: string; scope: AccessScopeCode };

function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

function normalizeGrantInput(items: RoleGrantInput[]) {
  const grants = new Map<string, AccessScopeCode>();
  for (const item of items || []) {
    const code = String(item?.code || "").trim().toUpperCase();
    const scope = String(item?.scope || "ALL").trim().toUpperCase() as AccessScopeCode;
    if (!code) continue;
    if (!VALID_SCOPES.has(scope)) throw new SecurityAdminError("INVALID_SCOPE", `Некоректний scope для ${code}.`);
    grants.set(code, scope);
  }
  return Array.from(grants, ([code, scope]) => ({ code, scope }));
}

async function assertCanDeactivateUser(tx: Prisma.TransactionClient, userId: string) {
  const ownerRole = await tx.accessRole.findUnique({ where: { code: "OWNER" }, select: { id: true } });
  if (!ownerRole) throw new SecurityAdminError("OWNER_ROLE_MISSING", "Системна роль OWNER відсутня.", 500);

  const targetOwner = await tx.userAccessRole.findFirst({
    where: {
      userId,
      roleId: ownerRole.id,
      isActive: true,
      startsAt: { lte: new Date() },
      OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (!targetOwner) return;

  const otherOwners = await tx.userAccessRole.count({
    where: {
      roleId: ownerRole.id,
      userId: { not: userId },
      isActive: true,
      startsAt: { lte: new Date() },
      OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
      user: { isActive: true },
    },
  });
  if (otherOwners < 1) {
    throw new SecurityAdminError("LAST_OWNER_PROTECTED", "Не можна видалити доступ останнього активного OWNER.", 409);
  }
}

export async function updateAccessUser(args: {
  userId: string;
  name: string;
  email: string;
  isActive?: boolean;
  employeeId?: string | null;
}) {
  const prisma = getPrisma();
  const name = String(args.name || "").trim();
  const email = normalizeEmail(args.email);
  if (!name) throw new SecurityAdminError("INVALID_NAME", "Вкажіть ім’я користувача.");
  if (!email || !email.includes("@")) throw new SecurityAdminError("INVALID_EMAIL", "Вкажіть коректний email.");

  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({
      where: { id: args.userId },
      include: { employeeProfile: true },
    });
    if (!before) throw new SecurityAdminError("USER_NOT_FOUND", "Користувача не знайдено.", 404);

    const collision = await tx.user.findFirst({
      where: { id: { not: args.userId }, email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (collision) throw new SecurityAdminError("EMAIL_ALREADY_USED", "Цей email уже прив’язаний до іншого користувача.", 409);

    const nextActive = typeof args.isActive === "boolean" ? args.isActive : before.isActive;
    if (before.isActive && !nextActive) await assertCanDeactivateUser(tx, args.userId);

    if (args.employeeId !== undefined) {
      if (before.employeeProfile && before.employeeProfile.id !== args.employeeId) {
        await tx.employeeProfile.update({ where: { id: before.employeeProfile.id }, data: { userId: null } });
      }
      if (args.employeeId) {
        const employee = await tx.employeeProfile.findUnique({ where: { id: args.employeeId } });
        if (!employee) throw new SecurityAdminError("EMPLOYEE_NOT_FOUND", "Кадровий профіль не знайдено.", 404);
        if (employee.userId && employee.userId !== args.userId) {
          throw new SecurityAdminError("EMPLOYEE_ALREADY_LINKED", "Цей працівник уже прив’язаний до іншого CRM-користувача.", 409);
        }
        if (employee.userId !== args.userId) {
          await tx.employeeProfile.update({ where: { id: employee.id }, data: { userId: args.userId } });
        }
      }
    }

    const previousEmail = normalizeEmail(before.email || "");
    const emailChanged = previousEmail !== email;
    const user = await tx.user.update({
      where: { id: args.userId },
      data: {
        name,
        email,
        isActive: nextActive,
        ...(emailChanged && before.authUserId
          ? { authUserId: null, lastLoginAt: null, lastSeenAt: null }
          : {}),
      },
      include: {
        employeeProfile: { select: { id: true, firstName: true, lastName: true, position: true, isActive: true } },
        accessRoles: { where: { isActive: true }, include: { role: true } },
      },
    });
    return { before, user, emailChanged };
  });

  await writeAuditEvent({
    entityType: "User",
    entityId: result.user.id,
    action: "SECURITY_USER_UPDATED",
    before: { name: result.before.name, email: result.before.email, isActive: result.before.isActive, authLinked: Boolean(result.before.authUserId) },
    after: {
      name: result.user.name,
      email: result.user.email,
      isActive: result.user.isActive,
      authLinked: Boolean(result.user.authUserId),
      emailChanged: result.emailChanged,
    },
  });
  return result.user;
}

export async function setAccessUserActive(userId: string, isActive: boolean) {
  const prisma = getPrisma();
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: userId } });
    if (!before) throw new SecurityAdminError("USER_NOT_FOUND", "Користувача не знайдено.", 404);
    if (before.isActive && !isActive) await assertCanDeactivateUser(tx, userId);
    const user = await tx.user.update({ where: { id: userId }, data: { isActive } });
    return { before, user };
  });

  await writeAuditEvent({
    entityType: "User",
    entityId: userId,
    action: isActive ? "SECURITY_USER_REACTIVATED" : "SECURITY_USER_DEACTIVATED",
    before: { isActive: result.before.isActive },
    after: { isActive: result.user.isActive },
  });
  return result.user;
}

export async function updateAccessRole(args: {
  roleCode: string;
  name: string;
  description?: string | null;
  grants: RoleGrantInput[];
}) {
  const prisma = getPrisma();
  const roleCode = String(args.roleCode || "").trim().toUpperCase();
  const name = String(args.name || "").trim();
  const description = String(args.description || "").trim() || null;
  const grants = normalizeGrantInput(args.grants);
  if (!name) throw new SecurityAdminError("INVALID_ROLE_NAME", "Вкажіть назву ролі.");
  if (!grants.length) throw new SecurityAdminError("ROLE_PERMISSION_REQUIRED", "У ролі має бути хоча б один дозвіл.");
  if (roleCode === "OWNER" && !grants.some((grant) => grant.code === "SECURITY.ACCESS_MANAGE")) {
    throw new SecurityAdminError(
      "OWNER_SECURITY_PERMISSION_REQUIRED",
      "OWNER завжди повинен мати право SECURITY.ACCESS_MANAGE, щоб система не залишилась без адміністратора.",
      409,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const role = await tx.accessRole.findUnique({
      where: { code: roleCode },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new SecurityAdminError("ROLE_NOT_FOUND", "Роль не знайдено.", 404);

    const permissionRows = await tx.permission.findMany({ where: { code: { in: grants.map((grant) => grant.code) } } });
    const permissionByCode = new Map(permissionRows.map((permission) => [permission.code, permission]));
    const missing = grants.filter((grant) => !permissionByCode.has(grant.code)).map((grant) => grant.code);
    if (missing.length) throw new SecurityAdminError("UNKNOWN_PERMISSION", `Невідомі дозволи: ${missing.join(", ")}`);

    await tx.accessRole.update({ where: { id: role.id }, data: { name, description } });
    await tx.accessRolePermission.deleteMany({ where: { roleId: role.id } });
    await tx.accessRolePermission.createMany({
      data: grants.map((grant) => ({
        roleId: role.id,
        permissionId: permissionByCode.get(grant.code)!.id,
        scope: grant.scope,
      })),
    });

    const updated = await tx.accessRole.findUniqueOrThrow({
      where: { id: role.id },
      include: { permissions: { include: { permission: true }, orderBy: { permission: { code: "asc" } } } },
    });
    return { before: role, updated };
  });

  await writeAuditEvent({
    entityType: "AccessRole",
    entityId: result.updated.id,
    action: "SECURITY_ROLE_UPDATED",
    before: {
      name: result.before.name,
      description: result.before.description,
      permissions: result.before.permissions.map((grant) => ({ code: grant.permission.code, scope: grant.scope })),
    },
    after: {
      name: result.updated.name,
      description: result.updated.description,
      permissions: result.updated.permissions.map((grant) => ({ code: grant.permission.code, scope: grant.scope })),
    },
  });
  return result.updated;
}
