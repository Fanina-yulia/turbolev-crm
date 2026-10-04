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

const localScrollFiles = [
  "app/my-tasks.module.css",
  "app/communications-contact-inbox.module.css",
  "app/directory-pages.module.css",
  "app/planner-v2.module.css",
  "app/diagnostics.module.css",
  "app/work-journal.module.css",
  "app/work-orders.module.css",
  "app/warranty-center.module.css",
  "app/procurement-queue.module.css",
  "app/payments-queue.module.css",
  "app/personnel-v2.module.css",
  "app/diagnostic-templates-settings-panel.module.css",
  "app/price-catalog-settings-panel.module.css",
  "app/appearance-settings-panel.module.css",
  "app/camera-settings.module.css",
  "app/workflow-settings-panel.module.css",
  "app/security-settings-panel-v2.module.css",
  "app/parts-procurement-workspace.module.css",
  "app/parts-supplier-reconciliation.module.css",
];

for (const value of sections) {
  if (!registry.includes(`"${value}"`)) failures.push(`Missing section contract: ${value}`);
}
for (const value of settings) {
  if (!registry.includes(`${value}:`)) failures.push(`Missing settings contract: ${value}`);
}

for (const marker of [
  "data-crm-screen-frame",
  "data-crm-screen",
  "data-screen-contract",
  "data-crm-scroll-region",
  "data-crm-scroll-mode",
  "data-crm-scroll-owner",
]) {
  if (!frame.includes(marker)) failures.push(`Frame missing marker: ${marker}`);
}

if (!frame.includes('LOCAL_SCROLL_SCREENS')) failures.push("Screen frame does not declare page-owned scroll surfaces");
if (!shell.includes("CrmScreenContractFrame")) failures.push("CrmShell does not use CrmScreenContractFrame");
if (!layout.includes("./crm-one-screen-standard.css")) failures.push("layout.tsx does not load CRM-UI-004 stylesheet");
if (!docs.includes("CRM-UI-004")) failures.push("CRM-UI-004 documentation is missing");

const rule = moduleRegistry.globalRules?.find((item) => item.id === "CRM-UI-004");
if (!rule || rule.status !== "ACTIVE") failures.push("module-registry.json does not contain active CRM-UI-004");

if (/\bmechanic-[a-z0-9_-]*/i.test(css) || /\[class\*=["'][^"']*mechanic/i.test(css)) {
  failures.push("CRM-UI-004 stylesheet must not target standalone mechanic cabinet");
}

for (const marker of [
  'body:has([data-crm-screen-frame="true"])',
  '[data-screen-contract="one-scroll"][data-crm-scroll-owner="frame"]',
  '[data-screen-contract="one-scroll"][data-crm-scroll-owner="page"]',
  '[data-screen-contract="two-max"]',
  "@media (max-width: 760px)",
]) {
  if (!css.includes(marker)) failures.push(`CRM-UI-004 stylesheet missing: ${marker}`);
}

/* Global CSS is allowed to own the shell only. Module-class guessing was the
   source of the first visual regressions (compressed cards / hidden actions). */
if (css.includes('[class*="_')) {
  failures.push("CRM-UI-004 global stylesheet must not guess CSS-module class names");
}

for (const file of localScrollFiles) {
  const source = read(file);
  if (!source.includes("CRM-UI-004 POLISH V2")) {
    failures.push(`${file} does not declare its page-owned CRM-UI-004 layout`);
  }
}

const newRequestCss = read("app/new-request-page.css");
if (!newRequestCss.includes("CRM-UI-004 POLISH V2") || !newRequestCss.includes("overflow-y:auto!important")) {
  failures.push("New Request does not own a bounded scrollable step body");
}

if (failures.length) {
  console.error("[one-screen-contracts] FAIL");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log("[one-screen-contracts] OK — shell ownership, page-owned work areas and mechanic exclusion verified.");
