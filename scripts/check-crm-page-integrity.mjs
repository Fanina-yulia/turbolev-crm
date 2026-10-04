import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const failures = [];
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const standards = read("docs/CRM_STANDARDS_TABLE.md");
const oneScreen = read("docs/CRM_ONE_SCREEN_FIRST.md");
const registry = JSON.parse(read("docs/modules/module-registry.json"));
const layout = read("app/layout.tsx");
const shell = read("app/crm-shell.tsx");
const css = read("app/crm-one-screen-standard.css");

for (const code of ["CRM-AUDIT-001", "CRM-UI-003", "CRM-UI-004"]) {
  if (!standards.includes(code)) failures.push(`Standards table is missing ${code}`);
}

const globalRules = Array.isArray(registry.globalRules) ? registry.globalRules : [];
if (!globalRules.some((rule) => rule.id === "CRM-UI-004" && rule.status === "ACTIVE")) {
  failures.push("Module registry is missing active global rule CRM-UI-004");
}
if (!globalRules.some((rule) => rule.id === "CRM-UI-001" && rule.status === "SUPERSEDED")) {
  failures.push("CRM-UI-001 must be marked SUPERSEDED");
}

if (!oneScreen.includes("Кабінету механіка")) failures.push("Mechanic exclusion is not documented");
if (!layout.includes("./crm-one-screen-standard.css")) failures.push("CRM-UI-004 stylesheet is not loaded");
if (!shell.includes("CrmScreenContractFrame")) failures.push("CRM shell is missing screen contract frame");
if (!css.includes('[data-crm-screen-frame="true"]')) failures.push("CRM-UI-004 CSS is not shell-scoped");
if (/mechanic-/i.test(css) || /MechanicCabinet/.test(css)) failures.push("CRM-UI-004 CSS targets mechanic scope");

if (failures.length) {
  console.error("[crm-page-integrity] FAIL");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("[crm-page-integrity] OK — CRM-UI-004 is canonical; standalone mechanic cabinet is excluded.");
