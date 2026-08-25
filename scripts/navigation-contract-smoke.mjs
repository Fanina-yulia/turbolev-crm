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
  "supplierId?: string",
  "provider?: string",
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

assertIncludes("app/financial-center.tsx", [
  "readCrmRoute",
  "route.metric",
  "route.from",
  "route.to",
  "route.locationId",
  'navigateCrm("Замовлення-наряди", { workOrderId:',
]);

assertIncludes("app/payments-queue.tsx", [
  "readCrmRoute",
  "route.workOrderId",
  "route.locationId",
  'params.set("workOrderId", routeWorkOrderId)',
  'navigateCrm("Оплати", { scope: next',
]);

assertIncludes("app/api/payments/route.ts", [
  'request.nextUrl.searchParams.get("workOrderId")',
  "requestedWorkOrderId ? [requestedWorkOrderId] : null",
]);

assertIncludes("app/global-smart-search.tsx", [
  'type: "diagnostic"',
  'type: "appointment"',
  'navigateCrm("Діагностика", { diagnosticId:',
  'navigateCrm("Планувальник", { appointmentId:',
]);

assertIncludes("app/api/search/route.ts", [
  "canDiagnostics",
  "canPlanner",
  "prisma.diagnosticRequest.findMany",
  "prisma.serviceAppointment.findMany",
  "diagnostics:",
  "appointments:",
]);

assertIncludes("app/settings-route-focus-bridge.tsx", [
  "route.provider",
  "route.supplierId",
  'url.searchParams.set("integration", provider)',
]);

assertIncludes("app/crm-shell.tsx", [
  "<PlannerWorkspace/>",
  "<ProcurementWorkspace/>",
  "<AnalyticsWorkspace/>",
]);

assertIncludes("app/business-flow-route-bridge.tsx", [
  'detail?.section === "Клієнти та авто"',
  "resolveLegacyClientVehicle",
  'navigateCrm("Клієнти", { clientId: client.id })',
  'navigateCrm("Авто", { vehicleId: vehicle.id })',
]);

const appFiles = walk(path.join(ROOT, "app"));
const groupedLegacyAllowlist = new Set(["app/planner-edit-enhancer.tsx", "app/business-flow-route-bridge.tsx"]);
const invalid = [];
for (const file of appFiles) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(ROOT, file).replaceAll("\\", "/");
  const hasGroupedDestination = source.includes('section: "Клієнти та авто"') || source.includes("section:'Клієнти та авто'");
  if (hasGroupedDestination && !groupedLegacyAllowlist.has(relative)) invalid.push(relative);
}
if (invalid.length) throw new Error(`Unbridged grouped navigation destination «Клієнти та авто» remains in: ${invalid.join(", ")}`);

console.log("Navigation contract smoke: OK");
