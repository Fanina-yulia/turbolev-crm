import { widerScope, type AccessScopeCode } from "@/src/security/permissions";

export type PermissionGrant = { code: string; scope: AccessScopeCode };
export type PermissionOverride = { code: string; scope: AccessScopeCode; effect: "ALLOW" | "DENY" };

export function computeEffectivePermissions(grants: PermissionGrant[], overrides: PermissionOverride[]) {
  const permissions: Record<string, AccessScopeCode> = {};
  for (const grant of grants) {
    permissions[grant.code] = permissions[grant.code]
      ? widerScope(permissions[grant.code], grant.scope)
      : grant.scope;
  }

  const denied = new Set<string>();
  for (const override of overrides) {
    if (override.effect === "DENY") {
      denied.add(override.code);
      delete permissions[override.code];
      continue;
    }
    if (denied.has(override.code)) continue;
    permissions[override.code] = permissions[override.code]
      ? widerScope(permissions[override.code], override.scope)
      : override.scope;
  }

  return { permissions, deniedPermissions: Array.from(denied).sort() };
}
