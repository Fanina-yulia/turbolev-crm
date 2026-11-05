import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

const checks = [
  { path: "app/api/clients/route.ts", all: ["CLIENTS_READ", "authorize("] },
  { path: "app/api/dashboard/route.ts", all: ["OVERVIEW_READ", "authorize("] },
  {
    path: "app/api/planner/route.ts",
    all: ["PLANNER_READ", "PLANNER_WRITE", "authorize(", "minimumScope: \"ASSIGNED\"", "resolvePlannerReadScope"],
  },
  {
    path: "app/api/planner/[id]/route.ts",
    all: ["PLANNER_WRITE", "authorize(", "minimumScope: \"ASSIGNED\"", "verifyPlannerWriteAccess"],
  },
  {
    path: "app/api/diagnostics/route.ts",
    all: ["DIAGNOSTICS_READ", "authorize(", "strict: true", "minimumScope: \"SELF\"", "diagnosticAssignment", "grantedScope !== \"ALL\""],
  },
  {
    path: "app/api/work-orders/route.ts",
    all: ["WORK_ORDERS_READ", "authorize(", "minimumScope: \"ASSIGNED\"", "resolveVisibleWorkOrderIds"],
  },
  {
    path: "app/api/work-orders/[id]/route.ts",
    all: ["WORK_ORDERS_READ", "WORK_ORDERS_WRITE", "authorize(", "canAccessWorkOrder", "minimumScope: \"ASSIGNED\"", "minimumScope: \"LOCATION\""],
  },
  { path: "app/api/communications/[id]/link-client/route.ts", all: ["COMMUNICATIONS_WRITE", "authorize("] },
  { path: "app/api/communications/[id]/messages/[messageId]/retry/route.ts", all: ["COMMUNICATIONS_WRITE", "authorize("] },
  { path: "app/api/communications/attachments/[attachmentId]/route.ts", all: ["COMMUNICATIONS_READ", "authorize("] },
  { path: "app/api/users/active/route.ts", all: ["OVERVIEW_READ", "authorize("] },
  { path: "app/api/supplier-quotes/route.ts", all: ["PROCUREMENT_READ", "authorize("] },
  { path: "app/api/vehicles/status-summary/route.ts", all: ["CLIENTS_READ", "authorize("] },
  { path: "app/api/vehicles/[id]/appearance/route.ts", all: ["CLIENTS_WRITE", "authorize("] },
  { path: "app/api/vehicles/[id]/image/render/route.ts", all: ["OVERVIEW_READ", "authorize("] },
  { path: "app/api/vehicles/vin/route.ts", all: ["OVERVIEW_READ", "authorize("] },
  { path: "app/api/vehicles/vin/batch/route.ts", all: ["OVERVIEW_READ", "authorize("] },
  { path: "app/api/vehicles/lookup/route.ts", all: ["OVERVIEW_READ", "authorize("] },
  { path: "app/api/vehicles/lookup-year/route.ts", all: ["OVERVIEW_READ", "authorize("] },
  { path: "app/api/vehicles/catalog/route.ts", all: ["OVERVIEW_READ", "authorize("] },
  { path: "app/api/vehicles/configurations/route.ts", all: ["OVERVIEW_READ", "authorize("] },
  { path: "app/api/planner/availability/route.ts", all: ["PLANNER_READ", "authorizeScopedLocation("] },
  { path: "app/api/planner/edit-context/route.ts", all: ["PLANNER_READ", "authorizeScopedLocation("] },
  { path: "app/api/finance/summary/route.ts", all: ["FINANCE_READ"], any: ["authorize(", "authorizeScopedLocation("] },
  { path: "app/api/finance/details/route.ts", all: ["FINANCE_READ"], any: ["authorize(", "authorizeScopedLocation("] },
  { path: "app/api/finance/accounts/route.ts", all: ["FINANCE_READ", "FINANCE_WRITE"], any: ["authorize(", "authorizeScopedLocation("] },
  { path: "app/api/payments/route.ts", all: ["PAYMENTS_READ"], any: ["authorize(", "authorizeScopedLocation("] },
  { path: "app/api/work-orders/[id]/payments/route.ts", all: ["PAYMENTS_WRITE"], any: ["authorize(", "authorizeScopedLocation("] },
  { path: "app/api/work-orders/[id]/finance/route.ts", all: ["FINANCE_READ", "FINANCE_WRITE"], any: ["authorize(", "authorizeScopedLocation("] },
  { path: "app/api/work-orders/[id]/finance/finalize/route.ts", all: ["FINANCE_WRITE"], any: ["authorize(", "authorizeScopedLocation("] },
  { path: "app/api/procurement/route.ts", all: ["PROCUREMENT_READ", "PROCUREMENT_WRITE", "authorizeScopedLocation("] },
  { path: "app/api/analytics/route.ts", all: ["getAccessContext", "ANALYTICS_READ"] },
  { path: "app/api/analytics/diagnostics/route.ts", all: ["getAccessContext", "ANALYTICS_READ"] },
  { path: "app/api/analytics/finance/route.ts", all: ["getAccessContext", "ANALYTICS_READ", "ANALYTICS_FINANCIAL_READ"] },
  { path: "app/api/analytics/parts/route.ts", all: ["getAccessContext", "ANALYTICS_READ"] },
  { path: "app/api/analytics/funnel-visuals/route.ts", all: ["ANALYTICS_READ", "authorizeScopedLocation("] },
];

const failures = [];
for (const check of checks) {
  const absolute = resolve(root, check.path);
  let source = "";
  try {
    source = readFileSync(absolute, "utf8");
  } catch {
    failures.push(`${check.path}: file missing`);
    continue;
  }
  for (const marker of check.all ?? []) {
    if (!source.includes(marker)) failures.push(`${check.path}: missing required security marker ${marker}`);
  }
  if (check.any?.length && !check.any.some((marker) => source.includes(marker))) {
    failures.push(`${check.path}: missing security gate (${check.any.join(" OR ")})`);
  }
}

if (failures.length) {
  console.error("[api-security-guard] FAIL");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(`[api-security-guard] OK — ${checks.length} critical API routes retain explicit security gates and row-scope markers.`);
