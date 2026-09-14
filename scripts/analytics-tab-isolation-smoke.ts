import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const bridge = read("app/analytics-dashboard-walk-in-bridge.tsx");
const walkInApi = read("app/api/analytics/walk-in/route.ts");
const dashboard = read("app/analytics-dashboard.tsx");
const spec = read("docs/TZ_ANALYTICS_TAB_ISOLATION_V3.md");

assert.match(bridge, /data-walk-in-mode="overview-summary"/, "overview must use compact WALK-IN summary");
assert.match(bridge, /data-walk-in-mode="funnel-detail"/, "funnel must own the full WALK-IN detail panel");
assert.match(bridge, /tab !== "overview" && tab !== "funnel"/, "WALK-IN bridge must be hidden outside overview/funnel");
assert.match(bridge, /insertAdjacentElement\("afterend", host\)/, "WALK-IN host must be placed directly after shared filters");
assert.match(bridge, /Детально у воронці →/, "overview summary must lead to the funnel");
assert.match(bridge, /Конкретні завислі заїзди/, "funnel must expose actionable stuck visits");
assert.doesNotMatch(bridge, /↻ Оновити/, "WALK-IN must not duplicate the global refresh button");

for (const tab of ["overview", "funnel", "workshop", "diagnostics", "finance", "parts"]) {
  assert.match(dashboard, new RegExp(`tab === \\"${tab}\\"`), `native dashboard must retain dedicated ${tab} analytics`);
}
assert.match(dashboard, /\/api\/analytics\/diagnostics/, "diagnostics tab must use diagnostics analytics API");
assert.match(dashboard, /\/api\/analytics\/finance/, "finance tab must use finance analytics API");
assert.match(dashboard, /\/api\/analytics\/parts/, "parts tab must use parts analytics API");

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
