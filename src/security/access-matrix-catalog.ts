import { PERMISSIONS, type AccessScopeCode, type PermissionCode } from "@/src/security/permissions";

export type PermissionPresentation = {
  label: string;
  moduleLabel: string;
  sensitive?: boolean;
};

export const ACCESS_SCOPE_LABELS: Record<AccessScopeCode, string> = {
  SELF: "Тільки своє",
  ASSIGNED: "Призначене мені",
  TEAM: "Моя команда",
  LOCATION: "Моя станція",
  ALL: "Вся мережа",
};

export const PERMISSION_PRESENTATION: Record<PermissionCode, PermissionPresentation> = {
  [PERMISSIONS.OVERVIEW_READ]: { label: "Перегляд огляду", moduleLabel: "Огляд станції" },
  [PERMISSIONS.COMMUNICATIONS_READ]: { label: "Перегляд комунікацій", moduleLabel: "Комунікації" },
  [PERMISSIONS.COMMUNICATIONS_WRITE]: { label: "Робота з комунікаціями", moduleLabel: "Комунікації" },
  [PERMISSIONS.LEADS_READ]: { label: "Перегляд лідів", moduleLabel: "Ліди" },
  [PERMISSIONS.LEADS_WRITE]: { label: "Редагування лідів", moduleLabel: "Ліди" },
  [PERMISSIONS.LEADS_ASSIGN]: { label: "Призначення відповідального", moduleLabel: "Ліди" },
  [PERMISSIONS.CLIENTS_READ]: { label: "Перегляд клієнтів та авто", moduleLabel: "Клієнти та авто" },
  [PERMISSIONS.CLIENTS_WRITE]: { label: "Редагування клієнтів та авто", moduleLabel: "Клієнти та авто" },
  [PERMISSIONS.PLANNER_READ]: { label: "Перегляд планувальника", moduleLabel: "Планувальник" },
  [PERMISSIONS.PLANNER_WRITE]: { label: "Зміна записів та ресурсів", moduleLabel: "Планувальник" },
  [PERMISSIONS.DIAGNOSTICS_READ]: { label: "Перегляд діагностик", moduleLabel: "Діагностика" },
  [PERMISSIONS.DIAGNOSTICS_WRITE]: { label: "Ведення діагностики", moduleLabel: "Діагностика" },
  [PERMISSIONS.DIAGNOSTICS_CONFIRM]: { label: "Підтвердження технічного висновку", moduleLabel: "Діагностика", sensitive: true },
  [PERMISSIONS.WORK_ORDERS_READ]: { label: "Перегляд нарядів", moduleLabel: "Замовлення-наряди" },
  [PERMISSIONS.WORK_ORDERS_WRITE]: { label: "Редагування та статуси наряду", moduleLabel: "Замовлення-наряди" },
  [PERMISSIONS.WORK_ORDERS_ESTIMATE]: { label: "Кошторис і погодження", moduleLabel: "Замовлення-наряди", sensitive: true },
  [PERMISSIONS.PRODUCTION_READ]: { label: "Перегляд виробництва", moduleLabel: "Виробництво" },
  [PERMISSIONS.PRODUCTION_WRITE]: { label: "Ведення ремонту", moduleLabel: "Виробництво" },
  [PERMISSIONS.QC_READ]: { label: "Перегляд контролю якості", moduleLabel: "Контроль якості" },
  [PERMISSIONS.QC_WRITE]: { label: "Проведення QC", moduleLabel: "Контроль якості", sensitive: true },
  [PERMISSIONS.PARTS_READ]: { label: "Перегляд підбору", moduleLabel: "Підбір запчастин" },
  [PERMISSIONS.PARTS_WRITE]: { label: "Підбір та фактичне отримання", moduleLabel: "Підбір запчастин" },
  [PERMISSIONS.PROCUREMENT_READ]: { label: "Перегляд закупівель", moduleLabel: "Закупівлі" },
  [PERMISSIONS.PROCUREMENT_WRITE]: { label: "Замовлення постачальникам", moduleLabel: "Закупівлі", sensitive: true },
  [PERMISSIONS.FINANCE_READ]: { label: "Перегляд фінансового центру", moduleLabel: "Фінансовий центр", sensitive: true },
  [PERMISSIONS.FINANCE_WRITE]: { label: "Фінансові операції", moduleLabel: "Фінансовий центр", sensitive: true },
  [PERMISSIONS.PAYMENTS_READ]: { label: "Перегляд оплат", moduleLabel: "Оплати", sensitive: true },
  [PERMISSIONS.PAYMENTS_WRITE]: { label: "Проведення оплат", moduleLabel: "Оплати", sensitive: true },
  [PERMISSIONS.PAYROLL_SELF_READ]: { label: "Власна зарплата", moduleLabel: "Зарплата", sensitive: true },
  [PERMISSIONS.PAYROLL_ALL_READ]: { label: "Зарплати всіх працівників", moduleLabel: "Зарплата", sensitive: true },
  [PERMISSIONS.PAYROLL_WRITE]: { label: "Розрахунок зарплати", moduleLabel: "Зарплата", sensitive: true },
  [PERMISSIONS.PAYROLL_CLOSE]: { label: "Закриття зарплатного періоду", moduleLabel: "Зарплата", sensitive: true },
  [PERMISSIONS.PERSONNEL_READ]: { label: "Перегляд персоналу", moduleLabel: "Персонал" },
  [PERMISSIONS.PERSONNEL_WRITE]: { label: "Редагування персоналу", moduleLabel: "Персонал", sensitive: true },
  [PERMISSIONS.PERSONNEL_COMPENSATION_READ]: { label: "Компенсації та ставки", moduleLabel: "Персонал", sensitive: true },
  [PERMISSIONS.WARRANTY_READ]: { label: "Перегляд гарантій", moduleLabel: "Гарантії" },
  [PERMISSIONS.WARRANTY_WRITE]: { label: "Ведення гарантій", moduleLabel: "Гарантії" },
  [PERMISSIONS.ANALYTICS_READ]: { label: "Операційна аналітика", moduleLabel: "Аналітика" },
  [PERMISSIONS.ANALYTICS_PERSONNEL_READ]: { label: "Аналітика персоналу", moduleLabel: "Аналітика", sensitive: true },
  [PERMISSIONS.ANALYTICS_FINANCIAL_READ]: { label: "Фінансова аналітика", moduleLabel: "Аналітика", sensitive: true },
  [PERMISSIONS.SETTINGS_READ]: { label: "Перегляд налаштувань", moduleLabel: "Налаштування" },
  [PERMISSIONS.SETTINGS_WRITE]: { label: "Зміна налаштувань", moduleLabel: "Налаштування", sensitive: true },
  [PERMISSIONS.SETTINGS_INTEGRATIONS]: { label: "Інтеграції та credentials", moduleLabel: "Налаштування", sensitive: true },
  [PERMISSIONS.AUDIT_READ]: { label: "Журнал аудиту", moduleLabel: "Безпека", sensitive: true },
  [PERMISSIONS.SECURITY_ACCESS_MANAGE]: { label: "Ролі та допуски", moduleLabel: "Безпека", sensitive: true },
};

export type AccessRolePreset = {
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  grants: Array<{ code: PermissionCode; scope: AccessScopeCode }>;
};

const grant = (code: PermissionCode, scope: AccessScopeCode) => ({ code, scope });
const all = Object.values(PERMISSIONS).map((code) => grant(code, "ALL"));

export const DEFAULT_ACCESS_ROLES: AccessRolePreset[] = [
  { code: "OWNER", name: "Власник", description: "Повний доступ до всієї мережі, фінансів, безпеки та налаштувань.", sortOrder: 10, grants: all },
  { code: "EXECUTIVE_DIRECTOR", name: "Виконавчий директор", description: "Повний управлінський доступ до всієї мережі.", sortOrder: 20, grants: all },
  { code: "HEAD_OF_SALES", name: "Керівник відділу продажів", description: "Продажі, команда, клієнти та контроль воронки без фінансового адміністрування.", sortOrder: 30, grants: [
    grant(PERMISSIONS.OVERVIEW_READ,"ALL"), grant(PERMISSIONS.COMMUNICATIONS_READ,"ALL"), grant(PERMISSIONS.COMMUNICATIONS_WRITE,"TEAM"),
    grant(PERMISSIONS.LEADS_READ,"ALL"), grant(PERMISSIONS.LEADS_WRITE,"TEAM"), grant(PERMISSIONS.LEADS_ASSIGN,"TEAM"), grant(PERMISSIONS.CLIENTS_READ,"ALL"),
    grant(PERMISSIONS.CLIENTS_WRITE,"TEAM"), grant(PERMISSIONS.PLANNER_READ,"ALL"), grant(PERMISSIONS.WORK_ORDERS_READ,"ALL"), grant(PERMISSIONS.WORK_ORDERS_ESTIMATE,"TEAM"),
    grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"), grant(PERMISSIONS.PERSONNEL_READ,"TEAM"), grant(PERMISSIONS.ANALYTICS_READ,"ALL"), grant(PERMISSIONS.ANALYTICS_PERSONNEL_READ,"TEAM"),
  ]},
  { code: "SALES", name: "Продавець", description: "Робота зі своїми та командними лідами, клієнтами і записами.", sortOrder: 40, grants: [
    grant(PERMISSIONS.OVERVIEW_READ,"LOCATION"), grant(PERMISSIONS.COMMUNICATIONS_READ,"TEAM"), grant(PERMISSIONS.COMMUNICATIONS_WRITE,"ASSIGNED"),
    grant(PERMISSIONS.LEADS_READ,"TEAM"), grant(PERMISSIONS.LEADS_WRITE,"ASSIGNED"), grant(PERMISSIONS.CLIENTS_READ,"TEAM"), grant(PERMISSIONS.CLIENTS_WRITE,"ASSIGNED"),
    grant(PERMISSIONS.PLANNER_READ,"LOCATION"), grant(PERMISSIONS.PLANNER_WRITE,"ASSIGNED"), grant(PERMISSIONS.WORK_ORDERS_READ,"ASSIGNED"),
    grant(PERMISSIONS.WORK_ORDERS_ESTIMATE,"ASSIGNED"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),
  ]},
  { code: "PARTS_SPECIALIST", name: "Підборщик запчастин", description: "Підбір, закупівлі та робота з постачальниками.", sortOrder: 50, grants: [
    grant(PERMISSIONS.OVERVIEW_READ,"LOCATION"), grant(PERMISSIONS.WORK_ORDERS_READ,"LOCATION"), grant(PERMISSIONS.PARTS_READ,"ALL"),
    grant(PERMISSIONS.PARTS_WRITE,"ALL"), grant(PERMISSIONS.PROCUREMENT_READ,"ALL"), grant(PERMISSIONS.PROCUREMENT_WRITE,"ALL"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),
  ]},
  { code: "STATION_MANAGER", name: "Завідувач станцією", description: "Повний операційний цикл конкретної станції без доступу до глобальної фінансової адміністрації.", sortOrder: 60, grants: [
    grant(PERMISSIONS.OVERVIEW_READ,"LOCATION"), grant(PERMISSIONS.CLIENTS_READ,"LOCATION"), grant(PERMISSIONS.PLANNER_READ,"LOCATION"), grant(PERMISSIONS.PLANNER_WRITE,"LOCATION"),
    grant(PERMISSIONS.DIAGNOSTICS_READ,"LOCATION"), grant(PERMISSIONS.DIAGNOSTICS_WRITE,"LOCATION"), grant(PERMISSIONS.DIAGNOSTICS_CONFIRM,"LOCATION"),
    grant(PERMISSIONS.WORK_ORDERS_READ,"LOCATION"), grant(PERMISSIONS.WORK_ORDERS_WRITE,"LOCATION"), grant(PERMISSIONS.WORK_ORDERS_ESTIMATE,"LOCATION"),
    grant(PERMISSIONS.PRODUCTION_READ,"LOCATION"), grant(PERMISSIONS.PRODUCTION_WRITE,"LOCATION"), grant(PERMISSIONS.QC_READ,"LOCATION"), grant(PERMISSIONS.QC_WRITE,"LOCATION"),
    grant(PERMISSIONS.PARTS_READ,"LOCATION"), grant(PERMISSIONS.PROCUREMENT_READ,"LOCATION"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"), grant(PERMISSIONS.PERSONNEL_READ,"LOCATION"),
    grant(PERMISSIONS.ANALYTICS_READ,"LOCATION"), grant(PERMISSIONS.ANALYTICS_PERSONNEL_READ,"LOCATION"), grant(PERMISSIONS.WARRANTY_READ,"LOCATION"), grant(PERMISSIONS.WARRANTY_WRITE,"LOCATION"),
  ]},
  { code: "SERVICE_ADVISOR", name: "Сервіс-менеджер", description: "Приймання клієнта, діагностика, кошторис, погодження та супровід ремонту в межах своєї станції.", sortOrder: 65, grants: [
    grant(PERMISSIONS.OVERVIEW_READ,"LOCATION"), grant(PERMISSIONS.COMMUNICATIONS_READ,"LOCATION"), grant(PERMISSIONS.COMMUNICATIONS_WRITE,"LOCATION"),
    grant(PERMISSIONS.LEADS_READ,"LOCATION"), grant(PERMISSIONS.LEADS_WRITE,"LOCATION"), grant(PERMISSIONS.CLIENTS_READ,"LOCATION"), grant(PERMISSIONS.CLIENTS_WRITE,"LOCATION"),
    grant(PERMISSIONS.PLANNER_READ,"LOCATION"), grant(PERMISSIONS.PLANNER_WRITE,"LOCATION"), grant(PERMISSIONS.DIAGNOSTICS_READ,"LOCATION"), grant(PERMISSIONS.DIAGNOSTICS_WRITE,"LOCATION"),
    grant(PERMISSIONS.DIAGNOSTICS_CONFIRM,"LOCATION"), grant(PERMISSIONS.WORK_ORDERS_READ,"LOCATION"), grant(PERMISSIONS.WORK_ORDERS_WRITE,"LOCATION"),
    grant(PERMISSIONS.WORK_ORDERS_ESTIMATE,"LOCATION"), grant(PERMISSIONS.PRODUCTION_READ,"LOCATION"), grant(PERMISSIONS.QC_READ,"LOCATION"), grant(PERMISSIONS.PARTS_READ,"LOCATION"),
    grant(PERMISSIONS.PROCUREMENT_READ,"LOCATION"), grant(PERMISSIONS.WARRANTY_READ,"LOCATION"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),
  ]},
  { code: "MECHANIC", name: "Автомеханік", description: "Призначені діагностики й роботи, виробництво, графік та власна зарплата.", sortOrder: 70, grants: [
    grant(PERMISSIONS.OVERVIEW_READ,"LOCATION"), grant(PERMISSIONS.PLANNER_READ,"ASSIGNED"), grant(PERMISSIONS.DIAGNOSTICS_READ,"ASSIGNED"), grant(PERMISSIONS.DIAGNOSTICS_WRITE,"ASSIGNED"),
    grant(PERMISSIONS.WORK_ORDERS_READ,"ASSIGNED"), grant(PERMISSIONS.PRODUCTION_READ,"ASSIGNED"), grant(PERMISSIONS.PRODUCTION_WRITE,"ASSIGNED"),
    grant(PERMISSIONS.QC_READ,"ASSIGNED"), grant(PERMISSIONS.PARTS_READ,"ASSIGNED"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),
  ]},
  { code: "ACCOUNTANT", name: "Бухгалтер", description: "Фінанси, оплати, зарплата та фінансова аналітика по мережі.", sortOrder: 80, grants: [
    grant(PERMISSIONS.OVERVIEW_READ,"ALL"), grant(PERMISSIONS.WORK_ORDERS_READ,"ALL"), grant(PERMISSIONS.FINANCE_READ,"ALL"), grant(PERMISSIONS.FINANCE_WRITE,"ALL"),
    grant(PERMISSIONS.PAYMENTS_READ,"ALL"), grant(PERMISSIONS.PAYMENTS_WRITE,"ALL"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"), grant(PERMISSIONS.PAYROLL_ALL_READ,"ALL"),
    grant(PERMISSIONS.PAYROLL_WRITE,"ALL"), grant(PERMISSIONS.PAYROLL_CLOSE,"ALL"), grant(PERMISSIONS.PERSONNEL_READ,"ALL"), grant(PERMISSIONS.PERSONNEL_COMPENSATION_READ,"ALL"),
    grant(PERMISSIONS.ANALYTICS_READ,"ALL"), grant(PERMISSIONS.ANALYTICS_PERSONNEL_READ,"ALL"), grant(PERMISSIONS.ANALYTICS_FINANCIAL_READ,"ALL"), grant(PERMISSIONS.AUDIT_READ,"ALL"),
  ]},
  { code: "ADMINISTRATOR", name: "Адміністратор", description: "Операційна координація клієнтів і записів у межах станції.", sortOrder: 90, grants: [
    grant(PERMISSIONS.OVERVIEW_READ,"LOCATION"), grant(PERMISSIONS.COMMUNICATIONS_READ,"LOCATION"), grant(PERMISSIONS.COMMUNICATIONS_WRITE,"LOCATION"),
    grant(PERMISSIONS.LEADS_READ,"LOCATION"), grant(PERMISSIONS.LEADS_WRITE,"LOCATION"), grant(PERMISSIONS.CLIENTS_READ,"LOCATION"), grant(PERMISSIONS.CLIENTS_WRITE,"LOCATION"),
    grant(PERMISSIONS.PLANNER_READ,"LOCATION"), grant(PERMISSIONS.PLANNER_WRITE,"LOCATION"), grant(PERMISSIONS.DIAGNOSTICS_READ,"LOCATION"),
    grant(PERMISSIONS.WORK_ORDERS_READ,"LOCATION"), grant(PERMISSIONS.PARTS_READ,"LOCATION"), grant(PERMISSIONS.PROCUREMENT_READ,"LOCATION"), grant(PERMISSIONS.PAYROLL_SELF_READ,"SELF"),
    grant(PERMISSIONS.PERSONNEL_READ,"LOCATION"), grant(PERMISSIONS.WARRANTY_READ,"LOCATION"),
  ]},
];
