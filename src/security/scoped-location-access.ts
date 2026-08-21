import "server-only";

import { authorize } from "@/src/security/authorize";
import type { AccessContext } from "@/src/security/access-context";
import type { AccessScopeCode, PermissionCode } from "@/src/security/permissions";

type LocationWhere =
  | Record<string, never>
  | { locationId: string }
  | { locationId: { in: string[] } };

export type ScopedLocationAccess = {
  ok: true;
  context: AccessContext;
  grantedScope: AccessScopeCode;
  requestedLocationId: string | null;
  allowedLocationIds: string[] | null;
  locationWhere: LocationWhere;
};

export type ScopedLocationDenied = {
  ok: false;
  response: Response;
};

function forbidden(permission: string, error: string, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, error, permission, ...extra }, { status: 403 });
}

/**
 * Fail-closed helper for business data that is naturally scoped by locationId.
 *
 * ALL      -> optional requested location or all rows.
 * LOCATION -> only locations assigned to the current access context.
 * Other scopes are deliberately rejected until an endpoint implements a safe
 * row-level mapping for them.
 */
export async function authorizeScopedLocation(
  permission: PermissionCode | string,
  request: Request | Headers,
  requestedLocationId: string | null,
): Promise<ScopedLocationAccess | ScopedLocationDenied> {
  const decision = await authorize(permission, {
    request,
    strict: true,
    minimumScope: "SELF",
  });

  if (!decision.allowed || !decision.grantedScope) {
    return {
      ok: false,
      response: decision.response ?? forbidden(permission, "FORBIDDEN"),
    };
  }

  if (decision.grantedScope === "ALL") {
    return {
      ok: true,
      context: decision.context,
      grantedScope: decision.grantedScope,
      requestedLocationId,
      allowedLocationIds: null,
      locationWhere: requestedLocationId ? { locationId: requestedLocationId } : {},
    };
  }

  if (decision.grantedScope === "LOCATION") {
    const allowedLocationIds = Array.from(new Set(decision.context.locationIds.filter(Boolean)));
    if (!allowedLocationIds.length) {
      return {
        ok: false,
        response: forbidden(permission, "LOCATION_SCOPE_EMPTY", { grantedScope: decision.grantedScope }),
      };
    }
    if (requestedLocationId && !allowedLocationIds.includes(requestedLocationId)) {
      return {
        ok: false,
        response: forbidden(permission, "LOCATION_FORBIDDEN", {
          grantedScope: decision.grantedScope,
          requestedLocationId,
        }),
      };
    }
    return {
      ok: true,
      context: decision.context,
      grantedScope: decision.grantedScope,
      requestedLocationId,
      allowedLocationIds,
      locationWhere: requestedLocationId
        ? { locationId: requestedLocationId }
        : { locationId: { in: allowedLocationIds } },
    };
  }

  return {
    ok: false,
    response: forbidden(permission, "SCOPE_NOT_IMPLEMENTED", {
      grantedScope: decision.grantedScope,
      supportedScopes: ["LOCATION", "ALL"],
    }),
  };
}
