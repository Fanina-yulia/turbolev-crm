import type { AccessContext } from "@/src/security/access-context";
import type { ManagementActor } from "@/src/services/management-result.service";

export type ManagementRole = "OWNER" | "EXECUTIVE_DIRECTOR" | "STATION_MANAGER";

export function managementRole(context: AccessContext): ManagementRole | null {
  const codes = new Set(context.roles.map((item) => item.code));
  if (codes.has("OWNER")) return "OWNER";
  if (codes.has("EXECUTIVE_DIRECTOR")) return "EXECUTIVE_DIRECTOR";
  if (codes.has("STATION_MANAGER")) return "STATION_MANAGER";
  return null;
}

export function managementActor(context: AccessContext): ManagementActor | null {
  const role = managementRole(context);
  if (!role || !context.user) return null;
  return { id: context.user.id, name: context.user.name, role };
}

export function activeManagementContext(context: AccessContext) {
  return context.provisioningState === "ACTIVE" && Boolean(context.user) && Boolean(managementRole(context));
}
