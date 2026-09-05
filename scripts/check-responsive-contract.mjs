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

const responsiveContracts = [
  {
    file: "app/vehicle-record-workspace.module.css",
    markers: ["overflow-x: visible", "min-height: 0", "flex-wrap: wrap", "@media (max-width: 900px)"]
  },
  {
    file: "app/diagnostics.module.css",
    markers: ["max-height: none", "overflow: visible", "position: static"]
  },
  {
    file: "app/communications.css",
    markers: [".commsLayout{height:auto", ".threadMessages{flex:none;overflow:visible}", "@media(max-width:900px)"]
  },
  {
    file: "app/new-inquiries.module.css",
    markers: [".queuePane{height:auto", ".queueList{overflow:visible}", ".detailPane{position:static}"]
  },
  {
    file: "app/work-orders.module.css",
    markers: [".list,.detail{max-height:none;overflow:visible}", ".detail{position:static}"]
  },
  {
    file: "app/personnel-v2.module.css",
    markers: [".list,.editor{overflow:visible}", ".list{max-height:none}"]
  }
];

const contractViewportMarkers = ["1920", "1440", "1366", "1280", "1024", "768", "390", "360"];

for (const marker of ["./crm-responsive-standard.css"]) {
  if (!layout.includes(marker)) failures.push(`layout.tsx does not load ${marker}`);
}

for (const marker of ["--crm-layout-gutter", "minmax(0, 1fr)", "min-width: 0", "prefers-reduced-motion", "vehicle-record-workspace_vehiclePhoto", "overflow-x: auto"]) {
  if (!responsiveCss.includes(marker)) failures.push(`Responsive CSS is missing contract marker: ${marker}`);
}

for (const marker of ["new-inquiries_workspace__", "parts-catalog-diagram_workspace__", "new-inquiries_queuePane__"]) {
  if (!responsiveCss.includes(marker)) failures.push(`Responsive CSS is missing targeted safety marker: ${marker}`);
}

for (const marker of ["CRM-UI-003", "1920", "1366", "390", "Підбір запчастин", "Сервісна історія", "Результат аудиту 2026-09-05"]) {
  if (!standards.includes(marker)) failures.push(`Responsive standard is missing: ${marker}`);
}

for (const viewport of contractViewportMarkers) {
  if (!standards.includes(viewport)) failures.push(`Responsive standard is missing viewport: ${viewport}`);
}

for (const contract of responsiveContracts) {
  const css = read(contract.file);
  for (const marker of contract.markers) {
    if (!css.includes(marker)) failures.push(`${contract.file} is missing responsive contract marker: ${marker}`);
  }
}

if (!fs.existsSync(path.join(ROOT, "docs/TZ_CRM_RESPONSIVE_AUDIT_20260905.md"))) {
  failures.push("Detailed responsive audit specification is missing");
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

console.log(`[responsive-contract] OK — CRM-UI-003 is loaded, documented and registered; ${responsiveContracts.length} page contracts checked.`);
