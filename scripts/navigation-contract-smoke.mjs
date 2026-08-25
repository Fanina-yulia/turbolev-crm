import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function assertIncludes(relative, snippets) {
  const source = read(relative);
  for (const snippet of snippets) {
    if (!source.includes(snippet)) throw new Error(`${relative}: missing navigation contract fragment: ${snippet}`);
  }
}

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) result.push(full);
  }
  return result;
}

assertIncludes("app/crm-route.ts", [
  "inquiryId?: string",
  "appointmentId?: string",
  "diagnosticId?: string",
  "workOrderId?: string",
  "partsRequestId?: string",
  "analyticsTab?: string",
  "metric?: string",
  "settingsTab?: string",
]);

assertIncludes("app/planner-workspace.tsx", [
  'scope === "resources"',
  "<ProductionBoard/>",
  "Пости та механіки",
]);

assertIncludes("app/procurement-workspace.tsx", [
  "route.partsRequestId",
  "/api/procurement",
  "data-procurement-route-focus",
]);

assertIncludes("app/analytics-workspace.tsx", [
  "route.analyticsTab",
  "route.metric",
  "route.locationId",
  "data-analytics-route-focus",
]);

assertIncludes("app/crm-shell.tsx", [
  "<PlannerWorkspace/>",
  "<ProcurementWorkspace/>",
  "<AnalyticsWorkspace/>",
]);

const appFiles = walk(path.join(ROOT, "app"));
const invalid = [];
for (const file of appFiles) {
  const source = fs.readFileSync(file, "utf8");
  if (source.includes('section: "Клієнти та авто"') || source.includes("section:'Клієнти та авто'")) {
    invalid.push(path.relative(ROOT, file));
  }
}
if (invalid.length) throw new Error(`Invalid grouped navigation destination «Клієнти та авто» remains in: ${invalid.join(", ")}`);

console.log("Navigation contract smoke: OK");
