import type { CrmSectionLabel } from "./crm-navigation";
import type { SettingsTab } from "./settings-tabs";

export type CrmScreenContract = "one" | "one-scroll" | "two-max";

const SECTION_CONTRACTS: Partial<Record<CrmSectionLabel, CrmScreenContract>> = {
  "Огляд станції": "one-scroll",
  "Мої задачі": "one-scroll",
  "Нові звернення": "one-scroll",
  "Активні": "one-scroll",
  "Комунікації": "one-scroll",
  "Клієнти": "one-scroll",
  "Авто": "one-scroll",
  "Планувальник": "one-scroll",
  "Діагностика": "one-scroll",
  "Роботи": "one-scroll",
  "Комерційна пропозиція": "one-scroll",
  "Наряди та ремонт": "one-scroll",
  "Виробництво": "one-scroll",
  "Контроль якості": "one-scroll",
  "Гарантії": "one-scroll",
  "Підбір запчастин": "two-max",
  "Закупівлі та склад": "one-scroll",
  "Фінансовий центр": "two-max",
  "Оплати": "one-scroll",
  "Аналітика": "two-max",
  "Налаштування": "one-scroll",
};

const SETTINGS_CONTRACTS: Record<SettingsTab, CrmScreenContract> = {
  schedule: "one",
  personnel: "one-scroll",
  suppliers: "one-scroll",
  warehouse: "one-scroll",
  workPrices: "one-scroll",
  posts: "one-scroll",
  markup: "one",
  cash: "one-scroll",
  integrations: "one-scroll",
  cameras: "one",
  diagnosticTemplates: "one-scroll",
  appearance: "one",
  workflow: "one-scroll",
  security: "one-scroll",
  partsCatalog: "one-scroll",
};

export type CrmScreenRouteShape = {
  vehicleId?: string | null;
  vehiclePage?: string | null;
  diagnosticId?: string | null;
  workOrderId?: string | null;
};

export function resolveCrmScreenContract(
  section: CrmSectionLabel,
  settingsTab: SettingsTab,
  route: CrmScreenRouteShape = {},
): CrmScreenContract {
  if (section === "Налаштування") return SETTINGS_CONTRACTS[settingsTab];
  if (section === "Авто" && route.vehicleId) return "two-max";
  if (section === "Діагностика" && route.diagnosticId) return "two-max";
  if ((section === "Комерційна пропозиція" || section === "Наряди та ремонт") && route.workOrderId) return "two-max";
  return SECTION_CONTRACTS[section] ?? "one-scroll";
}

export function resolveCrmScreenId(
  section: CrmSectionLabel,
  settingsTab: SettingsTab,
  route: CrmScreenRouteShape = {},
) {
  if (section === "Налаштування") return `settings-${settingsTab}`;
  if (section === "Авто" && route.vehicleId) return route.vehiclePage ? `vehicle-${route.vehiclePage}` : "vehicle-record";
  if (section === "Діагностика" && route.diagnosticId) return "diagnostic-card";
  if ((section === "Комерційна пропозиція" || section === "Наряди та ремонт") && route.workOrderId) return "work-order-detail";

  const ids: Partial<Record<CrmSectionLabel, string>> = {
    "Огляд станції": "overview",
    "Мої задачі": "tasks",
    "Нові звернення": "communications",
    "Активні": "communications",
    "Комунікації": "communications",
    "Клієнти": "clients",
    "Авто": "vehicles",
    "Планувальник": "planner",
    "Діагностика": "diagnostics",
    "Роботи": "work-journal",
    "Комерційна пропозиція": "work-orders",
    "Наряди та ремонт": "work-orders",
    "Виробництво": "planner",
    "Контроль якості": "work-orders",
    "Гарантії": "warranties",
    "Підбір запчастин": "parts",
    "Закупівлі та склад": "procurement",
    "Фінансовий центр": "finance",
    "Оплати": "payments",
    "Аналітика": "analytics",
  };
  return ids[section] ?? "crm";
}
