export type AppearanceThemeMode = "light" | "dark" | "auto";
export type AppearancePresetId = "turbo-dark" | "turbo-light" | "graphite" | "high-contrast";
export type AppearanceFont = "inter" | "manrope" | "system";
export type AppearanceScale = "compact" | "standard" | "comfortable";
export type AppearanceDensity = "compact" | "standard" | "comfortable";
export type AppearanceRadius = "sharp" | "standard" | "soft";
export type AppearanceSidebar = "expanded" | "compact";

export type CrmAppearance = {
  preset: AppearancePresetId;
  themeMode: AppearanceThemeMode;
  accent: string;
  accentStrong: string;
  background: string;
  panel: string;
  panelRaised: string;
  text: string;
  muted: string;
  line: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  font: AppearanceFont;
  scale: AppearanceScale;
  density: AppearanceDensity;
  radius: AppearanceRadius;
  sidebar: AppearanceSidebar;
  logoDataUrl: string;
  logoName: string;
};

type PresetDefinition = Omit<CrmAppearance, "preset" | "logoDataUrl" | "logoName"> & {
  id: AppearancePresetId;
  label: string;
  description: string;
};

export const APPEARANCE_CACHE_KEY = "turbolev:appearance-cache:v1";

export const APPEARANCE_PRESETS: readonly PresetDefinition[] = [
  {
    id: "turbo-dark",
    label: "Turbo Dark",
    description: "Фірмовий темний інтерфейс із яскравим помаранчевим акцентом.",
    themeMode: "dark",
    accent: "#ff6600",
    accentStrong: "#ff8a2a",
    background: "#0b0d10",
    panel: "#12161b",
    panelRaised: "#171c22",
    text: "#f7f7f5",
    muted: "#8f98a3",
    line: "#252b33",
    success: "#2bb673",
    warning: "#f0b429",
    danger: "#ef6262",
    info: "#4f7cff",
    font: "system",
    scale: "standard",
    density: "standard",
    radius: "standard",
    sidebar: "expanded",
  },
  {
    id: "turbo-light",
    label: "Turbo Light",
    description: "Світлий варіант Turbo LEV для яскравих робочих просторів.",
    themeMode: "light",
    accent: "#f05a0b",
    accentStrong: "#ff6600",
    background: "#f4f5f7",
    panel: "#ffffff",
    panelRaised: "#f8f9fb",
    text: "#11151a",
    muted: "#68727d",
    line: "#dde1e6",
    success: "#1c9b5f",
    warning: "#b88100",
    danger: "#c43f3f",
    info: "#356de8",
    font: "system",
    scale: "standard",
    density: "standard",
    radius: "standard",
    sidebar: "expanded",
  },
  {
    id: "graphite",
    label: "Graphite",
    description: "Глибший графіт, мінімум візуального шуму та компактні робочі блоки.",
    themeMode: "dark",
    accent: "#ff7a1a",
    accentStrong: "#ffad6e",
    background: "#080a0d",
    panel: "#10151b",
    panelRaised: "#1a212a",
    text: "#f3f5f7",
    muted: "#9da8b7",
    line: "#2b3542",
    success: "#39c985",
    warning: "#f4c15d",
    danger: "#f07070",
    info: "#78a9ff",
    font: "inter",
    scale: "compact",
    density: "compact",
    radius: "sharp",
    sidebar: "compact",
  },
  {
    id: "high-contrast",
    label: "High Contrast",
    description: "Підвищений контраст для контролю статусів, таблиць і критичних дій.",
    themeMode: "dark",
    accent: "#ff7b00",
    accentStrong: "#ffb15c",
    background: "#000000",
    panel: "#111111",
    panelRaised: "#1d1d1d",
    text: "#ffffff",
    muted: "#d1d5db",
    line: "#5c5c5c",
    success: "#55e391",
    warning: "#ffd166",
    danger: "#ff7777",
    info: "#8ab4ff",
    font: "system",
    scale: "comfortable",
    density: "comfortable",
    radius: "standard",
    sidebar: "expanded",
  },
];

const DEFAULT_PRESET = APPEARANCE_PRESETS[0];

export const DEFAULT_CRM_APPEARANCE: CrmAppearance = {
  ...DEFAULT_PRESET,
  preset: DEFAULT_PRESET.id,
  logoDataUrl: "",
  logoName: "",
};

const PRESET_IDS = new Set<AppearancePresetId>(APPEARANCE_PRESETS.map((item) => item.id));
const THEME_MODES = new Set<AppearanceThemeMode>(["light", "dark", "auto"]);
const FONTS = new Set<AppearanceFont>(["inter", "manrope", "system"]);
const SCALES = new Set<AppearanceScale>(["compact", "standard", "comfortable"]);
const DENSITIES = new Set<AppearanceDensity>(["compact", "standard", "comfortable"]);
const RADII = new Set<AppearanceRadius>(["sharp", "standard", "soft"]);
const SIDEBARS = new Set<AppearanceSidebar>(["expanded", "compact"]);

function pickString(value: unknown, fallback: string, max = 120) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

function pickEnum<T extends string>(value: unknown, values: Set<T>, fallback: T): T {
  return typeof value === "string" && values.has(value as T) ? value as T : fallback;
}

function safeColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
}

export function presetById(id: AppearancePresetId) {
  return APPEARANCE_PRESETS.find((item) => item.id === id) ?? DEFAULT_PRESET;
}

export function normalizeCrmAppearance(input: unknown): CrmAppearance {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const presetId = pickEnum(source.preset, PRESET_IDS, DEFAULT_CRM_APPEARANCE.preset);
  const preset = presetById(presetId);
  const base = { ...preset, logoDataUrl: "", logoName: "" };
  return {
    ...base,
    preset: presetId,
    themeMode: pickEnum(source.themeMode, THEME_MODES, base.themeMode),
    accent: safeColor(source.accent, base.accent),
    accentStrong: safeColor(source.accentStrong, base.accentStrong),
    background: safeColor(source.background, base.background),
    panel: safeColor(source.panel, base.panel),
    panelRaised: safeColor(source.panelRaised, base.panelRaised),
    text: safeColor(source.text, base.text),
    muted: safeColor(source.muted, base.muted),
    line: safeColor(source.line, base.line),
    success: safeColor(source.success, base.success),
    warning: safeColor(source.warning, base.warning),
    danger: safeColor(source.danger, base.danger),
    info: safeColor(source.info, base.info),
    font: pickEnum(source.font, FONTS, base.font),
    scale: pickEnum(source.scale, SCALES, base.scale),
    density: pickEnum(source.density, DENSITIES, base.density),
    radius: pickEnum(source.radius, RADII, base.radius),
    sidebar: pickEnum(source.sidebar, SIDEBARS, base.sidebar),
    logoDataUrl: pickString(source.logoDataUrl, "", 700_000),
    logoName: pickString(source.logoName, "", 120),
  };
}

export function resolvedTheme(mode: AppearanceThemeMode): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function fontValue(font: AppearanceFont) {
  if (font === "inter") return 'Inter, "Segoe UI Variable Text", "Segoe UI", sans-serif';
  if (font === "manrope") return 'Manrope, "Segoe UI Variable Text", "Segoe UI", sans-serif';
  return '"Segoe UI Variable Text", "Segoe UI", ui-sans-serif, -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif';
}

function scaleValues(scale: AppearanceScale) {
  if (scale === "compact") return { body: "13px", control: "13px", meta: "11px", label: "12px", title: "28px" };
  if (scale === "comfortable") return { body: "15px", control: "16px", meta: "13px", label: "14px", title: "32px" };
  return { body: "14px", control: "15px", meta: "12px", label: "13px", title: "30px" };
}

function radiusValue(radius: AppearanceRadius) {
  if (radius === "sharp") return { base: "6px", control: "7px", card: "9px" };
  if (radius === "soft") return { base: "14px", control: "11px", card: "16px" };
  return { base: "10px", control: "9px", card: "12px" };
}

/** Apply the server-controlled CRM profile to the document root. */
export function applyCrmAppearance(input: CrmAppearance) {
  if (typeof document === "undefined") return;
  const appearance = normalizeCrmAppearance(input);
  const root = document.documentElement;
  const theme = resolvedTheme(appearance.themeMode);
  const scale = scaleValues(appearance.scale);
  const radius = radiusValue(appearance.radius);
  const vars: Record<string, string> = {
    "--bg": appearance.background,
    "--panel": appearance.panel,
    "--panel-2": appearance.panelRaised,
    "--panel-raised": appearance.panelRaised,
    "--line": appearance.line,
    "--text": appearance.text,
    "--muted": appearance.muted,
    "--orange": appearance.accent,
    "--orange-2": appearance.accentStrong,
    "--accent": appearance.accent,
    "--accent-strong": appearance.accentStrong,
    "--green": appearance.success,
    "--yellow": appearance.warning,
    "--red": appearance.danger,
    "--blue": appearance.info,
    "--sidebar": appearance.panel,
    "--button-bg": appearance.panelRaised,
    "--button-text": appearance.text,
    "--soft-text": appearance.muted,
    "--soft-text-2": appearance.muted,
    "--ui-font": fontValue(appearance.font),
    "--crm-body-size": scale.body,
    "--crm-control-size": scale.control,
    "--crm-meta-size": scale.meta,
    "--crm-font-label": scale.label,
    "--crm-font-page-title": scale.title,
    "--crm-radius": radius.base,
    "--crm-control-radius": radius.control,
    "--crm-card-radius": radius.card,
  };
  Object.entries(vars).forEach(([key, value]) => root.style.setProperty(key, value));
  root.dataset.crmAppearance = "configured";
  root.dataset.crmPreset = appearance.preset;
  root.dataset.crmDensity = appearance.density;
  root.dataset.crmRadius = appearance.radius;
  root.dataset.crmSidebar = appearance.sidebar;
  root.dataset.theme = theme;
  root.dataset.themeMode = appearance.themeMode;
  root.style.colorScheme = theme;
  document.querySelectorAll<HTMLImageElement>("[data-crm-logo-slot]").forEach((logo) => {
    logo.src = appearance.logoDataUrl || logo.dataset.crmDefaultSrc || logo.src;
    logo.alt = appearance.logoName || "Turbo LEV";
  });
  window.dispatchEvent(new CustomEvent("turbolev:appearance-changed", { detail: appearance }));
}
