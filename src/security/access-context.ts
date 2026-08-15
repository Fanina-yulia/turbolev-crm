import "server-only";

import { getPrisma } from "@/src/lib/prisma";
import { getNeonAuthSession, isNeonAuthConfigured, type NeonAuthSession } from "@/src/security/neon-auth-transport";
import { widerScope, type AccessScopeCode, type PermissionCode } from "@/src/security/permissions";

export type ProvisioningState = "ANONYMOUS" | "AUTHENTICATED_UNPROVISIONED" | "ACTIVE" | "INACTIVE";
export type EnforcementMode = "SHADOW" | "ENFORCED";

export type AccessContext = {
  enforcementMode: EnforcementMode;
  authConfigured: boolean;
  authenticated: boolean;
  provisioningState: ProvisioningState;
  authIdentity: NeonAuthSession["user"] | null;
  user: {
    id: string;
    name: string;
    email: string | null;
    employeeId: string | null;
    employeeName: string | null;
  } | null;
  roles: Array<{ code: string; name: string; locationId: string | null; isPrimary: boolean }>;
  permissions: Record<string, AccessScopeCode>;
  deniedPermissions: string[];
  locationIds: string[];
};

function emptyContext(mode: EnforcementMode, authConfigured: boolean): AccessContext {
  return {
    enforcementMode: mode,
    authConfigured,
    authenticated: false,
    provisioningState: "ANONYMOUS",
    authIdentity: null,
    user: null,
    roles: [],
    permissions: {},
    deniedPermissions: [],
    locationIds: [],
  };
}

async function resolveRequestHeaders(input?: Request | Headers) {
  if (input instanceof Request) return input.headers;
  if (input instanceof Headers) return input;
  try {
    const nextHeaders = await import("next/headers");
    return new Headers(await nextHeaders.headers());
  } catch {
    return new Headers();
  }
}

async function getSecurityMode(): Promise<EnforcementMode> {
  try {
    const config = await getPrisma().securityConfig.findUnique({
      where: { id: "default" },
      select: { enforcementMode: true },
    });
    return config?.enforcementMode === "ENFORCED" ? "ENFORCED" : "SHADOW";
  } catch {
    return "SHADOW";
  }
}

async function findOrClaimAppUser(session: NeonAuthSession) {
  const prisma = getPrisma();
  let appUser = await prisma.user.findUnique({
    where: { authUserId: session.user.id },
    include: { employeeProfile: true },
  });
  if (appUser) return appUser;

  if (!session.user.email || session.user.emailVerified !== true) return null;

  const candidate = await prisma.user.findFirst({
    where: {
      email: { equals: session.user.email, mode: "insensitive" },
      authUserId: null,
    },
    include: { employeeProfile: true },
  });
  if (!candidate) return null;

  const claimed = await prisma.user.updateMany({
    where: { id: candidate.id, authUserId: null },
    data: { authUserId: session.user.id, lastLoginAt: new Date(), lastSeenAt: new Date() },
  });
  if (claimed.count !== 1) {
    return prisma.user.findUnique({
      where: { authUserId: session.user.id },
      include: { employeeProfile: true },
    });
  }

  return prisma.user.findUnique({
    where: { id: candidate.id },
    include: { employeeProfile: true },
  });
}

export async function getAccessContext(input?: Request | Headers): Promise<AccessContext> {
  const [enforcementMode, requestHeaders] = await Promise.all([getSecurityMode(), resolveRequestHeaders(input)]);
  const authConfigured = isNeonAuthConfigured();
  const anonymous = emptyContext(enforcementMode, authConfigured);
  if (!authConfigured) return anonymous;

  const session = await getNeonAuthSession(requestHeaders);
  if (!session) return anonymous;

  const appUser = await findOrClaimAppUser(session);
  if (!appUser) {
    return {
      ...anonymous,
      authenticated: true,
      provisioningState: "AUTHENTICATED_UNPROVISIONED",
      authIdentity: session.user,
    };
  }

  if (!appUser.isActive) {
    return {
      ...anonymous,
      authenticated: true,
      provisioningState: "INACTIVE",
      authIdentity: session.user,
      user: {
        id: appUser.id,
        name: appUser.name,
        email: appUser.email,
        employeeId: appUser.employeeProfile?.id ?? null,
        employeeName: appUser.employeeProfile
          ? `${appUser.employeeProfile.firstName} ${appUser.employeeProfile.lastName}`.trim()
          : null,
      },
    };
  }

  const now = new Date();
  const prisma = getPrisma();
  const [roleAssignments, overrides] = await Promise.all([
    prisma.userAccessRole.findMany({
      where: {
        userId: appUser.id,
        isActive: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        role: { isActive: true },
      },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
    prisma.userPermissionOverride.findMany({
      where: {
        userId: appUser.id,
        isActive: true,
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: { permission: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const permissions: Record<string, AccessScopeCode> = {};
  for (const assignment of roleAssignments) {
    for (const grant of assignment.role.permissions) {
      const code = grant.permission.code;
      const scope = grant.scope as AccessScopeCode;
      permissions[code] = permissions[code] ? widerScope(permissions[code], scope) : scope;
    }
  }

  const denied = new Set<string>();
  for (const override of overrides) {
    const code = override.permission.code;
    if (override.effect === "DENY") {
      denied.add(code);
      delete permissions[code];
      continue;
    }
    if (denied.has(code)) continue;
    const scope = override.scope as AccessScopeCode;
    permissions[code] = permissions[code] ? widerScope(permissions[code], scope) : scope;
  }

  const locationIds = Array.from(
    new Set([
      ...roleAssignments.map((assignment) => assignment.locationId).filter((value): value is string => Boolean(value)),
      ...overrides.map((override) => override.locationId).filter((value): value is string => Boolean(value)),
    ]),
  );

  const employeeName = appUser.employeeProfile
    ? `${appUser.employeeProfile.firstName} ${appUser.employeeProfile.lastName}`.trim()
    : null;

  return {
    enforcementMode,
    authConfigured,
    authenticated: true,
    provisioningState: "ACTIVE",
    authIdentity: session.user,
    user: {
      id: appUser.id,
      name: appUser.name,
      email: appUser.email,
      employeeId: appUser.employeeProfile?.id ?? null,
      employeeName,
    },
    roles: roleAssignments.map((assignment) => ({
      code: assignment.role.code,
      name: assignment.role.name,
      locationId: assignment.locationId,
      isPrimary: assignment.isPrimary,
    })),
    permissions,
    deniedPermissions: Array.from(denied),
    locationIds,
  };
}

export function hasPermission(context: AccessContext, permission: PermissionCode | string) {
  return context.provisioningState === "ACTIVE" && Boolean(context.permissions[permission]);
}
