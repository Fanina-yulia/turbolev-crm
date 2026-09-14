import fs from "node:fs";

const bridge = fs.readFileSync("app/auth/sidebar-settings-submenu-bridge.tsx", "utf8");
const page = fs.readFileSync("app/page.tsx", "utf8");
const settingsPage = fs.readFileSync("app/settings-page.tsx", "utf8");
const settingsTabs = fs.readFileSync("app/settings-tabs.ts", "utf8");

const requiredTabs = [
  "schedule",
  "personnel",
  "suppliers",
  "warehouse",
  "workPrices",
  "posts",
  "markup",
  "cash",
  "integrations",
  "cameras",
  "diagnosticTemplates",
  "appearance",
  "workflow",
  "security",
  "partsCatalog",
];

for (const id of requiredTabs) {
  if (!settingsTabs.includes(`"${id}"`)) throw new Error(`[settings-submenu] settings-tabs.ts is missing ${id}`);
  if (!bridge.includes(`id: "${id}"`)) throw new Error(`[settings-submenu] V7 flyout is missing ${id}`);
}

const requiredBridgeFragments = [
  'navigateCrm("Налаштування", { settingsTab: id })',
  'crmDockFlyout7[aria-label="Налаштування"]',
  'crmWideGroup7',
  'crmDockSubActive7',
  'crmWideItemActive7',
  'PERMISSIONS.PERSONNEL_READ',
  'PERMISSIONS.FINANCE_READ',
  'PERMISSIONS.SETTINGS_INTEGRATIONS',
  'PERMISSIONS.SECURITY_ACCESS_MANAGE',
  'PERMISSIONS.SETTINGS_READ',
  'max-height:min(72vh,560px)',
];

for (const fragment of requiredBridgeFragments) {
  if (!bridge.includes(fragment)) throw new Error(`[settings-submenu] missing V7 flyout contract fragment: ${fragment}`);
}

if (!page.includes('import { SidebarSettingsSubmenuBridge } from "./auth/sidebar-settings-submenu-bridge";')) {
  throw new Error("[settings-submenu] flyout bridge import is not mounted from app/page.tsx");
}
if (!page.includes("<SidebarSettingsSubmenuBridge/>")) {
  throw new Error("[settings-submenu] flyout bridge component is not mounted from app/page.tsx");
}

for (const forbidden of [
  'SettingsVisibleSubmenu',
  'settings-workspace-shell.module.css',
  'data-settings-workspace',
  'data-settings-visible-submenu',
]) {
  if (settingsPage.includes(forbidden)) {
    throw new Error(`[settings-submenu] settings page must not render a persistent sidebar: ${forbidden}`);
  }
}

console.log("[settings-submenu] finance-style V7 flyout contracts OK; no persistent settings sidebar");
