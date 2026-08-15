export const CRM_NAV = [
  { label: "Огляд станції", slug: "overview" },
  { label: "Комунікації", slug: "communications" },
  { label: "Ліди", slug: "leads" },
  { label: "Клієнти та авто", slug: "clients" },
  { label: "Планувальник", slug: "planner" },
  { label: "Діагностика", slug: "diagnostics" },
  { label: "Замовлення-наряди", slug: "work-orders" },
  { label: "Виробництво", slug: "production" },
  { label: "Контроль якості", slug: "quality" },
  { label: "Підбір запчастин", slug: "parts" },
  { label: "Закупівлі та склад", slug: "procurement" },
  { label: "Оплати", slug: "payments" },
  { label: "Гарантії", slug: "warranties" },
  { label: "Аналітика", slug: "analytics" },
  { label: "Налаштування", slug: "settings" },
] as const;

export type CrmSectionLabel = (typeof CRM_NAV)[number]["label"];
export type CrmSectionSlug = (typeof CRM_NAV)[number]["slug"];
export type CrmNavItem = (typeof CRM_NAV)[number];

type CrmNavGroup = { label: string; items: readonly CrmNavItem[] };

function navItems(...slugs: CrmSectionSlug[]): CrmNavItem[] {
  return slugs.map((slug) => {
    const item = CRM_NAV.find((candidate) => candidate.slug === slug);
    if (!item) throw new Error(`Unknown CRM section: ${slug}`);
    return item;
  });
}

export const CRM_NAV_GROUPS: readonly CrmNavGroup[] = [
  { label: "Головне", items: navItems("overview") },
  { label: "Продажі", items: navItems("communications", "leads", "clients") },
  { label: "Сервіс", items: navItems("planner", "diagnostics", "work-orders", "production", "quality") },
  { label: "Запчастини", items: navItems("parts", "procurement") },
  { label: "Фінанси", items: navItems("payments") },
  { label: "Управління", items: navItems("warranties", "analytics", "settings") },
];

export function sectionFromSlug(value: string | null | undefined): CrmSectionLabel {
  return CRM_NAV.find((item) => item.slug === value)?.label ?? "Огляд станції";
}
export function slugFromSection(value: string): CrmSectionSlug {
  return CRM_NAV.find((item) => item.label === value)?.slug ?? "overview";
}
export function isCrmSection(value: string): value is CrmSectionLabel {
  return CRM_NAV.some((item) => item.label === value);
}
