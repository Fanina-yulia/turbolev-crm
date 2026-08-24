import type { DashboardGridLayout, DashboardPreset, DashboardWidgetInstance } from "./types";
import { DASHBOARD_SCHEMA_VERSION, MAIN_DASHBOARD_ID } from "./types";

type PresetItemKey =
  | "revenue"
  | "gross_profit"
  | "post_utilization"
  | "active_cars"
  | "overdue_cars"
  | "attention"
  | "owner_decisions"
  | "service_flow"
  | "workshop_live"
  | "today_schedule"
  | "parts_supply"
  | "inventory_health"
  | "financial_analytics"
  | "quality_experience";

const PRESET_ITEMS: Record<PresetItemKey, Omit<DashboardWidgetInstance, "layout">> = {
  revenue: {
    instanceId: "a1000000-0000-4000-8000-000000000001",
    widgetType: "kpi_card",
    title: "Виручка",
    settings: { metricId: "revenue_v1", period: "month", compareWith: "previous_period", format: "money" },
  },
  gross_profit: {
    instanceId: "a1000000-0000-4000-8000-000000000002",
    widgetType: "kpi_card",
    title: "Валовий прибуток",
    settings: { metricId: "gross_profit_v1", period: "month", compareWith: "previous_period", format: "money" },
  },
  post_utilization: {
    instanceId: "a1000000-0000-4000-8000-000000000003",
    widgetType: "kpi_card",
    title: "Завантаження постів",
    settings: { metricId: "post_utilization_v1", period: "today", compareWith: "previous_period", format: "percent" },
  },
  active_cars: {
    instanceId: "a1000000-0000-4000-8000-000000000004",
    widgetType: "kpi_card",
    title: "Авто в роботі",
    settings: { metricId: "active_cars_v1", period: "now", compareWith: "none", format: "number" },
  },
  overdue_cars: {
    instanceId: "a1000000-0000-4000-8000-000000000005",
    widgetType: "kpi_card",
    title: "Прострочені авто",
    settings: { metricId: "overdue_cars_v1", period: "now", compareWith: "none", format: "number" },
  },
  attention: {
    instanceId: "a1000000-0000-4000-8000-000000000006",
    widgetType: "attention_hub",
    settings: { severity: ["critical", "warning"], limit: 8 },
  },
  owner_decisions: {
    instanceId: "a1000000-0000-4000-8000-000000000007",
    widgetType: "owner_decisions",
    settings: { status: "pending", limit: 8 },
  },
  service_flow: {
    instanceId: "a1000000-0000-4000-8000-000000000008",
    widgetType: "service_flow",
    settings: { mode: "pipeline", period: "today" },
  },
  workshop_live: {
    instanceId: "a1000000-0000-4000-8000-000000000009",
    widgetType: "workshop_live",
    settings: { mode: "posts", period: "now" },
  },
  today_schedule: {
    instanceId: "a1000000-0000-4000-8000-000000000010",
    widgetType: "today_schedule",
    settings: { period: "today", mode: "timeline" },
  },
  parts_supply: {
    instanceId: "a1000000-0000-4000-8000-000000000011",
    widgetType: "parts_supply",
    settings: { status: ["blocking", "at_risk"], limit: 10 },
  },
  inventory_health: {
    instanceId: "a1000000-0000-4000-8000-000000000012",
    widgetType: "inventory_health",
    settings: { mode: "kpi", period: "month" },
  },
  financial_analytics: {
    instanceId: "a1000000-0000-4000-8000-000000000013",
    widgetType: "financial_analytics",
    settings: { mode: "plan_fact", period: "month", compareWith: "previous_period" },
  },
  quality_experience: {
    instanceId: "a1000000-0000-4000-8000-000000000014",
    widgetType: "quality_experience",
    settings: { mode: "quality_control", period: "month", limit: 10 },
  },
};

function widget(key: PresetItemKey, layout: DashboardGridLayout): DashboardWidgetInstance {
  return { ...PRESET_ITEMS[key], layout, settings: { ...PRESET_ITEMS[key].settings } };
}

function preset(args: {
  presetId: string;
  title: string;
  roleCodes: string[];
  widgets: DashboardWidgetInstance[];
}): DashboardPreset {
  return {
    presetId: args.presetId,
    version: 1,
    roleCodes: args.roleCodes,
    title: args.title,
    config: {
      schemaVersion: DASHBOARD_SCHEMA_VERSION,
      dashboardId: MAIN_DASHBOARD_ID,
      presetId: args.presetId,
      widgets: args.widgets,
    },
  };
}

export const DASHBOARD_ROLE_PRESETS: DashboardPreset[] = [
  preset({
    presetId: "owner_network_v1",
    title: "Власник · мережа",
    roleCodes: ["OWNER", "EXECUTIVE_DIRECTOR"],
    widgets: [
      widget("revenue", { x: 0, y: 0, w: 4, h: 2 }),
      widget("gross_profit", { x: 4, y: 0, w: 4, h: 2 }),
      widget("post_utilization", { x: 8, y: 0, w: 4, h: 2 }),
      widget("owner_decisions", { x: 0, y: 2, w: 6, h: 4 }),
      widget("attention", { x: 6, y: 2, w: 6, h: 4 }),
      widget("financial_analytics", { x: 0, y: 6, w: 8, h: 5 }),
      widget("inventory_health", { x: 8, y: 6, w: 4, h: 5 }),
    ],
  }),
  preset({
    presetId: "station_manager_v1",
    title: "Керівник СТО",
    roleCodes: ["STATION_MANAGER"],
    widgets: [
      widget("active_cars", { x: 0, y: 0, w: 4, h: 2 }),
      widget("overdue_cars", { x: 4, y: 0, w: 4, h: 2 }),
      widget("post_utilization", { x: 8, y: 0, w: 4, h: 2 }),
      widget("attention", { x: 0, y: 2, w: 6, h: 4 }),
      widget("workshop_live", { x: 0, y: 6, w: 12, h: 5 }),
      widget("today_schedule", { x: 0, y: 11, w: 12, h: 5 }),
      widget("parts_supply", { x: 0, y: 16, w: 6, h: 4 }),
      widget("quality_experience", { x: 6, y: 16, w: 6, h: 4 }),
    ],
  }),
  preset({
    presetId: "service_advisor_v1",
    title: "Майстер-приймальник",
    roleCodes: ["SERVICE_ADVISOR"],
    widgets: [
      widget("active_cars", { x: 0, y: 0, w: 4, h: 2 }),
      widget("overdue_cars", { x: 4, y: 0, w: 4, h: 2 }),
      widget("attention", { x: 0, y: 2, w: 6, h: 4 }),
      widget("service_flow", { x: 0, y: 6, w: 12, h: 5 }),
      widget("today_schedule", { x: 0, y: 11, w: 12, h: 5 }),
      widget("parts_supply", { x: 0, y: 16, w: 6, h: 4 }),
    ],
  }),
  preset({
    presetId: "workshop_master_v1",
    title: "Ремзона",
    roleCodes: ["MECHANIC"],
    widgets: [
      widget("active_cars", { x: 0, y: 0, w: 4, h: 2 }),
      widget("post_utilization", { x: 4, y: 0, w: 4, h: 2 }),
      widget("workshop_live", { x: 0, y: 2, w: 12, h: 5 }),
      widget("parts_supply", { x: 0, y: 7, w: 6, h: 4 }),
      widget("quality_experience", { x: 6, y: 7, w: 6, h: 4 }),
    ],
  }),
];

const BASIC_PRESET = preset({
  presetId: "overview_basic_v1",
  title: "Огляд",
  roleCodes: [],
  widgets: [widget("active_cars", { x: 0, y: 0, w: 4, h: 2 })],
});

export function resolveDashboardPreset(roleCodes: string[]) {
  return DASHBOARD_ROLE_PRESETS.find((item) => item.roleCodes.some((role) => roleCodes.includes(role))) ?? BASIC_PRESET;
}

export const DASHBOARD_PRESET_ITEM_COUNT = Object.keys(PRESET_ITEMS).length;
