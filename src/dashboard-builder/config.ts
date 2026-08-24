import { DASHBOARD_WIDGET_REGISTRY } from "./widget-registry";
import {
  DASHBOARD_GRID_COLUMNS,
  DASHBOARD_SCHEMA_VERSION,
  MAIN_DASHBOARD_ID,
  type DashboardAccessSnapshot,
  type DashboardConfigDocument,
  type DashboardGridLayout,
  type DashboardWidgetInstance,
  type DashboardWidgetSettings,
  type DashboardWidgetType,
} from "./types";

const MAX_WIDGETS = 40;
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeSettings(value: unknown): DashboardWidgetSettings {
  if (!isRecord(value)) return {};
  try {
    const cloned = JSON.parse(JSON.stringify(value)) as unknown;
    return isRecord(cloned) ? cloned : {};
  } catch {
    return {};
  }
}

function safeTitle(value: unknown) {
  if (typeof value !== "string") return undefined;
  const title = value.trim().slice(0, 120);
  return title || undefined;
}

export function isDashboardWidgetType(value: unknown): value is DashboardWidgetType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DASHBOARD_WIDGET_REGISTRY, value);
}

export function canUseDashboardWidget(widgetType: DashboardWidgetType, access: DashboardAccessSnapshot) {
  const definition = DASHBOARD_WIDGET_REGISTRY[widgetType];
  const hasPermission = Boolean(access.permissions[definition.requiredPermission]);
  const allowedByRole = !definition.allowedRoleCodes?.length
    || definition.allowedRoleCodes.some((role) => access.roleCodes.includes(role));
  return hasPermission && allowedByRole;
}

export function listAllowedDashboardWidgetDefinitions(access: DashboardAccessSnapshot) {
  return Object.values(DASHBOARD_WIDGET_REGISTRY).filter((definition) => canUseDashboardWidget(definition.widgetType, access));
}

function normalizeLayout(widgetType: DashboardWidgetType, input: unknown): DashboardGridLayout {
  const definition = DASHBOARD_WIDGET_REGISTRY[widgetType];
  const raw = isRecord(input) ? input : {};
  const w = clampInteger(raw.w, definition.minW, Math.min(definition.maxW, DASHBOARD_GRID_COLUMNS), definition.defaultW);
  const h = clampInteger(raw.h, definition.minH, definition.maxH, definition.defaultH);
  const x = clampInteger(raw.x, 0, DASHBOARD_GRID_COLUMNS - w, 0);
  const y = clampInteger(raw.y, 0, 10_000, 0);
  return { x, y, w, h };
}

function normalizeInstance(value: unknown, access: DashboardAccessSnapshot): DashboardWidgetInstance | null {
  if (!isRecord(value) || !isDashboardWidgetType(value.widgetType)) return null;
  if (!canUseDashboardWidget(value.widgetType, access)) return null;

  const rawId = typeof value.instanceId === "string" ? value.instanceId.trim() : "";
  if (!rawId || (!UUID_PATTERN.test(rawId) && !INSTANCE_ID_PATTERN.test(rawId))) return null;

  return {
    instanceId: rawId,
    widgetType: value.widgetType,
    title: safeTitle(value.title),
    layout: normalizeLayout(value.widgetType, value.layout),
    settings: safeSettings(value.settings),
  };
}

export function sanitizeDashboardConfig(
  input: unknown,
  access: DashboardAccessSnapshot,
  fallbackPresetId: string,
): DashboardConfigDocument {
  const raw = isRecord(input) ? input : {};
  const rawWidgets = Array.isArray(raw.widgets) ? raw.widgets.slice(0, MAX_WIDGETS) : [];
  const seen = new Set<string>();
  const widgets: DashboardWidgetInstance[] = [];

  for (const value of rawWidgets) {
    const widget = normalizeInstance(value, access);
    if (!widget || seen.has(widget.instanceId)) continue;
    seen.add(widget.instanceId);
    widgets.push(widget);
  }

  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    dashboardId: MAIN_DASHBOARD_ID,
    presetId: typeof raw.presetId === "string" && raw.presetId.trim()
      ? raw.presetId.trim().slice(0, 80)
      : fallbackPresetId,
    widgets,
  };
}

export function dashboardAccessSnapshot(input: {
  roles: Array<{ code: string }>;
  permissions: Record<string, unknown>;
}): DashboardAccessSnapshot {
  return {
    roleCodes: input.roles.map((role) => role.code),
    permissions: input.permissions,
  };
}

export function isSupportedDashboardId(value: unknown): value is typeof MAIN_DASHBOARD_ID {
  return value === MAIN_DASHBOARD_ID;
}
