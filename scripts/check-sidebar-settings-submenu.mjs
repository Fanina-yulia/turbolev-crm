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
  if (!bridge.includes(`id: "${id}"`)) throw new Error(`[settings-submenu] V7 Settings flyout is missing ${id}`);
}

const requiredBridgeFragments = [
  'navigateCrm("Налаштування", { settingsTab: id })',
  '.crmDockButton7[aria-label="Налаштування"]',
  'crmSettingsFixedFlyout7',
  'position:fixed',
  'z-index:2920',
  'max-height:min(72vh,560px)',
  'onPointerEnter={clearClose}',
  'onPointerLeave={scheduleClose}',
  'crmDockSubActive7',
  'crmWideGroup7',
  'crmWideItemActive7',
  'PERMISSIONS.PERSONNEL_READ',
  'PERMISSIONS.FINANCE_READ',
  'PERMISSIONS.SETTINGS_INTEGRATIONS',
  'PERMISSIONS.SECURITY_ACCESS_MANAGE',
  'PERMISSIONS.SETTINGS_READ',
  '.crmDockFlyout7[aria-label="Налаштування"]{display:none!important}',
];

for (const fragment of requiredBridgeFragments) {
  if (!bridge.includes(fragment)) throw new Error(`[settings-submenu] missing stable flyout contract fragment: ${fragment}`);
}

if (bridge.includes('compactSettingsHost()')) {
  throw new Error("[settings-submenu] compact Settings menu must not depend on DOM portal host injection");
}
if (bridge.includes('data-settings-submenu-compact-host')) {
  throw new Error("[settings-submenu] compact Settings menu must not depend on a compact portal host");
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

console.log("[settings-submenu] stable Finance-style Settings flyout contracts OK; compact flyout does not depend on DOM portal injection");
