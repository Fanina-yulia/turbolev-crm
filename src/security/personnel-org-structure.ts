export const PERSONNEL_CATEGORIES = [
  "Керівництво",
  "Сервіс",
  "Механіки",
  "Запчастини та склад",
  "Продажі",
  "Фінанси",
  "Маркетинг",
  "Персонал",
  "Адміністрація",
  "IT / CRM",
] as const;

export const PERSONNEL_POSITIONS = [
  { code: "OWNER", name: "Власник", category: "Керівництво", requiresLocation: false, sortOrder: 10 },
  { code: "EXECUTIVE_DIRECTOR", name: "Виконавчий директор", category: "Керівництво", requiresLocation: false, sortOrder: 20 },
  { code: "STATION_MANAGER", name: "Керівник станції", category: "Керівництво", requiresLocation: true, sortOrder: 30 },
  { code: "SERVICE_ADVISOR", name: "Сервіс-менеджер", category: "Сервіс", requiresLocation: true, sortOrder: 40 },
  { code: "MECHANIC", name: "Механік", category: "Механіки", requiresLocation: true, sortOrder: 50 },
  { code: "PARTS_SPECIALIST", name: "Менеджер з запчастин", category: "Запчастини та склад", requiresLocation: true, sortOrder: 60 },
  { code: "WAREHOUSE_KEEPER", name: "Комірник", category: "Запчастини та склад", requiresLocation: true, sortOrder: 70 },
  { code: "HEAD_OF_SALES", name: "Керівник відділу продажів", category: "Продажі", requiresLocation: false, sortOrder: 80 },
  { code: "SALES", name: "Менеджер з продажу", category: "Продажі", requiresLocation: true, sortOrder: 90 },
  { code: "ACCOUNTANT", name: "Бухгалтер", category: "Фінанси", requiresLocation: false, sortOrder: 100 },
  { code: "MARKETING_DIRECTOR", name: "Директор з маркетингу", category: "Маркетинг", requiresLocation: false, sortOrder: 110 },
  { code: "MARKETER", name: "Маркетолог", category: "Маркетинг", requiresLocation: false, sortOrder: 120 },
  { code: "HR_MANAGER", name: "HR-менеджер", category: "Персонал", requiresLocation: false, sortOrder: 130 },
  { code: "ADMINISTRATOR", name: "Адміністратор", category: "Адміністрація", requiresLocation: true, sortOrder: 140 },
  { code: "CRM_ADMIN", name: "CRM-адміністратор", category: "IT / CRM", requiresLocation: false, sortOrder: 150 },
] as const;

export type PersonnelCategory = (typeof PERSONNEL_CATEGORIES)[number];
export type PersonnelRoleCode = (typeof PERSONNEL_POSITIONS)[number]["code"];

export const PERSONNEL_ROLE_CODES = PERSONNEL_POSITIONS.map((item) => item.code) as PersonnelRoleCode[];
export const GLOBAL_PERSONNEL_ROLE_CODES = new Set<PersonnelRoleCode>(
  PERSONNEL_POSITIONS.filter((item) => !item.requiresLocation).map((item) => item.code),
);
export const STATION_MANAGER_DELEGATABLE_ROLE_CODES = new Set<PersonnelRoleCode>([
  "SERVICE_ADVISOR",
  "MECHANIC",
  "PARTS_SPECIALIST",
  "WAREHOUSE_KEEPER",
  "SALES",
  "ADMINISTRATOR",
]);
export const HR_MANAGER_DELEGATABLE_ROLE_CODES = new Set<PersonnelRoleCode>(
  PERSONNEL_ROLE_CODES.filter((code) => !["OWNER", "EXECUTIVE_DIRECTOR", "CRM_ADMIN"].includes(code)),
);

export function personnelPositionByCode(code: string | null | undefined) {
  const normalized = String(code || "").trim().toUpperCase();
  return PERSONNEL_POSITIONS.find((item) => item.code === normalized) ?? null;
}

export function personnelPositionsByCategory(category: string | null | undefined) {
  return PERSONNEL_POSITIONS.filter((item) => item.category === category);
}
