import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const layout = read("app/layout.tsx");
const walkInApi = read("app/api/analytics/walk-in/route.ts");
const dashboard = read("app/analytics-dashboard.tsx");
const spec = read("docs/TZ_ANALYTICS_TAB_ISOLATION_V3.md");

assert.doesNotMatch(layout, /AnalyticsDashboardWalkInBridge/, "WALK-IN presentation block must not be mounted in the analytics UI");
assert.doesNotMatch(layout, /analytics-dashboard-walk-in-bridge/, "layout must not import the retired WALK-IN bridge");

assert.doesNotMatch(dashboard, /Порівняння/, "Analytics toolbar must not render comparison controls");
assert.doesNotMatch(dashboard, /moreAnalytics|<summary>Далі<\/summary>/, "Analytics toolbar must not render the secondary Далі menu");
assert.match(dashboard, /const range = presetRange\(next\); setFrom\(range\.from\); setTo\(range\.to\);/, "period presets must immediately update From/To fields");
assert.match(dashboard, /useLayoutEffect\(\(\) => \{[\s\S]*parent\.scrollTop = 0;[\s\S]*\}, \[tab\]\);/, "analytics tab switches must reset the page-owned scroll position");

for (const tab of ["overview", "funnel", "workshop", "diagnostics", "finance", "parts"]) {
  assert.match(dashboard, new RegExp(`tab === \\"${tab}\\"`), `native dashboard must retain dedicated ${tab} analytics`);
}
assert.match(dashboard, /target !== "diagnostics" && target !== "finance" && target !== "parts"/, "detail dispatcher must be limited to diagnostics, finance and parts");
assert.match(dashboard, /const endpoint = target/, "detail dispatcher must map each active detail tab to its matching endpoint");
assert.match(dashboard, /fetch\(`\/api\/analytics\/\$\{endpoint\}\?/, "detail tabs must fetch their own analytics endpoint");

assert.match(walkInApi, /prisma\.diagnosticVisitLink\.findMany/, "DiagnosticVisitLink must be the canonical appointment/diagnostic relation");
assert.match(walkInApi, /canonicalByAppointment\.get\(row\.id\) \|\| diagnosticIdFromComment/, "legacy comment marker must be fallback only");
assert.match(walkInApi, /NOT: \{ id: \{ startsWith: "demo_" \} \}/, "demo appointments must be excluded");
assert.match(walkInApi, /status: "POSTED"/, "WALK-IN revenue/payment facts must use POSTED transactions");
assert.match(walkInApi, /WALK_IN_SENT_TO_REPAIR_FLOW/, "repair transition must use the audited business event");
assert.match(walkInApi, /actions: \{\s*awaitingPayment:/s, "API must return exact awaiting-payment appointment actions");
assert.match(walkInApi, /awaitingRoute: awaitingRouteRows\.map\(actionRow\)/, "API must return exact paid-without-route appointment actions");
assert.match(walkInApi, /appointmentId: row\.id/, "action drill-down must contain appointmentId");
assert.match(walkInApi, /diagnosticId: diagnosticIdFor\(row\)/, "action drill-down must contain diagnosticId when known");
assert.match(walkInApi, /ANALYTICS_FINANCIAL_READ/, "financial WALK-IN facts must remain permission-gated");

assert.match(spec, /жодних вигаданих цифр/i, "spec must explicitly forbid fabricated analytics");
assert.match(spec, /ServiceAppointment\.source = WALK_IN/, "spec must define real WALK-IN source of truth");
assert.match(spec, /DiagnosticVisitLink/, "spec must document canonical diagnostic linkage");
assert.match(spec, /Acceptance criteria/, "spec must define acceptance criteria");

console.log("Analytics tab isolation / business-truth smoke: PASS");
