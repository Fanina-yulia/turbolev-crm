/**
 * Canonical role codes shared by RBAC, workflow presentation and cabinet routing.
 *
 * Display names may change with the personnel module, but authorization and
 * routing always use these stable codes. Legacy values are accepted only at
 * the compatibility boundary and normalized immediately.
 */

export const CANONICAL_ROLE_CODES = [
  "OWNER",
  "EXECUTIVE_DIRECTOR",
  "STATION_MANAGER",
  "SERVICE_ADVISOR",
  "MECHANIC",
  "PARTS_SPECIALIST",
  "WAREHOUSE_KEEPER",
  "HEAD_OF_SALES",
  "SALES",
  "ACCOUNTANT",
  "MARKETING_DIRECTOR",
  "MARKETER",
  "HR_MANAGER",
  "ADMINISTRATOR",
  "CRM_ADMIN",
] as const;

export type CanonicalRoleCode = (typeof CANONICAL_ROLE_CODES)[number];

export const LEGACY_ROLE_CODES = [
  "SERVICE_MANAGER",
  "PARTS_MANAGER",
  "QUALITY_CONTROLLER",
  "CASHIER_ACCOUNTING",
  "ADMIN",
  "SHIFT_MASTER",
] as const;

export type LegacyRoleCode = (typeof LEGACY_ROLE_CODES)[number];
export type RoleCode = CanonicalRoleCode | LegacyRoleCode;

export const ROLE_LABELS: Readonly<Record<RoleCode, string>> = {
  OWNER: "Власник",
  EXECUTIVE_DIRECTOR: "Виконавчий директор",
  STATION_MANAGER: "Керівник станції",
  SERVICE_ADVISOR: "Сервіс-менеджер",
  MECHANIC: "Механік",
  PARTS_SPECIALIST: "Менеджер з запчастин",
  WAREHOUSE_KEEPER: "Комірник",
  HEAD_OF_SALES: "Керівник відділу продажів",
  SALES: "Менеджер з продажу",
  ACCOUNTANT: "Бухгалтер",
  MARKETING_DIRECTOR: "Директор з маркетингу",
  MARKETER: "Маркетолог",
  HR_MANAGER: "HR-менеджер",
  ADMINISTRATOR: "Адміністратор",
  CRM_ADMIN: "CRM-адміністратор",
  SERVICE_MANAGER: "Сервіс-менеджмент (legacy)",
  PARTS_MANAGER: "Запчастини (legacy)",
  QUALITY_CONTROLLER: "Контроль якості (legacy)",
  CASHIER_ACCOUNTING: "Каса / бухгалтерія (legacy)",
  ADMIN: "Адміністратор CRM (legacy)",
  SHIFT_MASTER: "Майстер зміни (legacy)",
};

export const LEGACY_ROLE_ALIASES: Readonly<Record<LegacyRoleCode, CanonicalRoleCode>> = {
  SERVICE_MANAGER: "SERVICE_ADVISOR",
  PARTS_MANAGER: "PARTS_SPECIALIST",
  QUALITY_CONTROLLER: "STATION_MANAGER",
  CASHIER_ACCOUNTING: "ACCOUNTANT",
  ADMIN: "ADMINISTRATOR",
  SHIFT_MASTER: "MECHANIC",
};

export type RoleCabinetCode =
  | "OWNER"
  | "SERVICE_ADVISOR"
  | "PARTS"
  | "STATION_MANAGER"
  | "MECHANIC"
  | "SALES"
  | "STATION_OVERVIEW";

export const ROLE_CABINET_BY_CODE: Readonly<Record<CanonicalRoleCode, RoleCabinetCode>> = {
  OWNER: "OWNER",
  EXECUTIVE_DIRECTOR: "OWNER",
  STATION_MANAGER: "STATION_MANAGER",
  SERVICE_ADVISOR: "SERVICE_ADVISOR",
  MECHANIC: "MECHANIC",
  PARTS_SPECIALIST: "PARTS",
  WAREHOUSE_KEEPER: "PARTS",
  HEAD_OF_SALES: "SALES",
  SALES: "SALES",
  ACCOUNTANT: "STATION_OVERVIEW",
  MARKETING_DIRECTOR: "STATION_OVERVIEW",
  MARKETER: "STATION_OVERVIEW",
  HR_MANAGER: "STATION_OVERVIEW",
  ADMINISTRATOR: "STATION_OVERVIEW",
  CRM_ADMIN: "STATION_OVERVIEW",
};

export function isCanonicalRoleCode(value: unknown): value is CanonicalRoleCode {
  return typeof value === "string"
    && (CANONICAL_ROLE_CODES as readonly string[]).includes(value);
}

export function normalizeRoleCode(value: unknown): CanonicalRoleCode | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  if (isCanonicalRoleCode(code)) return code;
  if ((LEGACY_ROLE_CODES as readonly string[]).includes(code)) {
    return LEGACY_ROLE_ALIASES[code as LegacyRoleCode];
  }
  return null;
}

export function resolveRoleCabinet(
  roles: ReadonlyArray<{ code: string; isPrimary?: boolean }>,
): RoleCabinetCode {
  const normalized = roles
    .map((role) => ({ ...role, code: normalizeRoleCode(role.code) }))
    .filter((role): role is { code: CanonicalRoleCode; isPrimary?: boolean } => Boolean(role.code));

  if (normalized.some((role) => ROLE_CABINET_BY_CODE[role.code] === "OWNER")) return "OWNER";

  const primary = normalized.find((role) => role.isPrimary);
  if (primary) return ROLE_CABINET_BY_CODE[primary.code];

  return normalized[0] ? ROLE_CABINET_BY_CODE[normalized[0].code] : "STATION_OVERVIEW";
}
