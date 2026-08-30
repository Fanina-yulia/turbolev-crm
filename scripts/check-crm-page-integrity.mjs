import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const standardsPath = path.join(ROOT, "docs", "CRM_STANDARDS_TABLE.md");
const registryPath = path.join(ROOT, "docs", "modules", "module-registry.json");

const protectedPages = [
  ["app/diagnostics.module.css", [".list", ".detail", "max-height:none", "overflow:visible"]],
  ["app/work-orders.module.css", [".list", ".detail", ".detailSticky", "max-height:none", "overflow:visible"]],
  ["app/new-inquiries.module.css", [".queuePane", ".queueList", ".detailPane", "overflow:visible"]],
  ["app/parts-supplier-reconciliation.module.css", [".workspace", ".queue", ".detail", "overflow:visible"]],
  ["app/communications-contact-inbox.module.css", [".shell", ".list", ".timeline", "overflow:visible"]],
  ["app/workflow-settings-panel.module.css", [".entities", "overflow:visible"]],
  ["app/diagnostic-templates-settings-panel.module.css", [".list", "position:static"]],
  ["app/personnel-v2.module.css", [".list", ".editor", "overflow:visible"]],
  ["app/security-settings-panel.module.css", [".listPanel", "max-height:none", "overflow:visible"]],
  ["app/security-settings-panel-v2.module.css", [".list", ".editor", "max-height:none", "overflow:visible"]],
];

const failures = [];

if (!fs.existsSync(standardsPath)) {
  failures.push("Missing canonical standards table: docs/CRM_STANDARDS_TABLE.md");
} else {
  const standards = fs.readFileSync(standardsPath, "utf8");
  for (const code of ["CRM-AUDIT-001", "CRM-UI-001", "CRM-UI-002"]) {
    if (!standards.includes(code)) failures.push(`Standards table is missing ${code}`);
  }
}

if (!fs.existsSync(registryPath)) {
  failures.push("Missing module registry: docs/modules/module-registry.json");
} else {
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const rules = Array.isArray(registry.globalRules) ? registry.globalRules : [];
  for (const code of ["CRM-AUDIT-001", "CRM-UI-001"]) {
    if (!rules.some((rule) => rule.id === code && rule.status === "ACTIVE")) {
      failures.push(`Module registry is missing active global rule ${code}`);
    }
  }
}

for (const [relativeFile, markers] of protectedPages) {
  const file = path.join(ROOT, relativeFile);
  if (!fs.existsSync(file)) {
    failures.push(`Protected page stylesheet is missing: ${relativeFile}`);
    continue;
  }
  const source = fs.readFileSync(file, "utf8");
  const compactSource = source.replace(/\s+/g, "");
  for (const marker of markers) {
    if (!compactSource.includes(marker.replace(/\s+/g, ""))) {
      failures.push(`${relativeFile}: missing continuous-page contract marker ${marker}`);
    }
  }
}

if (failures.length) {
  console.error("[crm-page-integrity] FAIL");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(`[crm-page-integrity] OK — ${protectedPages.length} protected CRM page surfaces follow CRM-UI-001.`);
