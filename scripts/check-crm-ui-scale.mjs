import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const failures = [];

const css = read("app/crm-global-ui-scale.css");
const layout = read("app/layout.tsx");
const page = read("app/page.tsx");
const docs = read("docs/TZ_CRM_GLOBAL_UI_SCALE_90.md");
const registry = JSON.parse(read("docs/modules/module-registry.json"));

for (const marker of [
  "--crm-ui-scale: .9",
  "--crm-ui-inverse-scale: 1.1111111111",
  "--crm-ui-logical-width: 111.111111vw",
  "--crm-ui-logical-height: 111.111111dvh",
  "body:has(.shell)",
  "zoom:var(--crm-ui-scale)",
  "@media (max-width:760px)",
  "zoom:1",
]) {
  if (!css.includes(marker)) failures.push(`Scale CSS missing: ${marker}`);
}

if (css.includes("transform:scale(.9)") || css.includes("transform: scale(.9)")) {
  failures.push("Root CRM scaling must use CSS zoom, not transform: scale(.9)");
}

if (css.includes("--crm-ui-origin-compensation-x") || css.includes("left:var(--crm-ui-origin-compensation-x)")) {
  failures.push("Horizontal origin compensation is prohibited: it shifts the CRM canvas left and creates a right-side gap.");
}

if (!layout.includes('import "./crm-global-ui-scale.css";')) {
  failures.push("Root layout does not load crm-global-ui-scale.css");
}

const mechanicIndex = page.indexOf('primaryRole?.code === "MECHANIC"');
const shellIndex = page.indexOf("<CrmShell");
if (mechanicIndex < 0 || shellIndex < 0 || mechanicIndex > shellIndex) {
  failures.push("Mechanic scope guard is not before CrmShell");
}

if (!docs.includes("CRM-UI-005") || !docs.includes("Browser 100%")) {
  failures.push("CRM-UI-005 technical specification is incomplete");
}

const rule = registry.globalRules?.find((item) => item.id === "CRM-UI-005");
if (!rule || rule.status !== "ACTIVE") {
  failures.push("module-registry.json does not contain active CRM-UI-005");
}

if (failures.length) {
  console.error("[crm-ui-scale] FAIL");
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}

console.log("[crm-ui-scale] OK — internal CRM uses 0.90 design scale with logical viewport compensation and no horizontal offset; mechanic/public scope excluded.");
