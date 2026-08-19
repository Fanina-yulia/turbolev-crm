import { PERMISSIONS, type AccessScopeCode, type PermissionCode } from "@/src/security/permissions";

export type ApiSecurityKind = "AUTH_PUBLIC" | "SESSION_STATUS" | "EXTERNAL_PROVIDER" | "PUBLIC_TOKEN" | "INTERNAL_RBAC";

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
  { match: exact("/api/auth/me"), resolve: () => ({ kind: "SESSION_STATUS", note: "Safe session/provisioning status; no secrets or business data." }) },
  { match: prefix("/api/auth"), resolve: () => ({ kind: "AUTH_PUBLIC", note: "Allowlisted Neon Auth transport only: sign-in, sign-out, get-session." }) },
  { match: prefix("/api/public/diagnostic-report"), resolve: () => ({ kind: "PUBLIC_TOKEN", note: "Client-facing immutable diagnostic report authenticated by a high-entropy single-purpose token stored only as SHA-256 hash; routes validate expiry, revision freshness and media membership." }) },
  { match: prefix("/api/webhooks"), resolve: () => ({ kind: "EXTERNAL_PROVIDER", note: "Inbound provider callback authenticated by provider/webhook controls, not employee session." }) },
  { match: exact("/api/integrations/olx/callback"), resolve: () => ({ kind: "EXTERNAL_PROVIDER", note: "OLX OAuth callback authenticated with signed short-lived state and provider authorization code." }) },
  { match: exact("/api/integrations/olx/connect"), resolve: () => internal(PERMISSIONS.SETTINGS_INTEGRATIONS, "ALL", "Starting OLX OAuth changes integration credentials and requires integration administration.", true) },
  { match: (path) => path === "/api/integrations/olx/sync" || path === "/api/integrations/olx/poll", resolve: () => internal(PERMISSIONS.COMMUNICATIONS_WRITE, "TEAM", "OLX synchronization imports communication facts into the omnichannel inbox.", true) },
  { match: exact("/api/integrations/communications/status"), resolve: () => internal(PERMISSIONS.COMMUNICATIONS_READ, "TEAM", "Communication integration health is visible to authorized inbox operators without returning secrets.", true) },
  { match: exact("/api/telephony/binotel-webhook"), resolve: () => ({ kind: "EXTERNAL_PROVIDER", note: "Binotel callback authenticated with dedicated webhook token/provider contract." }) },
  { match: exact("/api/camera-events/email"), resolve: () => ({ kind: "EXTERNAL_PROVIDER", note: "Reolink Gmail bridge callback authenticated by a dedicated per-camera ingest token." }) },
  { match: prefix("/api/telephony/binotel-employees"), resolve: () => internal(PERMISSIONS.SETTINGS_INTEGRATIONS, "ALL", "Binotel employee/extension mapping is integration administration.", true) },
  { match: exact("/api/telephony/call"), resolve: () => internal(PERMISSIONS.COMMUNICATIONS_WRITE, "TEAM", "Authenticated click-to-call through the caller's own mapped Binotel extension.", true) },
  { match: exact("/api/telephony/live"), resolve: () => internal(PERMISSIONS.COMMUNICATIONS_READ, "TEAM", "Authenticated live incoming-call feed for CRM popup.", true) },
  { match: exact("/api/telephony/recordings/sync"), resolve: () => internal(PERMISSIONS.COMMUNICATIONS_WRITE, "TEAM", "Reconcile missing Binotel recording links for authorized communication staff.", true) },
  { match: prefix("/api/telephony/recordings"), resolve: () => internal(PERMISSIONS.COMMUNICATIONS_READ, "TEAM", "Protected access to Binotel call recordings.", true) },
  { match: prefix("/api/security"), resolve: () => internal(PERMISSIONS.SECURITY_ACCESS_MANAGE, "ALL", "Security administration is always strict.", true) },
  { match: exact("/api/me/compensation"), resolve: () => internal(PERMISSIONS.PAYROLL_SELF_READ, "SELF", "Authenticated employee can read only own salary projection.", true) },
  { match: exact("/api/me/ui-preferences"), resolve: () => internal(PERMISSIONS.OVERVIEW_READ, "SELF", "Authenticated employee can read and update only own accessibility/readability preferences.", true) },
  { match: exact("/api/cabinet/home"), resolve: () => internal(PERMISSIONS.OVERVIEW_READ, "LOCATION", "Authenticated role-specific cabinet. Response is narrowed server-side to assigned mechanic work or the manager's station and excludes global finance.", true) },
  { match: prefix("/api/cabinet/mechanic/tasks"), resolve: (method) => readWrite(method, PERMISSIONS.PRODUCTION_READ, PERMISSIONS.PRODUCTION_WRITE, "ASSIGNED", "Mechanic lifecycle controls are restricted to the caller's assigned WorkOrder lines and reuse canonical production transitions.") },
  { match: prefix("/api/cabinet/mechanic/findings"), resolve: (method) => readWrite(method, PERMISSIONS.DIAGNOSTICS_READ, PERMISSIONS.DIAGNOSTICS_WRITE, "ASSIGNED", "Mechanic findings may be created only against the caller's assigned WorkOrder lines and carry protected diagnostic-style media.") },
  { match: prefix("/api/cabinet/findings"), resolve: () => internal(PERMISSIONS.DIAGNOSTICS_READ, "LOCATION", "Mechanic finding media is authenticated and limited to the submitting mechanic or operational staff for the same station.", true) },
  { match: exact("/api/cabinet/service-advisor"), resolve: () => internal(PERMISSIONS.OVERVIEW_READ, "LOCATION", "Service-advisor cabinet is authenticated and station-scoped; the route also enforces the SERVICE_ADVISOR role.", true) },
  { match: exact("/api/search"), resolve: () => internal(PERMISSIONS.OVERVIEW_READ, "LOCATION", "Global CRM search requires operational overview access; the route additionally filters client and WorkOrder result types by their own permissions and assignment/location scope.") },
  { match: exact("/api/audit"), resolve: () => internal(PERMISSIONS.AUDIT_READ, "ALL", "Audit log is sensitive and never inherits generic analytics access.") },
  { match: (path) => path === "/api/personnel/access-catalog" || /^\/api\/personnel\/[^/]+\/access$/.test(path), resolve: () => internal(PERMISSIONS.PERSONNEL_WRITE, "LOCATION", "Delegated employee/cabinet administration is always authenticated and station-scoped when applicable.", true) },
  {
    match: prefix("/api/personnel"),
    resolve: (method) => method.toUpperCase() === "GET"
      ? internal(PERMISSIONS.PERSONNEL_READ, "SELF", "Personnel nested reads, documents and v2 catalog require personnel read access; route handlers enforce row/location scope.")
      : internal(PERMISSIONS.PERSONNEL_WRITE, "LOCATION", "Personnel nested mutations, documents, photos and v2 role operations require strict location-scoped personnel write access.", true),
  },
  {
    match: exact("/api/personnel"),
    resolve: (method) => method.toUpperCase() === "GET"
      ? internal(PERMISSIONS.PERSONNEL_READ, "SELF", "Personnel read model applies server-side row scope and independently redacts compensation.")
      : internal(PERMISSIONS.PERSONNEL_WRITE, "LOCATION", "Personnel mutations are strict and atomically enforce role delegation, station scope and cabinet access.", true),
  },
  { match: exact("/api/payments"), resolve: () => internal(PERMISSIONS.PAYMENTS_READ, "ALL", "Cashier queue is a payment read model; the route narrows records to the allowed station scope when configured.") },
  { match: prefix("/api/finance"), resolve: (method) => readWrite(method, PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_WRITE, "ALL", "Financial center and accounts.") },
  { match: prefix("/api/production"), resolve: (method) => readWrite(method, PERMISSIONS.PRODUCTION_READ, PERMISSIONS.PRODUCTION_WRITE, "LOCATION", "Production board is station-scoped; mechanics are further narrowed to assigned appointments or WorkOrder lines.") },
  { match: exact("/api/procurement"), resolve: (method) => readWrite(method, PERMISSIONS.PROCUREMENT_READ, PERMISSIONS.PROCUREMENT_WRITE, "LOCATION", "Procurement queue is station-scoped and requires procurement read/write permissions.") },
  { match: prefix("/api/qc"), resolve: (method) => readWrite(method, PERMISSIONS.QC_READ, PERMISSIONS.QC_WRITE, "LOCATION", "Quality-control queue is station-scoped and reuses canonical WorkOrder QC attempts and transitions.") },
  { match: (path) => /^\/api\/work-orders\/[^/]+\/payments(?:\/|$)/.test(path), resolve: (method) => readWrite(method, PERMISSIONS.PAYMENTS_READ, PERMISSIONS.PAYMENTS_WRITE, "ALL", "WorkOrder payment operations.") },
  { match: (path) => /^\/api\/work-orders\/[^/]+\/finance(?:\/|$)/.test(path), resolve: (method) => readWrite(method, PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_WRITE, "ALL", "WorkOrder financial facts and finalization.") },
  { match: (path) => /^\/api\/work-orders\/[^/]+\/qc(?:\/|$)/.test(path), resolve: (method) => readWrite(method, PERMISSIONS.QC_READ, PERMISSIONS.QC_WRITE, "LOCATION", "Quality-control operations; location/assignment filtering must be implemented before enforcement for scoped roles.") },
  { match: (path) => /^\/api\/work-orders\/[^/]+\/parts-request(?:\/|$)/.test(path), resolve: (method) => readWrite(method, PERMISSIONS.PROCUREMENT_READ, PERMISSIONS.PROCUREMENT_WRITE, "LOCATION", "Parts request generated from WorkOrder.") },
  { match: (path) => /^\/api\/work-orders\/[^/]+\/estimate(?:\/|$)/.test(path), resolve: (method) => readWrite(method, PERMISSIONS.WORK_ORDERS_READ, PERMISSIONS.WORK_ORDERS_ESTIMATE, "LOCATION", "Estimate and client-approval workflow.") },
  { match: prefix("/api/work-orders"), resolve: (method) => readWrite(method, PERMISSIONS.WORK_ORDERS_READ, PERMISSIONS.WORK_ORDERS_WRITE, "LOCATION", "Canonical WorkOrder lifecycle.") },
  { match: (path) => /^\/api\/diagnostics\/[^/]+\/report$/.test(path), resolve: (method) => internal(method.toUpperCase() === "GET" ? PERMISSIONS.DIAGNOSTICS_READ : PERMISSIONS.DIAGNOSTICS_CONFIRM, "LOCATION", "Client report share management is location-scoped; creating or revoking a public link requires diagnostic confirmation authority.", method.toUpperCase() !== "GET") },
  { match: (path) => /^\/api\/diagnostics\/[^/]+\/commercial-handoff$/.test(path), resolve: (method) => internal(method.toUpperCase() === "GET" ? PERMISSIONS.WORK_ORDERS_READ : PERMISSIONS.WORK_ORDERS_ESTIMATE, "LOCATION", "Structured diagnostic recommendations may be previewed with WorkOrder read access and imported as DRAFT estimate lines only by estimate-authorized staff.", method.toUpperCase() !== "GET") },
  { match: prefix("/api/diagnostics"), resolve: (method) => readWrite(method, PERMISSIONS.DIAGNOSTICS_READ, PERMISSIONS.DIAGNOSTICS_WRITE, "LOCATION", "Diagnostic requests, structured checks, media and conclusions; route handlers apply ASSIGNED/LOCATION narrowing and separate confirmation permission.") },
  { match: prefix("/api/planner"), resolve: (method) => readWrite(method, PERMISSIONS.PLANNER_READ, PERMISSIONS.PLANNER_WRITE, "LOCATION", "Service planner.") },
  { match: prefix("/api/communications"), resolve: (method) => readWrite(method, PERMISSIONS.COMMUNICATIONS_READ, PERMISSIONS.COMMUNICATIONS_WRITE, "TEAM", "Omnichannel inquiries and messages.") },
  { match: prefix("/api/leads"), resolve: (method) => readWrite(method, PERMISSIONS.LEADS_READ, PERMISSIONS.LEADS_WRITE, "TEAM", "Sales lead workflow.") },
  { match: exact("/api/intake"), resolve: () => internal(PERMISSIONS.LEADS_WRITE, "TEAM", "New request intake creates/updates sales pipeline facts.") },
  { match: exact("/api/dashboard"), resolve: () => internal(PERMISSIONS.OVERVIEW_READ, "LOCATION", "Operational station overview.") },
  { match: prefix("/api/vehicle-images/library"), resolve: () => internal(PERMISSIONS.SETTINGS_INTEGRATIONS, "ALL", "Vehicle image library review, paid regeneration and manual replacement.", true) },
  {
    match: (path) => prefix("/api/client-card")(path) || prefix("/api/clients")(path) || path === "/api/clients-vehicles" || prefix("/api/vehicles")(path) || prefix("/api/vehicle-images")(path),
    resolve: (method) => readWrite(method, PERMISSIONS.CLIENTS_READ, PERMISSIONS.CLIENTS_WRITE, "TEAM", "Client and vehicle intelligence/read models, including protected vehicle render proxies."),
  },
  { match: prefix("/api/parts-requests"), resolve: (method) => readWrite(method, PERMISSIONS.PROCUREMENT_READ, PERMISSIONS.PROCUREMENT_WRITE, "LOCATION", "Parts request lifecycle.") },
  { match: prefix("/api/parts"), resolve: (method) => readWrite(method, PERMISSIONS.PARTS_READ, PERMISSIONS.PARTS_WRITE, "LOCATION", "Part search and supplier offers.") },
  { match: exact("/api/supplier-quotes"), resolve: (method) => readWrite(method, PERMISSIONS.PROCUREMENT_READ, PERMISSIONS.PROCUREMENT_WRITE, "LOCATION", "Supplier quote collection.") },
  { match: prefix("/api/suppliers"), resolve: () => internal(PERMISSIONS.SETTINGS_INTEGRATIONS, "ALL", "Supplier integration status/test contains operational integration details.") },
  { match: exact("/api/telephony/binotel-health"), resolve: () => internal(PERMISSIONS.SETTINGS_INTEGRATIONS, "ALL", "Telephony integration health is an integration-administration concern.") },
  { match: prefix("/api/settings/integrations"), resolve: () => internal(PERMISSIONS.SETTINGS_INTEGRATIONS, "ALL", "Integration configuration and credential operations.") },
  { match: prefix("/api/settings"), resolve: (method) => readWrite(method, PERMISSIONS.SETTINGS_READ, PERMISSIONS.SETTINGS_WRITE, "ALL", "CRM operational settings.") },
  { match: exact("/api/work-prices"), resolve: (method) => readWrite(method, PERMISSIONS.SETTINGS_READ, PERMISSIONS.SETTINGS_WRITE, "ALL", "Labor price catalog is controlled configuration.") },
  { match: prefix("/api/workflow"), resolve: () => internal(PERMISSIONS.SETTINGS_READ, "ALL", "Workflow/status architecture presentation and validation metadata.") },
  { match: exact("/api/users/active"), resolve: () => internal(PERMISSIONS.PERSONNEL_READ, "LOCATION", "Operational picker of active staff; response must remain minimal.") },
];

export function resolveApiSecurityPolicy(path: string, method = "GET"): ApiSecurityPolicy | null {
  const normalized = path.split("?")[0].replace(/\/$/, "") || "/";
  for (const rule of RULES) {
    if (rule.match(normalized)) return rule.resolve(method.toUpperCase());
  }
  return null;
}
