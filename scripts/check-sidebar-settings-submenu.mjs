import fs from "node:fs";

const bridge = fs.readFileSync("app/auth/sidebar-settings-submenu-bridge.tsx", "utf8");
const page = fs.readFileSync("app/page.tsx", "utf8");
const settingsPage = fs.readFileSync("app/settings-page.tsx", "utf8");
const visibleSubmenu = fs.readFileSync("app/settings-visible-submenu.tsx", "utf8");
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
  if (!bridge.includes(`id: "${id}"`)) throw new Error(`[settings-submenu] V7 bridge is missing ${id}`);
  if (!visibleSubmenu.includes(`id: "${id}"`)) throw new Error(`[settings-submenu] persistent settings menu is missing ${id}`);
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
];

for (const fragment of requiredBridgeFragments) {
  if (!bridge.includes(fragment)) throw new Error(`[settings-submenu] missing V7 bridge contract fragment: ${fragment}`);
}

for (const fragment of [
  'data-settings-visible-submenu',
  'navigateCrm("Налаштування", { settingsTab: item.id })',
  'PERMISSIONS.PERSONNEL_READ',
  'PERMISSIONS.FINANCE_READ',
  'PERMISSIONS.SETTINGS_INTEGRATIONS',
  'PERMISSIONS.SECURITY_ACCESS_MANAGE',
  'PERMISSIONS.SETTINGS_READ',
]) {
  if (!visibleSubmenu.includes(fragment)) throw new Error(`[settings-submenu] missing persistent menu contract fragment: ${fragment}`);
}

if (!page.includes('import { SidebarSettingsSubmenuBridge } from "./auth/sidebar-settings-submenu-bridge";')) {
  throw new Error("[settings-submenu] bridge import is not mounted from app/page.tsx");
}
if (!page.includes("<SidebarSettingsSubmenuBridge/>")) {
  throw new Error("[settings-submenu] bridge component is not mounted from app/page.tsx");
}
if (!settingsPage.includes('import { SettingsVisibleSubmenu } from "./settings-visible-submenu";')) {
  throw new Error("[settings-submenu] persistent submenu is not imported by settings-page.tsx");
}
if (!settingsPage.includes("<SettingsVisibleSubmenu tab={tab}/>")) {
  throw new Error("[settings-submenu] persistent submenu is not rendered by settings-page.tsx");
}
if (!settingsPage.includes("data-settings-workspace")) {
  throw new Error("[settings-submenu] settings workspace shell is missing");
}

console.log("[settings-submenu] V7 flyout + persistent settings submenu contracts OK");
