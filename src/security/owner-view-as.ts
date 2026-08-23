import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";
import { PERMISSIONS } from "@/src/security/permissions";
import type { AccessContext } from "@/src/security/access-context";

export const OWNER_VIEW_AS_COOKIE = "turbolev_owner_view_as";
export const OWNER_VIEW_AS_MAX_AGE_SECONDS = 2 * 60 * 60;

export class OwnerViewAsError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "OwnerViewAsError";
    this.code = code;
    this.status = status;
  }
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function requestHeaders(input?: Request | Headers) {
  if (input instanceof Request) return input.headers;
  if (input instanceof Headers) return input;
  try {
    const nextHeaders = await import("next/headers");
    return new Headers(await nextHeaders.headers());
  } catch {
    return new Headers();
  }
}

function cookieValue(headers: Headers, name: string) {
  const source = headers.get("cookie") || "";
  for (const part of source.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function assertOwnerViewAsAuthority(context: AccessContext) {
  const isOwner = context.roles.some((role) => role.code === "OWNER");
  const hasGrant = Boolean(context.permissions[PERMISSIONS.OWNER_EMPLOYEE_VIEW_AS]);
  if (context.provisioningState !== "ACTIVE" || !context.user || !isOwner || !hasGrant) {
    throw new OwnerViewAsError("OWNER_VIEW_AS_FORBIDDEN", "Перегляд кабінетів працівників доступний лише Власнику.", 403);
  }
  return context.user;
}

function activeRoleWhere(now: Date) {
  return {
    isActive: true,
    startsAt: { lte: now },
    OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    role: { isActive: true },
  };
}

export async function listOwnerViewAsEmployees(context: AccessContext) {
  const owner = assertOwnerViewAsAuthority(context);
  const prisma = getPrisma();
  const now = new Date();
  const employees = await prisma.employeeProfile.findMany({
    where: { isActive: true, userId: { not: null } },
    include: {
      user: {
        include: {
          accessRoles: {
            where: activeRoleWhere(now),
            include: { role: true, location: { select: { id: true, name: true } } },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          },
        },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return employees.flatMap((employee) => {
    const user = employee.user;
    if (!user?.isActive || user.id === owner.id) return [];
    const primary = user.accessRoles.find((assignment) => assignment.isPrimary) ?? user.accessRoles[0] ?? null;
    if (!primary || primary.role.code === "OWNER") return [];
    return [{
      userId: user.id,
      employeeId: employee.id,
      name: `${employee.firstName} ${employee.lastName}`.trim() || user.name,
      position: employee.position || primary.role.name,
      category: employee.personnelCategory || null,
      roleCode: primary.role.code,
      roleName: primary.role.name,
      locationId: primary.locationId,
      locationName: primary.location?.name ?? null,
    }];
  });
}

export async function getOwnerViewAsSession(input: Request | Headers | undefined, context: AccessContext) {
  const owner = assertOwnerViewAsAuthority(context);
  const headers = await requestHeaders(input);
  const rawToken = cookieValue(headers, OWNER_VIEW_AS_COOKIE);
  if (!rawToken) return null;
  const prisma = getPrisma();
  const now = new Date();
  const session = await prisma.ownerEmployeeViewAsSession.findUnique({
    where: { tokenHash: tokenHash(rawToken) },
  });
  if (!session || session.ownerUserId !== owner.id || session.endedAt || session.expiresAt <= now) return null;
  if (session.lastUsedAt.getTime() < now.getTime() - 60_000) {
    await prisma.ownerEmployeeViewAsSession.updateMany({
      where: { id: session.id, endedAt: null },
      data: { lastUsedAt: now },
    }).catch(() => undefined);
  }
  return session;
}

export async function createOwnerViewAsSession(context: AccessContext, targetUserId: string) {
  const owner = assertOwnerViewAsAuthority(context);
  const prisma = getPrisma();
  const now = new Date();
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: {
      employeeProfile: true,
      accessRoles: {
        where: activeRoleWhere(now),
        include: { role: true, location: { select: { id: true, name: true } } },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!target?.isActive || target.employeeProfile?.isActive === false || !target.employeeProfile) {
    throw new OwnerViewAsError("TARGET_EMPLOYEE_NOT_FOUND", "Активний кабінет працівника не знайдено.", 404);
  }
  if (target.id === owner.id || target.accessRoles.some((assignment) => assignment.role.code === "OWNER")) {
    throw new OwnerViewAsError("TARGET_OWNER_FORBIDDEN", "Режим перегляду призначений для кабінетів працівників, а не іншого Власника.", 409);
  }
  const primary = target.accessRoles.find((assignment) => assignment.isPrimary) ?? target.accessRoles[0] ?? null;
  if (!primary) throw new OwnerViewAsError("TARGET_ACCESS_NOT_PROVISIONED", "Працівнику ще не призначено активну роль CRM.", 409);

  const existing = await prisma.ownerEmployeeViewAsSession.findFirst({
    where: { ownerUserId: owner.id, endedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  await prisma.ownerEmployeeViewAsSession.updateMany({
    where: { ownerUserId: owner.id, endedAt: null },
    data: { endedAt: now },
  });

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + OWNER_VIEW_AS_MAX_AGE_SECONDS * 1000);
  const session = await prisma.ownerEmployeeViewAsSession.create({
    data: {
      tokenHash: tokenHash(token),
      ownerUserId: owner.id,
      targetUserId: target.id,
      targetEmployeeId: target.employeeProfile.id,
      targetRoleCode: primary.role.code,
      locationId: primary.locationId,
      expiresAt,
    },
  });

  return {
    token,
    maxAge: OWNER_VIEW_AS_MAX_AGE_SECONDS,
    session,
    switched: Boolean(existing),
    target: {
      userId: target.id,
      employeeId: target.employeeProfile.id,
      name: `${target.employeeProfile.firstName} ${target.employeeProfile.lastName}`.trim() || target.name,
      roleCode: primary.role.code,
      roleName: primary.role.name,
      locationId: primary.locationId,
      locationName: primary.location?.name ?? null,
    },
  };
}

export async function stopOwnerViewAsSession(input: Request | Headers | undefined, context: AccessContext) {
  const owner = assertOwnerViewAsAuthority(context);
  const headers = await requestHeaders(input);
  const rawToken = cookieValue(headers, OWNER_VIEW_AS_COOKIE);
  if (!rawToken) return null;
  const prisma = getPrisma();
  const session = await prisma.ownerEmployeeViewAsSession.findUnique({ where: { tokenHash: tokenHash(rawToken) } });
  if (!session || session.ownerUserId !== owner.id) return null;
  if (!session.endedAt) {
    await prisma.ownerEmployeeViewAsSession.update({ where: { id: session.id }, data: { endedAt: new Date() } });
  }
  return session;
}
