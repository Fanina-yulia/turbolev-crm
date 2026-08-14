export const CRM_NAV_GROUPS = [
  { label: "Головне", items: [{ label: "Огляд станції", slug: "overview" }] },
  { label: "Продажі", items: [
    { label: "Комунікації", slug: "communications" },
    { label: "Ліди", slug: "leads" },
    { label: "Клієнти та авто", slug: "clients" },
  ] },
  { label: "Сервіс", items: [
    { label: "Планувальник", slug: "planner" },
    { label: "Діагностика", slug: "diagnostics" },
    { label: "Замовлення-наряди", slug: "work-orders" },
    { label: "Виробництво", slug: "production" },
    { label: "Контроль якості", slug: "quality" },
  ] },
  { label: "Запчастини", items: [
    { label: "Підбір запчастин", slug: "parts" },
    { label: "Закупівлі та склад", slug: "procurement" },
  ] },
  { label: "Фінанси", items: [{ label: "Оплати", slug: "payments" }] },
  { label: "Управління", items: [
    { label: "Гарантії", slug: "warranties" },
    { label: "Аналітика", slug: "analytics" },
  ] },
] as const;

export const CRM_NAV = CRM_NAV_GROUPS.flatMap((group) => group.items);

export type CrmSectionLabel = (typeof CRM_NAV)[number]["label"];
export type CrmSectionSlug = (typeof CRM_NAV)[number]["slug"];

export function sectionFromSlug(value: string | null | undefined): CrmSectionLabel {
  return CRM_NAV.find((item) => item.slug === value)?.label ?? "Огляд станції";
}
export function slugFromSection(value: string): CrmSectionSlug {
  return CRM_NAV.find((item) => item.label === value)?.slug ?? "overview";
}
export function isCrmSection(value: string): value is CrmSectionLabel {
  return CRM_NAV.some((item) => item.label === value);
}
