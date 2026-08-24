import { PERMISSIONS, type PermissionCode } from "@/src/security/permissions";
import type { DashboardWidgetSize, DashboardWidgetType } from "./types";

export type DashboardWidgetDefinition = {
  id: `W${string}`;
  widgetType: DashboardWidgetType;
  title: string;
  description: string;
  sizes: DashboardWidgetSize[];
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
  defaultW: number;
  defaultH: number;
  requiredPermission: PermissionCode;
  allowedRoleCodes?: string[];
};

export const DASHBOARD_WIDGET_REGISTRY: Record<DashboardWidgetType, DashboardWidgetDefinition> = {
  kpi_card: {
    id: "W01",
    widgetType: "kpi_card",
    title: "KPI Card",
    description: "Універсальна числова картка для версіонованої метрики.",
    sizes: ["S", "M"],
    minW: 3,
    minH: 2,
    maxW: 6,
    maxH: 3,
    defaultW: 4,
    defaultH: 2,
    requiredPermission: PERMISSIONS.OVERVIEW_READ,
  },
  attention_hub: {
    id: "W02",
    widgetType: "attention_hub",
    title: "Потребує уваги",
    description: "Критичні події та оперативні винятки з наступною дією.",
    sizes: ["M", "L"],
    minW: 6,
    minH: 4,
    maxW: 12,
    maxH: 7,
    defaultW: 6,
    defaultH: 4,
    requiredPermission: PERMISSIONS.OVERVIEW_READ,
  },
  owner_decisions: {
    id: "W03",
    widgetType: "owner_decisions",
    title: "Рішення власника",
    description: "Погодження та винятки з фінансовими або управлінськими наслідками.",
    sizes: ["M", "L"],
    minW: 6,
    minH: 4,
    maxW: 12,
    maxH: 7,
    defaultW: 6,
    defaultH: 4,
    requiredPermission: PERMISSIONS.OVERVIEW_READ,
    allowedRoleCodes: ["OWNER", "EXECUTIVE_DIRECTOR"],
  },
  service_flow: {
    id: "W04",
    widgetType: "service_flow",
    title: "Сервісний потік",
    description: "Рух автомобілів за етапами сервісного процесу.",
    sizes: ["L", "XL"],
    minW: 8,
    minH: 4,
    maxW: 12,
    maxH: 8,
    defaultW: 12,
    defaultH: 5,
    requiredPermission: PERMISSIONS.WORK_ORDERS_READ,
  },
  workshop_live: {
    id: "W05",
    widgetType: "workshop_live",
    title: "Ремзона LIVE",
    description: "Пости, механіки, черга та поточне завантаження ремзони.",
    sizes: ["L", "XL"],
    minW: 8,
    minH: 4,
    maxW: 12,
    maxH: 8,
    defaultW: 12,
    defaultH: 5,
    requiredPermission: PERMISSIONS.PRODUCTION_READ,
  },
  today_schedule: {
    id: "W06",
    widgetType: "today_schedule",
    title: "Сьогоднішній розклад",
    description: "Приїзди, заплановані роботи та вільні вікна поточного дня.",
    sizes: ["L", "XL"],
    minW: 8,
    minH: 4,
    maxW: 12,
    maxH: 8,
    defaultW: 12,
    defaultH: 5,
    requiredPermission: PERMISSIONS.PLANNER_READ,
  },
  parts_supply: {
    id: "W07",
    widgetType: "parts_supply",
    title: "Дефіцит та поставки",
    description: "Запчастини та поставки, що блокують або ризикують заблокувати ремонт.",
    sizes: ["M", "L"],
    minW: 6,
    minH: 4,
    maxW: 12,
    maxH: 7,
    defaultW: 6,
    defaultH: 4,
    requiredPermission: PERMISSIONS.PROCUREMENT_READ,
  },
  inventory_health: {
    id: "W08",
    widgetType: "inventory_health",
    title: "Здоров’я складу",
    description: "Оборотність, неліквіди, вартість запасів і стан постачальників.",
    sizes: ["M", "L"],
    minW: 6,
    minH: 4,
    maxW: 12,
    maxH: 7,
    defaultW: 6,
    defaultH: 4,
    requiredPermission: PERMISSIONS.PARTS_READ,
  },
  financial_analytics: {
    id: "W09",
    widgetType: "financial_analytics",
    title: "Фінансова аналітика",
    description: "План/факт, структура прибутку, динаміка та прогноз.",
    sizes: ["L", "XL"],
    minW: 8,
    minH: 4,
    maxW: 12,
    maxH: 8,
    defaultW: 8,
    defaultH: 5,
    requiredPermission: PERMISSIONS.ANALYTICS_FINANCIAL_READ,
    allowedRoleCodes: ["OWNER", "EXECUTIVE_DIRECTOR", "ACCOUNTANT"],
  },
  quality_experience: {
    id: "W10",
    widgetType: "quality_experience",
    title: "Якість і клієнтський досвід",
    description: "Контроль якості, повтори, гарантії, скарги та оцінки.",
    sizes: ["M", "L"],
    minW: 6,
    minH: 4,
    maxW: 12,
    maxH: 7,
    defaultW: 6,
    defaultH: 4,
    requiredPermission: PERMISSIONS.QC_READ,
  },
};

export const DASHBOARD_WIDGET_TYPES = Object.keys(DASHBOARD_WIDGET_REGISTRY) as DashboardWidgetType[];

export function getDashboardWidgetDefinition(widgetType: DashboardWidgetType) {
  return DASHBOARD_WIDGET_REGISTRY[widgetType];
}
