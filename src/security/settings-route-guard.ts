import "server-only";

import { authorize } from "@/src/security/authorize";
import type { AccessContext } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode, type PermissionCode } from "@/src/security/permissions";

export type RouteGuardResult =
  | { ok: true; context: AccessContext; actorName: string }
  | { ok: false; response: Response };

type Requirement = { permission: PermissionCode; minimumScope: AccessScopeCode };

function actorNameOf(context: AccessContext) {
  return context.user?.name || "CRM";
}

/**
 * Gate for controlled configuration (settings, price catalog, workflow metadata).
 * Reads need SETTINGS.READ, changes need SETTINGS.WRITE. Both are global (ALL)
 * because this data is not row-scoped; the actor is always taken from the session.
 */
export async function guardSettings(request: Request, write: boolean): Promise<RouteGuardResult> {
  const access = await authorize(write ? PERMISSIONS.SETTINGS_WRITE : PERMISSIONS.SETTINGS_READ, {
    strict: true,
    request,
    minimumScope: "ALL",
  });
  if (!access.allowed) return { ok: false, response: access.response! };
  return { ok: true, context: access.context, actorName: actorNameOf(access.context) };
}

/** Gate for supplier integration status/test endpoints (operational integration details). */
export async function guardIntegrations(request: Request): Promise<RouteGuardResult> {
  const access = await authorize(PERMISSIONS.SETTINGS_INTEGRATIONS, { strict: true, request, minimumScope: "ALL" });
  if (!access.allowed) return { ok: false, response: access.response! };
  return { ok: true, context: access.context, actorName: actorNameOf(access.context) };
}

/**
 * Passes when the caller holds at least one of the listed permissions. When all
 * are denied, the first denial response (401/403) is returned.
 */
export async function guardAnyPermission(request: Request, requirements: Requirement[]): Promise<RouteGuardResult> {
  let firstDenial: Response | null = null;
  for (const requirement of requirements) {
    const access = await authorize(requirement.permission, { strict: true, request, minimumScope: requirement.minimumScope });
    if (access.allowed) return { ok: true, context: access.context, actorName: actorNameOf(access.context) };
    if (!firstDenial) firstDenial = access.response!;
  }
  return { ok: false, response: firstDenial ?? Response.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }) };
}

/**
 * Labor price calculator used by the new-request wizard and the commercial
 * proposal panel. Staff who prepare estimates (and settings administrators) may
 * use it; roles without estimate/lead-write access (e.g. mechanics) may not.
 */
export function guardPricingCalculator(request: Request) {
  return guardAnyPermission(request, [
    { permission: PERMISSIONS.WORK_ORDERS_ESTIMATE, minimumScope: "LOCATION" },
    { permission: PERMISSIONS.LEADS_WRITE, minimumScope: "LOCATION" },
    { permission: PERMISSIONS.SETTINGS_READ, minimumScope: "ALL" },
  ]);
}
