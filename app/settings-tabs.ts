export const SETTINGS_TABS = [
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
  "appearance",
  "workflow",
  "security",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function isSettingsTab(value: string | null | undefined): value is SettingsTab {
  return Boolean(value && (SETTINGS_TABS as readonly string[]).includes(value));
}
