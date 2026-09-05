import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];

for (const file of [
  "app/appearance-settings-panel.tsx",
  "app/document-template-builder.tsx",
  "app/document-template-builder.module.css",
  "app/api/settings/document-templates/route.ts",
  "src/services/document-template.service.ts",
  "docs/TZ_DOCUMENT_TEMPLATE_BUILDER.md",
]) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Missing ${file}`);
}

const appearance = read("app/appearance-settings-panel.tsx");
const builder = read("app/document-template-builder.tsx");
const route = read("app/api/settings/document-templates/route.ts");
const service = read("src/services/document-template.service.ts");

for (const marker of ["<DocumentTemplateBuilder />", "data-document-template-builder", "Діагностична карта", "Комерційна пропозиція", "PUT", "/api/settings/document-templates"]) {
  if (!(appearance + builder + route).includes(marker)) failures.push(`Missing contract marker: ${marker}`);
}
for (const marker of ["CrmSetting", "document_templates", "INVALID_DOCUMENT_IMAGE", "SETTINGS_WRITE"]) {
  if (!(service + route).includes(marker)) failures.push(`Missing persistence/security marker: ${marker}`);
}

if (failures.length) {
  console.error("[document-template-builder] FAIL");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log("[document-template-builder] OK — document templates, API and settings integration are present.");
