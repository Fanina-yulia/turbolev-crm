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

function assertNotIncludes(relative, snippets) {
  const source = read(relative);
  for (const snippet of snippets) {
    if (source.includes(snippet)) throw new Error(`${relative}: stale navigation contract fragment remains: ${snippet}`);
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
  "function canonicalNavigation",
  'section === "Виробництво"',
  'scope = "resources"',
  'section: "Планувальник"',
  'section === "Контроль якості"',
  'workOrderTab = context.workOrderTab || "qc"',
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
  'navigateCrm("Комерційна пропозиція", { workOrderId:',
]);

assertIncludes("app/payments-queue.tsx", [
  "readCrmRoute",
  "route.workOrderId",
  "route.locationId",
  'params.set("workOrderId", routeWorkOrderId)',
  'navigateCrm("Оплати", { scope: next',
  "transitionWarning?: { code?: string; message?: string } | null;",
  "setNotice(payload.transitionWarning?.message ||",
  "Комерційну пропозицію переведено у «Готовий до видачі».",
]);

assertIncludes("app/api/payments/route.ts", [
  'request.nextUrl.searchParams.get("workOrderId")',
  "requestedWorkOrderId ? [requestedWorkOrderId] : null",
]);

assertIncludes("app/qc-queue.tsx", [
  'navigateCrm("Комерційна пропозиція", { workOrderId: card.id, workOrderTab: "works" })',
  "Відкрити доопрацювання →",
]);
assertNotIncludes("app/qc-queue.tsx", [
  'navigateCrm("Виробництво", { status: "REWORK" })',
]);

assertIncludes("app/api/work-orders/[id]/qc/route.ts", [
  "transitionWorkOrder",
  'action === "PASS" ? "READY_FOR_PICKUP" : "REWORK"',
  "workOrderTransitionWarning",
  "transitionWarning: workOrderTransitionWarning",
]);

assertIncludes("app/work-order-commercial-panel.tsx", [
  'import { navigateCrm } from "./crm-route";',
  "return payload;",
  "result.transitionWarning?.message",
  "Контроль якості пройдено. Комерційну пропозицію переведено у «Готовий до видачі».",
  "QC не пройдено. Комерційну пропозицію переведено у «Доопрацювання».",
  'navigateCrm("Фінансовий центр")',
]);

assertIncludes("app/work-orders.tsx", [
  'if (item.to === "CLOSED") return "Видати авто та закрити КП";',
  'transition.to === "CLOSED" && !window.confirm("Підтвердити видачу авто клієнту та закриття комерційної пропозиції?")',
  "Авто видано клієнту. Комерційну пропозицію закрито.",
]);

assertIncludes("app/production-board.tsx", [
  '["BLOCKED", "Блокери / пауза"]',
  'const BLOCKED_STATUSES = new Set(["WAITING_PARTS", "PAUSED", "REWORK"]);',
  'if (filter === "BLOCKED") return BLOCKED_STATUSES.has(card.status);',
  'onClick={() => setFilter("BLOCKED")}',
  'data.cards.filter((card) => matchesProductionFilter(card, code)).length',
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
  "resolveDiagnosticVehicleRoute",
  'fetch("/api/diagnostics?limit=500"',
  "current.vehicleId !== vehicleId",
  "diagnosticVehicleApplied",
  'section === "Планувальник" && filter === "today"',
  'status: "WAITING_APPROVAL", workOrderTab: "estimate"',
  'section === "Підбір запчастин" && filter === "waiting-parts"',
  'section: "Закупівлі та склад"',
]);

assertIncludes("app/client-card-drawer-core.tsx", [
  'setMessage("Звернення вже передано в роботу.")',
  'existingLeadId?"✓ В роботі":"+ Передати в роботу"',
]);

assertIncludes("app/active-terminology-bridge.tsx", [
  '["Для додавання в Активні потрібне серверне з\'єднання", "Для передачі звернення в роботу потрібне серверне з\'єднання"]',
  '["Контакт уже є в Активних", "Контакт уже передано в роботу"]',
  '["Контакт додано в Активні", "Контакт передано в роботу"]',
]);

assertIncludes("app/diagnostics.tsx", [
  'RETURNED: { label: "В роботі"',
  'if (filter === "IN_PROGRESS") return workflowState(row) === "IN_PROGRESS" || workflowState(row) === "RETURNED";',
  "Основний процес: Очікує → В роботі → На перевірці → Підтверджена.",
]);
assertNotIncludes("app/diagnostics.tsx", [
  '{ value: "RETURNED", label: "На уточненні" }',
]);
assertIncludes("app/vehicle-diagnostics-tab.tsx", [
  'RETURNED: "В роботі"',
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
