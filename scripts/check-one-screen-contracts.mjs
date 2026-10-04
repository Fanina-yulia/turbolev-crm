import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const failures = [];

const registry = read("app/crm-screen-contracts.ts");
const frame = read("app/crm-screen-contract-frame.tsx");
const shell = read("app/crm-shell.tsx");
const css = read("app/crm-one-screen-standard.css");
const layout = read("app/layout.tsx");
const docs = read("docs/CRM_ONE_SCREEN_FIRST.md");
const moduleRegistry = JSON.parse(read("docs/modules/module-registry.json"));

const sections = [
  "Огляд станції", "Мої задачі", "Комунікації", "Клієнти", "Авто",
  "Планувальник", "Діагностика", "Роботи", "Комерційна пропозиція",
  "Гарантії", "Підбір запчастин", "Закупівлі та склад", "Фінансовий центр",
  "Оплати", "Аналітика", "Налаштування",
];

const settings = [
  "schedule", "personnel", "suppliers", "warehouse", "workPrices", "posts",
  "markup", "cash", "integrations", "cameras", "diagnosticTemplates",
  "appearance", "workflow", "security", "partsCatalog",
];

for (const value of sections) {
  if (!registry.includes(`"${value}"`)) failures.push(`Missing section contract: ${value}`);
}
for (const value of settings) {
  if (!registry.includes(`${value}:`)) failures.push(`Missing settings contract: ${value}`);
}

for (const marker of ["data-crm-screen-frame", "data-crm-screen", "data-screen-contract", "data-crm-scroll-region", "data-crm-scroll-mode"]) {
  if (!frame.includes(marker)) failures.push(`Frame missing marker: ${marker}`);
}
if (!shell.includes("CrmScreenContractFrame")) failures.push("CrmShell does not use CrmScreenContractFrame");
if (!layout.includes("./crm-one-screen-standard.css")) failures.push("layout.tsx does not load CRM-UI-004 stylesheet");
if (!docs.includes("CRM-UI-004")) failures.push("CRM-UI-004 documentation is missing");

const rule = moduleRegistry.globalRules?.find((item) => item.id === "CRM-UI-004");
if (!rule || rule.status !== "ACTIVE") failures.push("module-registry.json does not contain active CRM-UI-004");

if (/mechanic-/i.test(css) || /MechanicCabinet/.test(css)) {
  failures.push("CRM-UI-004 stylesheet must not target standalone mechanic cabinet");
}

for (const marker of [
  'body:has([data-crm-screen-frame="true"])',
  '[data-screen-contract="one-scroll"]',
  '[data-screen-contract="two-max"]',
  '[data-crm-screen="communications"]',
  '[data-crm-screen="planner"]',
  "@media (max-width: 760px)",
]) {
  if (!css.includes(marker)) failures.push(`CRM-UI-004 stylesheet missing: ${marker}`);
}

if (failures.length) {
  console.error("[one-screen-contracts] FAIL");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log("[one-screen-contracts] OK — CRM-UI-004 registry, shell scope and mechanic exclusion verified.");
