import "server-only";

import { getAccessContext, hasPermission, type AccessContext } from "@/src/security/access-context";
import type { PermissionCode } from "@/src/security/permissions";

type AuthorizationOptions = {
  strict?: boolean;
  request?: Request | Headers;
};

export type AuthorizationResult = {
  allowed: boolean;
  wouldAllow: boolean;
  shadowBypass: boolean;
  context: AccessContext;
  response: Response | null;
};

function denialResponse(context: AccessContext, permission: string) {
  if (!context.authenticated) {
    return Response.json({ ok: false, error: "UNAUTHENTICATED", permission }, { status: 401 });
  }
  if (context.provisioningState === "AUTHENTICATED_UNPROVISIONED") {
    return Response.json({ ok: false, error: "ACCESS_NOT_PROVISIONED", permission }, { status: 403 });
  }
  if (context.provisioningState === "INACTIVE") {
    return Response.json({ ok: false, error: "ACCOUNT_INACTIVE", permission }, { status: 403 });
  }
  return Response.json({ ok: false, error: "FORBIDDEN", permission }, { status: 403 });
}

export async function authorize(
  permission: PermissionCode | string,
  options: AuthorizationOptions = {},
): Promise<AuthorizationResult> {
  const context = await getAccessContext(options.request);
  const wouldAllow = hasPermission(context, permission);
  if (wouldAllow) {
    return { allowed: true, wouldAllow: true, shadowBypass: false, context, response: null };
  }

  const mustEnforce = options.strict === true || context.enforcementMode === "ENFORCED";
  if (mustEnforce) {
    return {
      allowed: false,
      wouldAllow: false,
      shadowBypass: false,
      context,
      response: denialResponse(context, permission),
    };
  }

  console.info("[security-shadow] permission would be denied", {
    permission,
    provisioningState: context.provisioningState,
    userId: context.user?.id ?? null,
    roles: context.roles.map((role) => role.code),
  });
  return { allowed: true, wouldAllow: false, shadowBypass: true, context, response: null };
}
