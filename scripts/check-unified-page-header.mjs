import fs from "node:fs";
import path from "node:path";

const ROOT=process.cwd();
const read=(file)=>fs.readFileSync(path.join(ROOT,file),"utf8");
const failures=[];

const component=read("app/crm-page-header.tsx");
const css=read("app/crm-page-header.module.css");
const docs=read("docs/TZ_CRM_UNIFIED_PAGE_HEADER.md");
const registry=JSON.parse(read("docs/modules/module-registry.json"));

for(const marker of ["data-crm-page-header","data-crm-page-eyebrow","data-crm-page-title","data-crm-page-actions","data-crm-page-tabs","data-crm-page-controls"]){
  if(!component.includes(marker)) failures.push(`Canonical header missing marker: ${marker}`);
}
for(const marker of ["font-size:28px","font-size:11px","letter-spacing:.11em","border-bottom:1px solid var(--line)"]){
  if(!css.includes(marker)) failures.push(`Canonical header CSS missing: ${marker}`);
}
if(!docs.includes("CRM-UI-006")) failures.push("CRM-UI-006 specification missing");
const rule=registry.globalRules?.find((item)=>item.id==="CRM-UI-006");
if(!rule||rule.status!=="ACTIVE") failures.push("module-registry missing active CRM-UI-006");

const required=[
  "app/analytics-dashboard.tsx",
  "app/financial-center-legacy.tsx",
  "app/communications-hub-server.tsx",
  "app/clients-directory.tsx",
  "app/vehicles-directory.tsx",
  "app/planner-v2.tsx",
  "app/diagnostics.tsx",
  "app/work-journal.tsx",
  "app/work-orders.tsx",
  "app/warranty-center.tsx",
  "app/payments-queue.tsx",
  "app/my-tasks.tsx",
  "app/procurement-queue.tsx",
  "app/parts-supplier-reconciliation.tsx",
  "app/settings-operations-page.tsx",
  "app/personnel-v2.tsx",
  "app/diagnostic-templates-settings-panel.tsx",
  "app/workflow-settings-panel.tsx",
  "app/security-settings-panel-v2.tsx",
  "app/appearance-settings-panel.tsx",
  "app/camera-settings-panel.tsx",
  "app/integrations-settings-hub.tsx",
  "app/parts-catalog-settings-panel.tsx",
  "app/price-catalog-settings-panel.tsx",
  "app/parts-catalog.tsx",
  "app/owner-dashboard.tsx",
  "app/role-cabinet.tsx",
  "app/station-overview.tsx",
  "app/service-advisor-cabinet-home.tsx",
  "app/parts-role-cabinet-home.tsx",
  "app/leads-sales-role-cabinet-home.tsx",
  "app/vehicle-record-workspace.tsx"
];

for(const file of required){
  const source=read(file);
  if(!source.includes("CrmPageHeader")) failures.push(`${file} does not use CrmPageHeader`);
}

for(const file of ["app/mechanic-standalone-cabinet.tsx","app/mechanic-standalone-cabinet.module.css"]){
  if(fs.existsSync(path.join(ROOT,file))&&read(file).includes("CrmPageHeader")) failures.push(`Mechanic scope violation: ${file}`);
}

if(failures.length){
  console.error("[unified-page-header] FAIL");
  failures.forEach((failure)=>console.error(` - ${failure}`));
  process.exit(1);
}
console.log("[unified-page-header] OK — canonical header component is active across internal CRM and mechanic scope remains excluded.");
