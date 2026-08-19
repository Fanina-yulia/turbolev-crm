import { DEFAULT_ACCESS_ROLES, type AccessRolePreset } from "@/src/security/access-matrix-catalog";
import { PERMISSIONS, type AccessScopeCode, type PermissionCode } from "@/src/security/permissions";

const grant = (code: PermissionCode, scope: AccessScopeCode) => ({ code, scope });

function patchRole(
  role: AccessRolePreset,
  input: { add?: Array<{ code: PermissionCode; scope: AccessScopeCode }>; remove?: PermissionCode[]; description?: string },
): AccessRolePreset {
  const removed = new Set(input.remove ?? []);
  const map = new Map(role.grants.filter((item) => !removed.has(item.code)).map((item) => [item.code, item]));
  for (const item of input.add ?? []) map.set(item.code, item);
  return { ...role, description: input.description ?? role.description, grants: [...map.values()] };
}

const SHIFT_MASTER: AccessRolePreset = {
  code: "SHIFT_MASTER",
  name: "Майстер зміни",
  description: "Контроль завершеного ремонту та якості по своїй станції. Не проводить оплату, не змінює кошторис і не адмініструє CRM.",
  sortOrder: 67,
  grants: [
    grant(PERMISSIONS.OVERVIEW_READ, "LOCATION"),
    grant(PERMISSIONS.CLIENTS_READ, "LOCATION"),
    grant(PERMISSIONS.PLANNER_READ, "LOCATION"),
    grant(PERMISSIONS.DIAGNOSTICS_READ, "LOCATION"),
    grant(PERMISSIONS.WORK_ORDERS_READ, "LOCATION"),
    grant(PERMISSIONS.PRODUCTION_READ, "LOCATION"),
    grant(PERMISSIONS.QC_READ, "LOCATION"),
    grant(PERMISSIONS.QC_WRITE, "LOCATION"),
    grant(PERMISSIONS.PARTS_READ, "LOCATION"),
    grant(PERMISSIONS.WARRANTY_READ, "LOCATION"),
    grant(PERMISSIONS.PAYROLL_SELF_READ, "SELF"),
  ],
};

export const TURBO_LEV_ACCESS_ROLES: AccessRolePreset[] = [
  ...DEFAULT_ACCESS_ROLES.map((role) => {
    if (role.code === "SERVICE_ADVISOR") {
      return patchRole(role, {
        description: "Власник сервісного процесу: оформлення, клієнтська комунікація, кошторис, погодження, підбір деталей, допродаж і контроль авто до видачі.",
        add: [
          grant(PERMISSIONS.PARTS_WRITE, "LOCATION"),
          grant(PERMISSIONS.PAYMENTS_READ, "LOCATION"),
        ],
        remove: [PERMISSIONS.QC_WRITE],
      });
    }
    if (role.code === "MECHANIC") {
      return patchRole(role, {
        description: "Призначені діагностики та ремонт: старт, пауза, продовження і завершення власних робіт. Контроль якості не проводить.",
        remove: [PERMISSIONS.QC_READ, PERMISSIONS.QC_WRITE],
      });
    }
    if (role.code === "STATION_MANAGER") {
      return patchRole(role, {
        description: "Керівник операцій станції: бачить весь цикл і QC, але сам не є виконавцем контролю якості за замовчуванням.",
        remove: [PERMISSIONS.QC_WRITE],
      });
    }
    if (role.code === "PARTS_SPECIALIST") {
      return { ...role, name: "Підборщик запчастин", description: "Підбір, закупівля, отримання та робота з постачальниками. Може бути призначений сервіс-менеджером на конкретне авто." };
    }
    if (role.code === "ACCOUNTANT") {
      return { ...role, description: "Каса, платежі, фінанси та зарплата. Проводить оплату, але не керує сервісним статусом автомобіля вручну." };
    }
    return role;
  }),
  SHIFT_MASTER,
].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "uk"));
