import "server-only";

import { getPrisma } from "@/src/lib/prisma";
import { getLocalSessionUserId } from "@/src/security/local-credentials";
import { getNeonAuthSdkSession } from "@/src/security/neon-auth-server";
import { getNeonAuthSession, isNeonAuthConfigured, type NeonAuthSession } from "@/src/security/neon-auth-transport";
import { getOwnerViewAsSession } from "@/src/security/owner-view-as";
import { PERMISSIONS, type AccessScopeCode, type PermissionCode } from "@/src/security/permissions";
import { computeEffectivePermissions } from "@/src/security/rbac-engine";

export type ProvisioningState = "ANONYMOUS" | "AUTHENTICATED_UNPROVISIONED" | "ACTIVE" | "INACTIVE";
export type EnforcementMode = "SHADOW" | "ENFORCED";

export type OwnerViewAsContext = {
  active: true;
  readOnly: true;
  sessionId: string;
  expiresAt: string;
  owner: { id: string; name: string; employeeId: string | null };
  target: { id: string; name: string; employeeId: string | null };
};

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
  viewAs: OwnerViewAsContext | null;
};

type AppUser = {
  id: string;
  name: string;
  email: string | null;
  isActive: boolean;
  lastSeenAt: Date | null;
  employeeProfile: {
    id: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
  } | null;
};

const LAST_SEEN_TOUCH_INTERVAL_MS = 120_000;
const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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
    viewAs: null,
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

function requestForcesEnforcement(input?: Request | Headers) {
  if (!(input instanceof Request)) return false;
  try {
    const pathname = new URL(input.url).pathname;
    return pathname === "/api/analytics" || pathname.startsWith("/api/analytics/");
  } catch {
    return false;
  }
}

function requestIsMutation(input?: Request | Headers) {
  return input instanceof Request && !SAFE_HTTP_METHODS.has(input.method.toUpperCase());
}

async function touchLastSeenIfStale(user: { id: string; lastSeenAt: Date | null }) {
  const cutoff = new Date(Date.now() - LAST_SEEN_TOUCH_INTERVAL_MS);
  if (user.lastSeenAt && user.lastSeenAt >= cutoff) return;

  await getPrisma().user.updateMany({
    where: {
      id: user.id,
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }],
    },
    data: { lastSeenAt: new Date() },
  }).catch(() => undefined);
}

async function findOrClaimAppUser(session: NeonAuthSession): Promise<AppUser | null> {
  const prisma = getPrisma();
  const appUser = await prisma.user.findUnique({
    where: { authUserId: session.user.id },
    include: { employeeProfile: true },
  });
  if (appUser) {
    await touchLastSeenIfStale(appUser);
    return appUser;
  }

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

function safeUser(appUser: AppUser) {
  const employeeName = appUser.employeeProfile
    ? `${appUser.employeeProfile.firstName} ${appUser.employeeProfile.lastName}`.trim()
    : null;
  return {
    id: appUser.id,
    name: appUser.name,
    email: appUser.email,
    employeeId: appUser.employeeProfile?.id ?? null,
    employeeName,
  };
}

async function buildActiveUserContext(args: {
  appUser: AppUser;
  enforcementMode: EnforcementMode;
  authConfigured: boolean;
  authIdentity: NeonAuthSession["user"] | null;
}): Promise<AccessContext> {
  const { appUser, enforcementMode, authConfigured, authIdentity } = args;
  const anonymous = emptyContext(enforcementMode, authConfigured);
  const user = safeUser(appUser);
  if (!appUser.isActive || appUser.employeeProfile?.isActive === false) {
    return {
      ...anonymous,
      authenticated: true,
      provisioningState: "INACTIVE",
      authIdentity,
      user,
    };
  }

  const prisma = getPrisma();
  const now = new Date();
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
            permissions: { include: { permission: true } },
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

  const grants = roleAssignments.flatMap((assignment) =>
    assignment.role.permissions.map((grant) => ({
      code: grant.permission.code,
      scope: grant.scope as AccessScopeCode,
    })),
  );
  const overrideInput = overrides.map((override) => ({
    code: override.permission.code,
    scope: override.scope as AccessScopeCode,
    effect: override.effect as "ALLOW" | "DENY",
  }));
  const effective = computeEffectivePermissions(grants, overrideInput);
  const locationIds = Array.from(
    new Set([
      ...roleAssignments.map((assignment) => assignment.locationId).filter((value): value is string => Boolean(value)),
      ...overrides.map((override) => override.locationId).filter((value): value is string => Boolean(value)),
    ]),
  );

  return {
    enforcementMode,
    authConfigured,
    authenticated: true,
    provisioningState: "ACTIVE",
    authIdentity,
    user,
    roles: roleAssignments.map((assignment) => ({
      code: assignment.role.code,
      name: assignment.role.name,
      locationId: assignment.locationId,
      isPrimary: assignment.isPrimary,
    })),
    permissions: effective.permissions,
    deniedPermissions: effective.deniedPermissions,
    locationIds,
    viewAs: null,
  };
}

async function resolveActualAccessContext(input?: Request | Headers): Promise<AccessContext> {
  const [configuredEnforcementMode, requestHeaders] = await Promise.all([getSecurityMode(), resolveRequestHeaders(input)]);
  const enforcementMode: EnforcementMode = requestForcesEnforcement(input) ? "ENFORCED" : configuredEnforcementMode;
  const authConfigured = isNeonAuthConfigured();
  const anonymous = emptyContext(enforcementMode, authConfigured);
  const session = authConfigured
    ? (await getNeonAuthSdkSession()) ?? (await getNeonAuthSession(requestHeaders))
    : null;

  const prisma = getPrisma();
  let appUser = session ? await findOrClaimAppUser(session) : null;
  let authIdentity: NeonAuthSession["user"] | null = session?.user ?? null;
  if (!appUser) {
    const localUserId = await getLocalSessionUserId(requestHeaders);
    if (localUserId) {
      appUser = await prisma.user.findUnique({ where: { id: localUserId }, include: { employeeProfile: true } });
      if (appUser) {
        await touchLastSeenIfStale(appUser);
        authIdentity = {
          id: `local:${appUser.id}`,
          email: appUser.email,
          name: appUser.name,
          emailVerified: true,
        };
      }
    }
  }

  if (!appUser) {
    if (session) {
      return {
        ...anonymous,
        authenticated: true,
        provisioningState: "AUTHENTICATED_UNPROVISIONED",
        authIdentity: session.user,
      };
    }
    return anonymous;
  }

  return buildActiveUserContext({ appUser, enforcementMode, authConfigured, authIdentity });
}

export async function getActualAccessContext(input?: Request | Headers): Promise<AccessContext> {
  return resolveActualAccessContext(input);
}

export async function getAccessContext(input?: Request | Headers): Promise<AccessContext> {
  const actual = await resolveActualAccessContext(input);
  if (
    actual.provisioningState !== "ACTIVE" ||
    !actual.user ||
    !actual.roles.some((role) => role.code === "OWNER") ||
    !actual.permissions[PERMISSIONS.OWNER_EMPLOYEE_VIEW_AS]
  ) return actual;

  const previewSession = await getOwnerViewAsSession(input, actual).catch(() => null);
  if (!previewSession) return actual;

  const targetUser = await getPrisma().user.findUnique({
    where: { id: previewSession.targetUserId },
    include: { employeeProfile: true },
  });
  if (!targetUser || !targetUser.isActive || targetUser.employeeProfile?.isActive === false) return actual;

  const target = await buildActiveUserContext({
    appUser: targetUser,
    enforcementMode: actual.enforcementMode,
    authConfigured: actual.authConfigured,
    authIdentity: actual.authIdentity,
  });
  const targetName = target.user?.employeeName || target.user?.name || "Працівник";
  const ownerName = actual.user.employeeName || actual.user.name;
  const viewAs: OwnerViewAsContext = {
    active: true,
    readOnly: true,
    sessionId: previewSession.id,
    expiresAt: previewSession.expiresAt.toISOString(),
    owner: { id: actual.user.id, name: ownerName, employeeId: actual.user.employeeId },
    target: { id: previewSession.targetUserId, name: targetName, employeeId: target.user?.employeeId ?? null },
  };

  if (requestIsMutation(input)) {
    return {
      ...target,
      provisioningState: "INACTIVE",
      roles: [],
      permissions: {},
      deniedPermissions: Array.from(new Set([...target.deniedPermissions, ...Object.keys(target.permissions)])),
      locationIds: [],
      viewAs,
    };
  }

  return { ...target, viewAs };
}

function previewAllowsPermission(permission: PermissionCode | string) {
  const code = String(permission).toUpperCase();
  return code.endsWith(".READ") || code.includes("_READ");
}

export function hasPermission(context: AccessContext, permission: PermissionCode | string) {
  if (context.viewAs?.readOnly && !previewAllowsPermission(permission)) return false;
  return context.provisioningState === "ACTIVE" && Boolean(context.permissions[permission]);
}
