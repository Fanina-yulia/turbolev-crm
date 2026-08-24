export const CRM_NAV = [
  { label: "Огляд станції", slug: "overview" },
  { label: "Мої задачі", slug: "tasks" },
  { label: "Нові звернення", slug: "inquiries" },
  { label: "Активні", slug: "leads" },
  { label: "Комунікації", slug: "communications" },
  { label: "Клієнти", slug: "clients" },
  { label: "Авто", slug: "vehicles" },
  { label: "Планувальник", slug: "planner" },
  { label: "Діагностика", slug: "diagnostics" },
  { label: "Замовлення-наряди", slug: "work-orders" },
  { label: "Підбір запчастин", slug: "parts" },
  { label: "Закупівлі та склад", slug: "procurement" },
  { label: "Фінансовий центр", slug: "finance" },
  { label: "Оплати", slug: "payments" },
  { label: "Аналітика", slug: "analytics" },
  { label: "Налаштування", slug: "settings" },
] as const;

export type VisibleCrmSectionLabel = (typeof CRM_NAV)[number]["label"];
export type VisibleCrmSectionSlug = (typeof CRM_NAV)[number]["slug"];
export type LegacyCrmSectionLabel =
  | "Виробництво"
  | "Контроль якості"
  | "Гарантії"
  | "Ліди"
  | "Звернення";
export type CrmSectionLabel = VisibleCrmSectionLabel | LegacyCrmSectionLabel;
export type CrmSectionSlug = VisibleCrmSectionSlug | "production" | "quality" | "warranties";
export type CrmNavItem = (typeof CRM_NAV)[number];

type CrmNavGroup = { label: string; items: readonly CrmNavItem[] };

const IMPLEMENTED_SLUGS = new Set<VisibleCrmSectionSlug>([
  "overview",
  "tasks",
  "communications",
  "clients",
  "vehicles",
  "planner",
  "diagnostics",
  "work-orders",
  "parts",
  "procurement",
  "finance",
  "payments",
  "analytics",
  "settings",
]);

const SECTION_FALLBACKS: Partial<Record<CrmSectionLabel, VisibleCrmSectionLabel>> = {
  "Виробництво": "Замовлення-наряди",
  "Контроль якості": "Замовлення-наряди",
  "Гарантії": "Замовлення-наряди",
  "Ліди": "Комунікації",
  "Активні": "Комунікації",
  "Звернення": "Комунікації",
  "Нові звернення": "Комунікації",
};

function navItems(...slugs: VisibleCrmSectionSlug[]): CrmNavItem[] {
  return slugs.map((slug) => {
    const item = CRM_NAV.find((candidate) => candidate.slug === slug);
    if (!item) throw new Error(`Unknown CRM section: ${slug}`);
    return item;
  });
}

export const CRM_NAV_GROUPS: readonly CrmNavGroup[] = [
  { label: "Робочий стіл", items: navItems("overview", "tasks") },
  { label: "Робота з клієнтами", items: navItems("communications", "planner") },
  { label: "Клієнти та авто", items: navItems("clients", "vehicles") },
  { label: "Сервіс", items: navItems("diagnostics", "work-orders") },
  { label: "Запчастини", items: navItems("parts", "procurement") },
  { label: "Фінанси", items: navItems("finance", "payments") },
  { label: "Управління", items: navItems("analytics", "settings") },
];

export function isImplementedCrmSection(value: CrmSectionLabel): boolean {
  const resolved = resolveCrmSection(value);
  return IMPLEMENTED_SLUGS.has(slugFromSection(resolved) as VisibleCrmSectionSlug);
}

export function resolveCrmSection(value: CrmSectionLabel): VisibleCrmSectionLabel {
  return SECTION_FALLBACKS[value] ?? (value as VisibleCrmSectionLabel);
}

export function sectionFromSlug(value: string | null | undefined): VisibleCrmSectionLabel {
  if (value === "production" || value === "quality" || value === "warranties") return "Замовлення-наряди";
  if (value === "inquiries" || value === "leads") return "Комунікації";
  const section = CRM_NAV.find((item) => item.slug === value)?.label ?? "Огляд станції";
  return resolveCrmSection(section);
}

export function slugFromSection(value: string): VisibleCrmSectionSlug {
  if (value === "Виробництво" || value === "Контроль якості" || value === "Гарантії") return "work-orders";
  if (value === "Ліди" || value === "Активні" || value === "Звернення" || value === "Нові звернення") return "communications";
  return CRM_NAV.find((item) => item.label === value)?.slug ?? "overview";
}

export function isCrmSection(value: string): value is CrmSectionLabel {
  return value === "Виробництво"
    || value === "Контроль якості"
    || value === "Гарантії"
    || value === "Ліди"
    || value === "Звернення"
    || CRM_NAV.some((item) => item.label === value);
}
