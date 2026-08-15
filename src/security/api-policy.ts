import { PERMISSIONS, type AccessScopeCode, type PermissionCode } from "@/src/security/permissions";

export type ApiSecurityKind = "AUTH_PUBLIC" | "SESSION_STATUS" | "EXTERNAL_PROVIDER" | "INTERNAL_RBAC";

export type ApiSecurityPolicy = {
  kind: ApiSecurityKind;
  permission?: PermissionCode;
  intendedScope?: AccessScopeCode;
  strict?: boolean;
  note: string;
};

type Rule = {
  match: (path: string) => boolean;
  resolve: (method: string) => ApiSecurityPolicy;
};

function internal(permission: PermissionCode, intendedScope: AccessScopeCode, note: string, strict = false): ApiSecurityPolicy {
  return { kind: "INTERNAL_RBAC", permission, intendedScope, strict, note };
}

function readWrite(
  method: string,
  readPermission: PermissionCode,
  writePermission: PermissionCode,
  intendedScope: AccessScopeCode,
  note: string,
): ApiSecurityPolicy {
  const read = method.toUpperCase() === "GET";
  return internal(read ? readPermission : writePermission, intendedScope, note);
}

const exact = (value: string) => (path: string) => path === value;
const prefix = (value: string) => (path: string) => path === value || path.startsWith(`${value}/`);

const RULES: Rule[] = [
  {
    match: exact("/api/auth/me"),
    resolve: () => ({ kind: "SESSION_STATUS", note: "Safe session/provisioning status; no secrets or business data." }),
  },
  {
    match: prefix("/api/auth"),
    resolve: () => ({ kind: "AUTH_PUBLIC", note: "Allowlisted Neon Auth transport only: sign-in, sign-out, get-session." }),
  },
  {
    match: prefix("/api/webhooks"),
    resolve: () => ({ kind: "EXTERNAL_PROVIDER", note: "Inbound provider callback authenticated by provider/webhook controls, not employee session." }),
  },
  {
    match: exact("/api/telephony/binotel-webhook"),
    resolve: () => ({ kind: "EXTERNAL_PROVIDER", note: "Binotel callback authenticated with dedicated webhook token/provider contract." }),
  },
  {
    match: exact("/api/camera-events/email"),
    resolve: () => ({ kind: "EXTERNAL_PROVIDER", note: "Reolink Gmail bridge callback authenticated by a dedicated per-camera ingest token." }),
  },
  {
    match: prefix("/api/security"),
    resolve: () => internal(PERMISSIONS.SECURITY_ACCESS_MANAGE, "ALL", "Security administration is always strict.", true),
  },
  {
    match: exact("/api/me/compensation"),
    resolve: () => internal(PERMISSIONS.PAYROLL_SELF_READ, "SELF", "Authenticated employee can read only own salary projection.", true),
  },
  {
    match: exact("/api/audit"),
    resolve: () => internal(PERMISSIONS.AUDIT_READ, "ALL", "Audit log is sensitive and never inherits generic analytics access."),
  },
  {
    match: exact("/api/personnel"),
    resolve: (method) => readWrite(method, PERMISSIONS.PERSONNEL_READ, PERMISSIONS.PERSONNEL_WRITE, "ALL", "Personnel endpoint; compensation is independently redacted."),
  },
  {
    match: prefix("/api/finance"),
    resolve: (method) => readWrite(method, PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_WRITE, "ALL", "Financial center and accounts."),
  },
  {
    match: (path) => /^\/api\/work-orders\/[^/]+\/payments(?:\/|$)/.test(path),
    resolve: (method) => readWrite(method, PERMISSIONS.PAYMENTS_READ, PERMISSIONS.PAYMENTS_WRITE, "ALL", "WorkOrder payment operations."),
  },
  {
    match: (path) => /^\/api\/work-orders\/[^/]+\/finance(?:\/|$)/.test(path),
    resolve: (method) => readWrite(method, PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_WRITE, "ALL", "WorkOrder financial facts and finalization."),
  },
  {
    match: (path) => /^\/api\/work-orders\/[^/]+\/qc(?:\/|$)/.test(path),
    resolve: (method) => readWrite(method, PERMISSIONS.QC_READ, PERMISSIONS.QC_WRITE, "LOCATION", "Quality-control operations; location/assignment filtering must be implemented before enforcement for scoped roles."),
  },
  {
    match: (path) => /^\/api\/work-orders\/[^/]+\/parts-request(?:\/|$)/.test(path),
    resolve: (method) => readWrite(method, PERMISSIONS.PROCUREMENT_READ, PERMISSIONS.PROCUREMENT_WRITE, "LOCATION", "Parts request generated from WorkOrder."),
  },
  {
    match: (path) => /^\/api\/work-orders\/[^/]+\/estimate(?:\/|$)/.test(path),
    resolve: (method) => readWrite(method, PERMISSIONS.WORK_ORDERS_READ, PERMISSIONS.WORK_ORDERS_ESTIMATE, "LOCATION", "Estimate and client-approval workflow."),
  },
  {
    match: prefix("/api/work-orders"),
    resolve: (method) => readWrite(method, PERMISSIONS.WORK_ORDERS_READ, PERMISSIONS.WORK_ORDERS_WRITE, "LOCATION", "Canonical WorkOrder lifecycle."),
  },
  {
    match: prefix("/api/diagnostics"),
    resolve: (method) => readWrite(method, PERMISSIONS.DIAGNOSTICS_READ, PERMISSIONS.DIAGNOSTICS_WRITE, "LOCATION", "Diagnostic requests and conclusions."),
  },
  {
    match: prefix("/api/planner"),
    resolve: (method) => readWrite(method, PERMISSIONS.PLANNER_READ, PERMISSIONS.PLANNER_WRITE, "LOCATION", "Service planner."),
  },
  {
    match: prefix("/api/communications"),
    resolve: (method) => readWrite(method, PERMISSIONS.COMMUNICATIONS_READ, PERMISSIONS.COMMUNICATIONS_WRITE, "TEAM", "Omnichannel inquiries and messages."),
  },
  {
    match: prefix("/api/leads"),
    resolve: (method) => readWrite(method, PERMISSIONS.LEADS_READ, PERMISSIONS.LEADS_WRITE, "TEAM", "Sales lead workflow."),
  },
  {
    match: exact("/api/intake"),
    resolve: () => internal(PERMISSIONS.LEADS_WRITE, "TEAM", "New request intake creates/updates sales pipeline facts."),
  },
  {
    match: exact("/api/dashboard"),
    resolve: () => internal(PERMISSIONS.OVERVIEW_READ, "LOCATION", "Operational station overview."),
  },
  {
    match: (path) => prefix("/api/client-card")(path) || path === "/api/clients-vehicles" || prefix("/api/vehicles")(path),
    resolve: (method) => readWrite(method, PERMISSIONS.CLIENTS_READ, PERMISSIONS.CLIENTS_WRITE, "TEAM", "Client and vehicle intelligence/read models."),
  },
  {
    match: prefix("/api/parts-requests"),
    resolve: (method) => readWrite(method, PERMISSIONS.PROCUREMENT_READ, PERMISSIONS.PROCUREMENT_WRITE, "LOCATION", "Parts request lifecycle."),
  },
  {
    match: prefix("/api/parts"),
    resolve: (method) => readWrite(method, PERMISSIONS.PARTS_READ, PERMISSIONS.PARTS_WRITE, "LOCATION", "Part search and supplier offers."),
  },
  {
    match: exact("/api/supplier-quotes"),
    resolve: (method) => readWrite(method, PERMISSIONS.PROCUREMENT_READ, PERMISSIONS.PROCUREMENT_WRITE, "LOCATION", "Supplier quote collection."),
  },
  {
    match: prefix("/api/suppliers"),
    resolve: () => internal(PERMISSIONS.SETTINGS_INTEGRATIONS, "ALL", "Supplier integration status/test contains operational integration details."),
  },
  {
    match: exact("/api/telephony/binotel-health"),
    resolve: () => internal(PERMISSIONS.SETTINGS_INTEGRATIONS, "ALL", "Telephony integration health is an integration-administration concern."),
  },
  {
    match: prefix("/api/settings/integrations"),
    resolve: () => internal(PERMISSIONS.SETTINGS_INTEGRATIONS, "ALL", "Integration configuration and credential operations."),
  },
  {
    match: prefix("/api/settings"),
    resolve: (method) => readWrite(method, PERMISSIONS.SETTINGS_READ, PERMISSIONS.SETTINGS_WRITE, "ALL", "CRM operational settings."),
  },
  {
    match: exact("/api/work-prices"),
    resolve: (method) => readWrite(method, PERMISSIONS.SETTINGS_READ, PERMISSIONS.SETTINGS_WRITE, "ALL", "Labor price catalog is controlled configuration."),
  },
  {
    match: prefix("/api/workflow"),
    resolve: () => internal(PERMISSIONS.SETTINGS_READ, "ALL", "Workflow/status architecture presentation and validation metadata."),
  },
  {
    match: exact("/api/users/active"),
    resolve: () => internal(PERMISSIONS.PERSONNEL_READ, "LOCATION", "Operational picker of active staff; response must remain minimal."),
  },
];

export function resolveApiSecurityPolicy(path: string, method = "GET"): ApiSecurityPolicy | null {
  const normalized = path.split("?")[0].replace(/\/$/, "") || "/";
  for (const rule of RULES) {
    if (rule.match(normalized)) return rule.resolve(method.toUpperCase());
  }
  return null;
}
