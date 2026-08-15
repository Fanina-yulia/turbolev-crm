import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS, type AccessScopeCode, type PermissionCode } from "@/src/security/permissions";
import { DEFAULT_ACCESS_ROLES, PERMISSION_PRESENTATION } from "@/src/security/access-matrix-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fallbackCatalog(authConfigured = false) {
  const permissions = Object.values(PERMISSIONS).map((code) => ({
    code,
    module: code.split(".")[0] ?? "OTHER",
    action: code.split(".")[1] ?? "READ",
    isSensitive: Boolean(PERMISSION_PRESENTATION[code].sensitive),
    ...PERMISSION_PRESENTATION[code],
  }));
  return {
    ok: true,
    available: false,
    reason: "SECURITY_SCHEMA_NOT_DEPLOYED",
    config: { enforcementMode: "SHADOW", bootstrapCompleted: false, allowSelfRegistration: false },
    authConfigured,
    roles: DEFAULT_ACCESS_ROLES,
    permissions,
    assignmentCount: 0,
    userCount: 0,
  };
}

export async function GET() {
  const auth = await authorize(PERMISSIONS.SECURITY_ACCESS_MANAGE);
  if (!auth.allowed && auth.response) return auth.response;

  const prisma = getPrisma();
  try {
    const [config, rows, permissionRows, assignmentCount, userCount] = await Promise.all([
      prisma.securityConfig.findUnique({ where: { id: "default" } }),
      prisma.accessRole.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { permissions: { include: { permission: true } } },
      }),
      prisma.permission.findMany({ orderBy: [{ module: "asc" }, { action: "asc" }, { code: "asc" }] }),
      prisma.userAccessRole.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isActive: true } }),
    ]);

    const roles = rows.map((role) => ({
      code: role.code,
      name: role.name,
      description: role.description ?? "",
      sortOrder: role.sortOrder,
      isSystem: role.isSystem,
      grants: role.permissions.map((item) => ({
        code: item.permission.code as PermissionCode,
        scope: item.scope as AccessScopeCode,
      })),
    }));

    const permissions = permissionRows.map((permission) => {
      const code = permission.code as PermissionCode;
      const presentation = PERMISSION_PRESENTATION[code];
      return {
        code: permission.code,
        module: permission.module,
        action: permission.action,
        isSensitive: permission.isSensitive || Boolean(presentation?.sensitive),
        label: presentation?.label ?? permission.description ?? permission.code,
        moduleLabel: presentation?.moduleLabel ?? permission.module,
      };
    });

    return NextResponse.json({
      ok: true,
      available: true,
      reason: null,
      config: config ?? { enforcementMode: "SHADOW", bootstrapCompleted: false, allowSelfRegistration: false },
      authConfigured: auth.context.authConfigured,
      roles: roles.length ? roles : DEFAULT_ACCESS_ROLES,
      permissions: permissions.length ? permissions : fallbackCatalog(auth.context.authConfigured).permissions,
      assignmentCount,
      userCount,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("GET /api/security/catalog fallback", error instanceof Error ? error.message : "unknown");
    return NextResponse.json(fallbackCatalog(auth.context.authConfigured), { headers: { "Cache-Control": "no-store" } });
  }
}
