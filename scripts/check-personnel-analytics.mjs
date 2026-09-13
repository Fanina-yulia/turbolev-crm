import fs from "node:fs";

const files = {
  service: "src/services/personnel-operational-analytics.service.ts",
  route: "app/api/analytics/personnel/route.ts",
  panel: "app/analytics-personnel-panel.tsx",
  bridge: "app/analytics-personnel-bridge.tsx",
  workspace: "app/analytics-workspace.tsx",
};

for (const [name, path] of Object.entries(files)) {
  if (!fs.existsSync(path)) throw new Error(`[personnel-analytics] missing ${name}: ${path}`);
}

const service = fs.readFileSync(files.service, "utf8");
const route = fs.readFileSync(files.route, "utf8");
const panel = fs.readFileSync(files.panel, "utf8");
const bridge = fs.readFileSync(files.bridge, "utf8");
const workspace = fs.readFileSync(files.workspace, "utf8");

const checks = [
  [route.includes("PERMISSIONS.ANALYTICS_PERSONNEL_READ"), "route must enforce ANALYTICS_PERSONNEL_READ"],
  [route.includes("Cache-Control\": \"no-store"), "route must be no-store"],
  [service.includes('type: "LABOR"') && service.includes('status: "COMPLETED"'), "labor KPI must use completed LABOR lines"],
  [service.includes("startedAt") && service.includes("completedAt"), "efficiency must use factual timing"],
  [service.includes("operationalBlocker.findMany"), "blocker KPI must read OperationalBlocker"],
  [service.includes("workOrderQualityControl.findMany") && service.includes("attempt: 1"), "first-pass KPI must use QC attempt 1"],
  [service.includes("Не є показником вини механіка"), "blocker semantics must explicitly avoid blame attribution"],
  [panel.includes("Відсутні мітки не підміняються оцінкою"), "UI must disclose timing data coverage"],
  [panel.includes('navigateCrm("Наряди та ремонт", { workOrderId:'), "drill-down must open exact Work Order"],
  [bridge.includes('"СТО / Виробництво"'), "personnel panel must be attached to Workshop analytics"],
  [workspace.includes("<AnalyticsPersonnelBridge/>"), "analytics workspace must mount personnel bridge"],
];

for (const [ok, message] of checks) {
  if (!ok) throw new Error(`[personnel-analytics] ${message}`);
}

if (/SalaryAccrual|EmployeeCostEntry|baseSalary|minimumSalary/.test(route + panel)) {
  throw new Error("[personnel-analytics] operational personnel API/UI must not expose payroll data");
}

console.log("[personnel-analytics] contracts OK");
