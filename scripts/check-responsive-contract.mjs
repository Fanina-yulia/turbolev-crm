import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const failures = [];
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const layout = read("app/layout.tsx");
const responsiveCss = read("app/crm-responsive-standard.css");
const standards = read("docs/CRM_RESPONSIVE_STANDARDS.md");
const table = read("docs/CRM_STANDARDS_TABLE.md");
const registry = JSON.parse(read("docs/modules/module-registry.json"));

for (const marker of ["./crm-responsive-standard.css"]) {
  if (!layout.includes(marker)) failures.push(`layout.tsx does not load ${marker}`);
}

for (const marker of ["--crm-layout-gutter", "minmax(0, 1fr)", "prefers-reduced-motion", "vehicle-record-workspace_vehiclePhoto", "overflow-x: auto"]) {
  if (!responsiveCss.includes(marker)) failures.push(`Responsive CSS is missing contract marker: ${marker}`);
}

for (const marker of ["CRM-UI-003", "1920", "1366", "390", "Підбір запчастин", "Сервісна історія"]) {
  if (!standards.includes(marker)) failures.push(`Responsive standard is missing: ${marker}`);
}

if (!table.includes("CRM-UI-003")) failures.push("Canonical standards table is missing CRM-UI-003");
if (!Array.isArray(registry.globalRules) || !registry.globalRules.some((rule) => rule.id === "CRM-UI-003" && rule.status === "ACTIVE")) {
  failures.push("Module registry is missing active CRM-UI-003");
}

if (failures.length) {
  console.error("[responsive-contract] FAIL");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("[responsive-contract] OK — CRM-UI-003 is loaded, documented and registered.");
