from pathlib import Path
import json

# Owner / Executive cabinet integration.
p = Path("app/owner-dashboard.tsx")
s = p.read_text()
imp = 'import { OwnerDashboardVisual, type OwnerPeriodKey } from "./owner-dashboard-visual";\n'
if 'import { ManagementResultPanel } from "./management-result-panel";' not in s:
    if imp not in s:
        raise SystemExit("owner import anchor missing")
    s = s.replace(imp, imp + 'import { ManagementResultPanel } from "./management-result-panel";\n', 1)
visual = '    <OwnerDashboardVisual analytics={analytics} period={period} onPeriodChange={setPeriod} loading={loading} />\n'
if '<ManagementResultPanel mode={isExecutive ? "EXECUTIVE" : "OWNER"}' not in s:
    if visual not in s:
        raise SystemExit("owner visual anchor missing")
    s = s.replace(visual, visual + '\n    <ManagementResultPanel mode={isExecutive ? "EXECUTIVE" : "OWNER"} />\n', 1)
p.write_text(s)

# Station Manager cabinet integration.
p = Path("app/role-cabinet.tsx")
s = p.read_text()
imp = 'import { OwnerControlCenter } from "./owner-dashboard";\n'
if 'import { ManagementResultPanel } from "./management-result-panel";' not in s:
    if imp not in s:
        raise SystemExit("role import anchor missing")
    s = s.replace(imp, imp + 'import { ManagementResultPanel } from "./management-result-panel";\n', 1)
anchor = '    </header>\n\n    <section className={styles.managerKpis} aria-label="Ключові показники керівника станції">'
if '<ManagementResultPanel mode="STATION" locationId={data.station.id}' not in s:
    if anchor not in s:
        raise SystemExit("station panel anchor missing")
    s = s.replace(anchor, '    </header>\n\n    <ManagementResultPanel mode="STATION" locationId={data.station.id} />\n\n    <section className={styles.managerKpis} aria-label="Ключові показники керівника станції">', 1)
p.write_text(s)

# Enrich foundation panel.
p = Path("app/management-result-panel.tsx")
s = p.read_text()
imp = 'import styles from "./management-result-panel.module.css";\n'
extra_imp = 'import { ManagementIntelligencePanels, type ManagementIntelligenceUiPayload } from "./management-intelligence-panels";\n'
if extra_imp not in s:
    if imp not in s:
        raise SystemExit("management panel import anchor missing")
    s = s.replace(imp, imp + extra_imp, 1)
old = '  access?: { role?: string; canEditTarget?: boolean; canActivate?: boolean };\n};\n\nfunction currentKyivDateKey()'
new = '  access?: { role?: string; canEditTarget?: boolean; canActivate?: boolean; canEditBonusFormula?: boolean; canDistribute?: boolean; canClose?: boolean; canRedistributeStation?: boolean };\n} & ManagementIntelligenceUiPayload;\n\nfunction currentKyivDateKey()'
if old in s:
    s = s.replace(old, new, 1)
elif "& ManagementIntelligenceUiPayload;" not in s:
    raise SystemExit("management panel type anchor missing")
action_anchor = '      <div className={styles.actions}>\n'
advanced = '      <ManagementIntelligencePanels data={data} mode={mode} weekAnchor={weekAnchor} locationId={locationId} onRefresh={load} />\n\n'
if advanced.strip() not in s:
    if action_anchor not in s:
        raise SystemExit("management panel actions anchor missing")
    s = s.replace(action_anchor, advanced + action_anchor, 1)
p.write_text(s)

# API security inventory.
p = Path("src/security/api-policy.ts")
s = p.read_text()
rule = '  { match: prefix("/api/management"), resolve: () => internal(PERMISSIONS.OVERVIEW_READ, "LOCATION", "Management-result plans, forecasts, capacity, staffing and station bonus controls are authenticated role-scoped management APIs; handlers enforce Owner/Executive/Station boundaries and audit mutations.", true) },\n'
if rule not in s:
    anchor = '  { match: exact("/api/payments"), resolve: () => internal(PERMISSIONS.PAYMENTS_READ, "ALL", "Cashier queue is a payment read model; the route narrows records to the allowed station scope when configured.") },\n'
    if anchor not in s:
        raise SystemExit("api policy anchor missing")
    s = s.replace(anchor, anchor + rule, 1)
p.write_text(s)

# Canonical smoke suite.
p = Path("package.json")
package = json.loads(p.read_text())
smoke = package["scripts"]["contracts:smoke"]
after = "node --import tsx scripts/role-cabinet-contract-smoke.ts"
for addition in ["node --import tsx scripts/management-result-contract-smoke.ts", "node --import tsx scripts/management-intelligence-contract-smoke.ts"]:
    if addition not in smoke:
        smoke = smoke.replace(after, after + " && " + addition, 1)
        after = addition
package["scripts"]["contracts:smoke"] = smoke
p.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")

# Fix management intelligence query semantics and add staffing forecast.
p = Path("src/services/management-intelligence.service.ts")
s = p.read_text()
old = '      where: { isActive: true, effectiveFrom: { lte: dateOnly(week.end) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: dateOnly(week.start) } }], ...(locationIds.length ? { OR: [{ locationId: null }, { locationId: { in: locationIds } }] } : {}) },'
new = '      where: { isActive: true, effectiveFrom: { lte: dateOnly(week.end) }, AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: dateOnly(week.start) } }] }, ...(locationIds.length ? [{ OR: [{ locationId: null }, { locationId: { in: locationIds } }] }] : [])] },'
if old in s:
    s = s.replace(old, new, 1)
elif new not in s:
    raise SystemExit("scheme filter anchor missing")
old = '    select: { id: true, status: true, workOrderLineId: true },\n'
new = '    select: { id: true, status: true, workOrderLineId: true, workOrderLine: { select: { workOrderId: true, mechanicId: true } } },\n'
if old in s:
    s = s.replace(old, new, 1)
elif new not in s:
    raise SystemExit("warranty select anchor missing")
old = '    const locationWarranty = warrantyClaims.filter((claim) => laborLines.some((line) => line.id === claim.workOrderLineId && workOrderLocation.get(line.workOrderId) === locationResult.id)).length;\n'
new = '    const locationWarranty = warrantyClaims.filter((claim) => workOrderLocation.get(claim.workOrderLine.workOrderId) === locationResult.id).length;\n'
if old in s:
    s = s.replace(old, new, 1)
elif new not in s:
    raise SystemExit("location warranty anchor missing")
anchor = '  const freeLiftHours = Math.round(posts.reduce((sum, row) => sum + row.freeMinutes, 0) / 6) / 10;\n'
insert = (
    '  const requiredMechanicHours = roundMoney(appointments.filter((row) => ACTIVE_STATUSES.includes(row.status)).reduce((sum, row) => sum + minutesBetween(row.plannedStartAt, row.plannedEndAt), 0) / 60);\n'
    '  const scheduledMechanicHours = roundMoney(team.filter((row) => row.roleCode === "MECHANIC").reduce((sum, row) => sum + (row.availableMinutes || 0), 0) / 60);\n'
    '  const staffingGapHours = roundMoney(Math.max(0, requiredMechanicHours - scheduledMechanicHours));\n'
)
if "const requiredMechanicHours =" not in s:
    if anchor not in s:
        raise SystemExit("staffing anchor missing")
    s = s.replace(anchor, anchor + insert, 1)
return_anchor = '      unassignedActive,\n    },\n'
if '      requiredMechanicHours,\n' not in s:
    if return_anchor not in s:
        raise SystemExit("people return anchor missing")
    s = s.replace(return_anchor, '      unassignedActive,\n      requiredMechanicHours,\n      scheduledMechanicHours,\n      staffingGapHours,\n    },\n', 1)
p.write_text(s)

# Implementation status in source of truth.
p = Path("docs/TZ_MANAGEMENT_RESULT_CABINETS_V1.md")
s = p.read_text()
if "## 22. Implementation status\n" not in s:
    s += """

## 22. Implementation status
Implemented in `feature/management-result-complete-v1`:
- weekly Minimum/Target/Stretch/Break-even planning and audited state workflow;
- Owner approval, Executive station distribution, Station day/lift redistribution and acceptance;
- Plan/Fact/Cash In/confirmed/base/optimistic/weighted/pace forecasts;
- historical stage probabilities, persisted daily forecast snapshots and automatic deviation attribution;
- capacity/lift utilization and gap-closing recommendations;
- EmployeeShift scheduling, team utilization, employee economics/KPI contribution;
- configurable Station Manager bonus, quality gates, preliminary result and finalization into payroll BONUS when a payroll period exists;
- role-scoped Owner / Executive Director / Station Manager UI and API security inventory.

Production facts remain immutable sources of truth. Management tables are an additive planning/read-model layer.
"""
p.write_text(s)
