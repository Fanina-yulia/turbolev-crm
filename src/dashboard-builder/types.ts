export const DASHBOARD_SCHEMA_VERSION = 1 as const;
export const MAIN_DASHBOARD_ID = "main_home" as const;
export const DASHBOARD_GRID_COLUMNS = 12 as const;

export type DashboardWidgetType =
  | "kpi_card"
  | "attention_hub"
  | "owner_decisions"
  | "service_flow"
  | "workshop_live"
  | "today_schedule"
  | "parts_supply"
  | "inventory_health"
  | "financial_analytics"
  | "quality_experience";

export type DashboardWidgetState =
  | "loading"
  | "ready"
  | "empty"
  | "partial"
  | "stale"
  | "error"
  | "forbidden";

export type DashboardWidgetSize = "S" | "M" | "L" | "XL";

export type DashboardGridLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DashboardWidgetSettings = Record<string, unknown>;

export type DashboardWidgetInstance = {
  instanceId: string;
  widgetType: DashboardWidgetType;
  title?: string;
  layout: DashboardGridLayout;
  settings: DashboardWidgetSettings;
};

export type DashboardConfigDocument = {
  schemaVersion: typeof DASHBOARD_SCHEMA_VERSION;
  dashboardId: typeof MAIN_DASHBOARD_ID;
  presetId: string;
  widgets: DashboardWidgetInstance[];
};

export type DashboardConfigSource = "preset" | "user";

export type DashboardConfigEnvelope = {
  dashboardId: typeof MAIN_DASHBOARD_ID;
  version: number;
  source: DashboardConfigSource;
  presetId: string;
  config: DashboardConfigDocument;
};

export type DashboardPreset = {
  presetId: string;
  version: number;
  roleCodes: string[];
  title: string;
  config: DashboardConfigDocument;
};

export type DashboardAccessSnapshot = {
  roleCodes: string[];
  permissions: Record<string, unknown>;
};
