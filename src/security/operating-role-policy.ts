import { DEFAULT_ACCESS_ROLES, type AccessRolePreset } from "@/src/security/access-matrix-catalog";
import { PERMISSIONS, type AccessScopeCode, type PermissionCode } from "@/src/security/permissions";

const grant = (code: PermissionCode, scope: AccessScopeCode) => ({ code, scope });

function patchRole(
  role: AccessRolePreset,
  input: {
    add?: Array<{ code: PermissionCode; scope: AccessScopeCode }>;
    remove?: PermissionCode[];
    name?: string;
    description?: string;
    sortOrder?: number;
  },
): AccessRolePreset {
  const removed = new Set(input.remove ?? []);
  const map = new Map(role.grants.filter((item) => !removed.has(item.code)).map((item) => [item.code, item]));
  for (const item of input.add ?? []) map.set(item.code, item);
  return {
    ...role,
    name: input.name ?? role.name,
    description: input.description ?? role.description,
    sortOrder: input.sortOrder ?? role.sortOrder,
    grants: [...map.values()],
  };
}

const NEW_ROLES: AccessRolePreset[] = [
  {
    code: "WAREHOUSE_KEEPER",
    name: "Комірник",
    description: "Приймання, резервування, зберігання та видача запчастин у межах своєї станції.",
    sortOrder: 70,
    grants: [
      grant(PERMISSIONS.OVERVIEW_READ, "LOCATION"),
      grant(PERMISSIONS.WORK_ORDERS_READ, "LOCATION"),
      grant(PERMISSIONS.PARTS_READ, "LOCATION"),
      grant(PERMISSIONS.PARTS_WRITE, "LOCATION"),
      grant(PERMISSIONS.PROCUREMENT_READ, "LOCATION"),
      grant(PERMISSIONS.PROCUREMENT_WRITE, "LOCATION"),
      grant(PERMISSIONS.PAYROLL_SELF_READ, "SELF"),
    ],
  },
  {
    code: "MARKETING_DIRECTOR",
    name: "Директор з маркетингу",
    description: "Керує маркетингом мережі, бачить комунікації, ліди та операційну аналітику без фінансового адміністрування.",
    sortOrder: 110,
    grants: [
      grant(PERMISSIONS.OVERVIEW_READ, "ALL"),
      grant(PERMISSIONS.COMMUNICATIONS_READ, "ALL"),
      grant(PERMISSIONS.LEADS_READ, "ALL"),
      grant(PERMISSIONS.CLIENTS_READ, "ALL"),
      grant(PERMISSIONS.ANALYTICS_READ, "ALL"),
      grant(PERMISSIONS.PAYROLL_SELF_READ, "SELF"),
    ],
  },
  {
    code: "MARKETER",
    name: "Маркетолог",
    description: "Маркетингові комунікації, ліди та аналітика мережі без доступу до фінансів і системного адміністрування.",
    sortOrder: 120,
    grants: [
      grant(PERMISSIONS.OVERVIEW_READ, "ALL"),
      grant(PERMISSIONS.COMMUNICATIONS_READ, "ALL"),
      grant(PERMISSIONS.LEADS_READ, "ALL"),
      grant(PERMISSIONS.CLIENTS_READ, "ALL"),
      grant(PERMISSIONS.ANALYTICS_READ, "ALL"),
      grant(PERMISSIONS.PAYROLL_SELF_READ, "SELF"),
    ],
  },
  {
    code: "HR_MANAGER",
    name: "HR-менеджер",
    description: "Кадровий контур мережі: персонал та кадрова аналітика без доступу до фінансів і ставок працівників.",
    sortOrder: 130,
    grants: [
      grant(PERMISSIONS.OVERVIEW_READ, "ALL"),
      grant(PERMISSIONS.PERSONNEL_READ, "ALL"),
      grant(PERMISSIONS.PERSONNEL_WRITE, "ALL"),
      grant(PERMISSIONS.ANALYTICS_PERSONNEL_READ, "ALL"),
      grant(PERMISSIONS.PAYROLL_SELF_READ, "SELF"),
    ],
  },
  {
    code: "CRM_ADMIN",
    name: "CRM-адміністратор",
    description: "Технічне адміністрування CRM, інтеграцій, ролей і аудиту без доступу до фінансових даних бізнесу.",
    sortOrder: 150,
    grants: [
      grant(PERMISSIONS.OVERVIEW_READ, "ALL"),
      grant(PERMISSIONS.SETTINGS_READ, "ALL"),
      grant(PERMISSIONS.SETTINGS_WRITE, "ALL"),
      grant(PERMISSIONS.SETTINGS_INTEGRATIONS, "ALL"),
      grant(PERMISSIONS.AUDIT_READ, "ALL"),
      grant(PERMISSIONS.SECURITY_ACCESS_MANAGE, "ALL"),
      grant(PERMISSIONS.PAYROLL_SELF_READ, "SELF"),
    ],
  },
];

export const TURBO_LEV_ACCESS_ROLES: AccessRolePreset[] = [
  ...DEFAULT_ACCESS_ROLES.map((role) => {
    if (role.code === "OWNER") return patchRole(role, { sortOrder: 10 });
    if (role.code === "EXECUTIVE_DIRECTOR") return patchRole(role, { sortOrder: 20 });
    if (role.code === "STATION_MANAGER") {
      return patchRole(role, {
        name: "Керівник станції",
        sortOrder: 30,
        description: "Керує операційною роботою конкретної станції, персоналом станції та контролем якості без глобальної фінансової адміністрації.",
        add: [grant(PERMISSIONS.QC_WRITE, "LOCATION")],
      });
    }
    if (role.code === "SERVICE_ADVISOR") {
      return patchRole(role, {
        name: "Сервіс-менеджер",
        sortOrder: 40,
        description: "Власник сервісного процесу: приймання, клієнтська комунікація, кошторис, погодження, підбір деталей і супровід авто до видачі.",
        add: [
          grant(PERMISSIONS.PARTS_WRITE, "LOCATION"),
          grant(PERMISSIONS.PROCUREMENT_WRITE, "LOCATION"),
          grant(PERMISSIONS.PAYMENTS_READ, "LOCATION"),
        ],
        remove: [PERMISSIONS.QC_WRITE],
      });
    }
    if (role.code === "MECHANIC") {
      return patchRole(role, {
        name: "Механік",
        sortOrder: 50,
        description: "Єдина посада для всіх механічних спеціалізацій: призначені діагностики та ремонт, старт, пауза, продовження і завершення власних робіт.",
        remove: [PERMISSIONS.QC_READ, PERMISSIONS.QC_WRITE],
      });
    }
    if (role.code === "PARTS_SPECIALIST") {
      return patchRole(role, {
        name: "Менеджер з запчастин",
        sortOrder: 60,
        description: "Підбір, закупівля, отримання та робота з постачальниками в межах сервісного процесу.",
      });
    }
    if (role.code === "HEAD_OF_SALES") {
      return patchRole(role, {
        name: "Керівник відділу продажів",
        sortOrder: 80,
        description: "Керує воронкою продажів і командою. Фінальний кошторис Замовлення-наряду формує сервіс-менеджер.",
        remove: [PERMISSIONS.WORK_ORDERS_ESTIMATE],
      });
    }
    if (role.code === "SALES") {
      return patchRole(role, {
        name: "Менеджер з продажу",
        sortOrder: 90,
        description: "Працює зі зверненнями, лідами, клієнтами та записом. Фінальний кошторис формує сервіс-менеджер.",
        remove: [PERMISSIONS.WORK_ORDERS_ESTIMATE],
      });
    }
    if (role.code === "ACCOUNTANT") {
      return patchRole(role, {
        name: "Бухгалтер",
        sortOrder: 100,
        description: "Каса, платежі, фінанси та зарплата. Проводить оплату, але не керує сервісним статусом автомобіля вручну.",
      });
    }
    if (role.code === "ADMINISTRATOR") {
      return patchRole(role, { name: "Адміністратор", sortOrder: 140 });
    }
    return role;
  }),
  ...NEW_ROLES,
]
  .filter((role) => role.code !== "SHIFT_MASTER")
  .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "uk"));
