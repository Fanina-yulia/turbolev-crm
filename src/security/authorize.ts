import "server-only";

import { getAccessContext, hasPermission, type AccessContext } from "@/src/security/access-context";
import { scopeCovers, type AccessScopeCode, type PermissionCode } from "@/src/security/permissions";

type AuthorizationOptions = {
  strict?: boolean;
  request?: Request | Headers;
  /**
   * Minimum scope the caller has implemented safely. Defaults to ALL so an
   * endpoint that forgets row-level filtering cannot accidentally turn
   * ASSIGNED/TEAM/LOCATION into global access.
   */
  minimumScope?: AccessScopeCode;
};

export type AuthorizationResult = {
  allowed: boolean;
  wouldAllow: boolean;
  shadowBypass: boolean;
  context: AccessContext;
  grantedScope: AccessScopeCode | null;
  response: Response | null;
};

function denialResponse(context: AccessContext, permission: string, requiredScope: AccessScopeCode) {
  if (!context.authenticated) {
    return Response.json({ ok: false, error: "UNAUTHENTICATED", permission }, { status: 401 });
  }
  if (context.provisioningState === "AUTHENTICATED_UNPROVISIONED") {
    return Response.json({ ok: false, error: "ACCESS_NOT_PROVISIONED", permission }, { status: 403 });
  }
  if (context.provisioningState === "INACTIVE") {
    return Response.json({ ok: false, error: "ACCOUNT_INACTIVE", permission }, { status: 403 });
  }
  const actualScope = context.permissions[permission] ?? null;
  if (actualScope && !scopeCovers(actualScope, requiredScope)) {
    return Response.json(
      { ok: false, error: "SCOPE_NOT_IMPLEMENTED", permission, grantedScope: actualScope, requiredScope },
      { status: 403 },
    );
  }
  return Response.json({ ok: false, error: "FORBIDDEN", permission }, { status: 403 });
}

export async function authorize(
  permission: PermissionCode | string,
  options: AuthorizationOptions = {},
): Promise<AuthorizationResult> {
  const context = await getAccessContext(options.request);
  const requiredScope = options.minimumScope ?? "ALL";
  const grantedScope = context.permissions[permission] ?? null;
  const wouldAllow = hasPermission(context, permission) && scopeCovers(grantedScope, requiredScope);
  if (wouldAllow) {
    return { allowed: true, wouldAllow: true, shadowBypass: false, context, grantedScope, response: null };
  }

  const mustEnforce = options.strict === true || context.enforcementMode === "ENFORCED";
  if (mustEnforce) {
    return {
      allowed: false,
      wouldAllow: false,
      shadowBypass: false,
      context,
      grantedScope,
      response: denialResponse(context, permission, requiredScope),
    };
  }

  console.info("[security-shadow] permission would be denied", {
    permission,
    grantedScope,
    requiredScope,
    provisioningState: context.provisioningState,
    userId: context.user?.id ?? null,
    roles: context.roles.map((role) => role.code),
  });
  return { allowed: true, wouldAllow: false, shadowBypass: true, context, grantedScope, response: null };
}
