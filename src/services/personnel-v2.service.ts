import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import type { AccessContext } from "@/src/security/access-context";
import { hashCrmPassword, normalizeCrmLogin, validCrmLogin } from "@/src/security/local-credentials";
import type { AccessScopeCode } from "@/src/security/permissions";
import {
  GLOBAL_PERSONNEL_ROLE_CODES,
  HR_MANAGER_DELEGATABLE_ROLE_CODES,
  PERSONNEL_ROLE_CODES,
  STATION_MANAGER_DELEGATABLE_ROLE_CODES,
  type PersonnelRoleCode,
} from "@/src/security/personnel-org-structure";
import { writeAuditEvent } from "@/src/services/audit.service";

export type PersonnelRoleInput = {
  roleCode: string;
  locationId?: string | null;
  isPrimary?: boolean;
};

type Tx = Prisma.TransactionClient;

type ProfileInput = {
  id?: string | null;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  birthDate?: string | null;
  hireDate?: string | null;
  employmentType?: string | null;
  email?: string | null;
  phone?: string | null;
  phoneCountry?: string | null;
  address?: string | null;
  photoUrl?: string | null;
  personnelCategory?: string | null;
  position?: string | null;
  crmLogin?: string | null;
  crmPassword?: string | null;
  isActive?: boolean;
  baseSalary?: string | number | null;
  minimumSalary?: string | number | null;
  workPercent?: string | number | null;
  partsSalesPercent?: string | number | null;
  partsMarginPercent?: string | number | null;
  netProfitPercent?: string | number | null;
  payrollRuleNote?: string | null;
  cabinetEnabled?: boolean;
  roles: PersonnelRoleInput[];
};

const SYSTEM_ROLES = PERSONNEL_ROLE_CODES;
type SystemRole = PersonnelRoleCode;
const GLOBAL_ROLES = GLOBAL_PERSONNEL_ROLE_CODES;
const STATION_DELEGATION = STATION_MANAGER_DELEGATABLE_ROLE_CODES;
const HR_DELEGATION = HR_MANAGER_DELEGATABLE_ROLE_CODES;
const EMPLOYMENT_TYPES = new Set(["STAFF", "CONTRACT", "FOP", "INTERNSHIP", "OTHER"]);

export class PersonnelV2Error extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "PersonnelV2Error";
    this.code = code;
    this.status = status;
  }
}

function clean(value: unknown, max = 500) {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next ? next.slice(0, max) : null;
}
function numberOrNull(value: unknown) {
  if (value === "" || value == null) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}
function roleSet(context: AccessContext) {
  return new Set(context.roles.map((role) => role.code));
}
function isSystemRole(value: string): value is SystemRole {
  return (SYSTEM_ROLES as readonly string[]).includes(value);
}
function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
export function delegatablePersonnelV2Roles(context: AccessContext): SystemRole[] {
  const roles = roleSet(context);
  if (roles.has("OWNER")) return [...SYSTEM_ROLES];
  if (roles.has("EXECUTIVE_DIRECTOR")) return SYSTEM_ROLES.filter((role) => role !== "OWNER");
  if (roles.has("HR_MANAGER")) return SYSTEM_ROLES.filter((role) => HR_DELEGATION.has(role));
  if (roles.has("STATION_MANAGER")) return SYSTEM_ROLES.filter((role) => STATION_DELEGATION.has(role));
  return [];
}
function hasGlobalAuthority(context: AccessContext, scope: AccessScopeCode | null) {
  const roles = roleSet(context);
  return scope === "ALL" && (roles.has("OWNER") || roles.has("EXECUTIVE_DIRECTOR") || roles.has("HR_MANAGER"));
}

function normalizeAssignments(items: PersonnelRoleInput[]) {
  const seen = new Set<string>();
  const result: Array<{ roleCode: SystemRole; locationId: string | null; isPrimary: boolean }> = [];
  for (const raw of items || []) {
    const roleCode = String(raw.roleCode || "").trim().toUpperCase();
    if (!isSystemRole(roleCode)) throw new PersonnelV2Error("UNKNOWN_ROLE", `Невідома посада ${roleCode || "—"}.`);
    const locationId = GLOBAL_ROLES.has(roleCode) ? null : clean(raw.locationId, 160);
    const key = `${roleCode}:${locationId || "GLOBAL"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ roleCode, locationId, isPrimary: Boolean(raw.isPrimary) });
  }
  if (!result.length) throw new PersonnelV2Error("ROLE_REQUIRED", "Призначте працівнику посаду.");
  const requestedPrimary = result.findIndex((role) => role.isPrimary);
  return result.map((role, index) => ({ ...role, isPrimary: index === (requestedPrimary >= 0 ? requestedPrimary : 0) }));
}

async function validateAssignments(
  tx: Tx,
  assignments: ReturnType<typeof normalizeAssignments>,
  context: AccessContext,
  scope: AccessScopeCode | null,
) {
  const allowed = new Set(delegatablePersonnelV2Roles(context));
  for (const assignment of assignments) {
    if (!allowed.has(assignment.roleCode)) {
      throw new PersonnelV2Error("ROLE_DELEGATION_FORBIDDEN", `Ваша посада не дозволяє призначати «${assignment.roleCode}».`, 403);
    }
    if (!GLOBAL_ROLES.has(assignment.roleCode) && !assignment.locationId) {
      throw new PersonnelV2Error("LOCATION_REQUIRED", `Для посади ${assignment.roleCode} потрібно обрати станцію.`);
    }
    if (assignment.locationId) {
      const location = await tx.serviceLocation.findFirst({ where: { id: assignment.locationId, isActive: true }, select: { id: true } });
      if (!location) throw new PersonnelV2Error("LOCATION_NOT_FOUND", "Обрану станцію не знайдено.", 404);
      if (!hasGlobalAuthority(context, scope) && !context.locationIds.includes(assignment.locationId)) {
        throw new PersonnelV2Error("LOCATION_FORBIDDEN", "Ви можете призначати посади лише в межах своєї станції.", 403);
      }
    }
  }
  const codes = assignments.map((item) => item.roleCode);
  const [staffRoles, accessRoles] = await Promise.all([
    tx.staffRole.findMany({ where: { code: { in: codes }, isActive: true }, select: { id: true, code: true, name: true, category: true } }),
    tx.accessRole.findMany({ where: { code: { in: codes }, isActive: true }, select: { id: true, code: true, name: true } }),
  ]);
  if (staffRoles.length !== new Set(codes).size || accessRoles.length !== new Set(codes).size) {
    throw new PersonnelV2Error("ROLE_NOT_CONFIGURED", "Одна з посад ще не синхронізована між Персоналом та системою доступу.", 409);
  }
  return {
    staffByCode: new Map(staffRoles.map((role) => [role.code, role])),
    accessByCode: new Map(accessRoles.map((role) => [role.code, role])),
  };
}

async function assertTargetScope(tx: Tx, employeeId: string, context: AccessContext, scope: AccessScopeCode | null) {
  if (hasGlobalAuthority(context, scope)) return;
  const now = new Date();
  const assignments = await tx.employeeRoleAssignment.findMany({
    where: { employeeId, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    select: { locationId: true },
  });
  if (!assignments.length) return;
  if (!assignments.some((item) => item.locationId && context.locationIds.includes(item.locationId))) {
    throw new PersonnelV2Error("EMPLOYEE_SCOPE_FORBIDDEN", "Цей працівник належить до іншої станції.", 403);
  }
}

async function assertOwnerSafety(tx: Tx, employeeId: string, nextAssignments: ReturnType<typeof normalizeAssignments>, cabinetEnabled: boolean) {
  const employee = await tx.employeeProfile.findUnique({ where: { id: employeeId }, select: { userId: true } });
  if (!employee?.userId) return;
  const ownerRole = await tx.accessRole.findUnique({ where: { code: "OWNER" }, select: { id: true } });
  if (!ownerRole) return;
  const isOwner = Boolean(await tx.userAccessRole.findFirst({ where: { userId: employee.userId, roleId: ownerRole.id, isActive: true }, select: { id: true } }));
  if (!isOwner) return;
  if (cabinetEnabled && nextAssignments.some((item) => item.roleCode === "OWNER")) return;
  const otherOwners = await tx.userAccessRole.count({
    where: { roleId: ownerRole.id, userId: { not: employee.userId }, isActive: true, user: { isActive: true } },
  });
  if (!otherOwners) throw new PersonnelV2Error("LAST_OWNER_PROTECTED", "Не можна забрати доступ у останнього активного Власника.", 409);
}

async function ensureUser(tx: Tx, employee: { id: string; userId: string | null; firstName: string; lastName: string; email: string | null }, enabled: boolean) {
  if (!enabled) {
    if (!employee.userId) return null;
    await tx.user.update({ where: { id: employee.userId }, data: { isActive: false } });
    await tx.userAccessRole.updateMany({ where: { userId: employee.userId, isActive: true }, data: { isActive: false, isPrimary: false, endsAt: new Date() } });
    return tx.user.findUnique({ where: { id: employee.userId } });
  }
  const email = String(employee.email || "").trim().toLowerCase() || null;
  const name = `${employee.firstName} ${employee.lastName}`.trim();
  let user = employee.userId ? await tx.user.findUnique({ where: { id: employee.userId }, include: { employeeProfile: true } }) : null;
  if (!user && email) user = await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, include: { employeeProfile: true } });
  if (user?.employeeProfile && user.employeeProfile.id !== employee.id) throw new PersonnelV2Error("EMAIL_ALREADY_USED", "Цей e-mail уже належить іншому працівнику.", 409);
  if (!user) user = await tx.user.create({ data: { name, email, isActive: true }, include: { employeeProfile: true } });
  else {
    user = await tx.user.update({
      where: { id: user.id },
      data: { name, email, isActive: true },
      include: { employeeProfile: true },
    });
  }
  if (employee.userId !== user.id) await tx.employeeProfile.update({ where: { id: employee.id }, data: { userId: user.id } });
  return user;
}

async function syncAssignments(
  tx: Tx,
  employee: { id: string; firstName: string; lastName: string; userId: string | null; isActive: boolean },
  assignments: ReturnType<typeof normalizeAssignments>,
  roleMaps: Awaited<ReturnType<typeof validateAssignments>>,
  userId: string | null,
  cabinetEnabled: boolean,
) {
  const now = new Date();
  await tx.employeeRoleAssignment.updateMany({
    where: { employeeId: employee.id, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    data: { endsAt: now, isPrimary: false },
  });
  for (const item of assignments) {
    const role = roleMaps.staffByCode.get(item.roleCode)!;
    await tx.employeeRoleAssignment.create({
      data: { employeeId: employee.id, roleId: role.id, locationId: item.locationId, startsAt: now, isPrimary: item.isPrimary },
    });
  }

  if (userId && cabinetEnabled) {
    await tx.userAccessRole.updateMany({ where: { userId, isActive: true }, data: { isActive: false, isPrimary: false, endsAt: now } });
    for (const item of assignments) {
      const accessRole = roleMaps.accessByCode.get(item.roleCode)!;
      const existing = await tx.userAccessRole.findFirst({
        where: { userId, roleId: accessRole.id, locationId: item.locationId },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        await tx.userAccessRole.update({
          where: { id: existing.id },
          data: { isActive: true, isPrimary: item.isPrimary, startsAt: now, endsAt: null, reason: "Personnel v2" },
        });
      } else {
        await tx.userAccessRole.create({
          data: { userId, roleId: accessRole.id, locationId: item.locationId, isPrimary: item.isPrimary, isActive: true, startsAt: now, reason: "Personnel v2" },
        });
      }
    }
  }

  const mechanicLocations = assignments.filter((item) => item.roleCode === "MECHANIC" && item.locationId).map((item) => item.locationId!);
  await tx.serviceMechanic.updateMany({
    where: { employeeId: employee.id, ...(mechanicLocations.length ? { locationId: { notIn: mechanicLocations } } : {}) },
    data: { isActive: false, userId: null },
  });
  const fullName = `${employee.firstName} ${employee.lastName}`.replace(/\s+/g, " ").trim();
  for (const locationId of mechanicLocations) {
    await tx.serviceMechanic.upsert({
      where: { locationId_employeeId: { locationId, employeeId: employee.id } },
      create: { locationId, employeeId: employee.id, userId: cabinetEnabled ? userId : null, name: fullName, isActive: employee.isActive, sortOrder: 100 },
      update: { userId: cabinetEnabled ? userId : null, name: fullName, isActive: employee.isActive },
    });
  }
}

export async function getPersonnelV2Catalog(context: AccessContext, scope: AccessScopeCode | null) {
  const prisma = getPrisma();
  const allowedCodes = delegatablePersonnelV2Roles(context);
  if (!allowedCodes.length) throw new PersonnelV2Error("PERSONNEL_DELEGATION_FORBIDDEN", "Для Вашої посади не дозволене керування працівниками.", 403);
  const locationIds = hasGlobalAuthority(context, scope) ? null : context.locationIds;
  const [staffRoles, accessRoles, locations] = await Promise.all([
    prisma.staffRole.findMany({ where: { code: { in: allowedCodes }, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.accessRole.findMany({ where: { code: { in: allowedCodes }, isActive: true }, select: { code: true, name: true, description: true } }),
    prisma.serviceLocation.findMany({ where: { isActive: true, ...(locationIds ? { id: { in: locationIds } } : {}) }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const accessByCode = new Map(accessRoles.map((role) => [role.code, role]));
  return {
    roles: staffRoles.filter((role) => accessByCode.has(role.code)).map((role) => ({
      code: role.code,
      name: role.name,
      category: role.category,
      economicsMode: role.economicsMode,
      requiresLocation: !GLOBAL_ROLES.has(role.code as SystemRole),
      description: accessByCode.get(role.code)?.description || null,
    })),
    locations,
  };
}

export async function savePersonnelV2(input: ProfileInput, context: AccessContext, scope: AccessScopeCode | null) {
  const prisma = getPrisma();
  const assignments = normalizeAssignments(input.roles);
  const firstName = clean(input.firstName, 120) || "";
  const lastName = clean(input.lastName, 120) || "";
  const middleName = clean(input.middleName, 120);
  const employmentType = clean(input.employmentType, 32)?.toUpperCase() || null;
  if (employmentType && !EMPLOYMENT_TYPES.has(employmentType)) throw new PersonnelV2Error("INVALID_EMPLOYMENT_TYPE", "Некоректний тип оформлення працівника.");
  if (!firstName || !lastName) throw new PersonnelV2Error("NAME_REQUIRED", "Вкажіть ім’я та прізвище.");
  const birthDateText = clean(input.birthDate, 10);
  const birthDate = birthDateText ? new Date(`${birthDateText}T00:00:00`) : null;
  if (birthDate && Number.isNaN(birthDate.getTime())) throw new PersonnelV2Error("INVALID_BIRTH_DATE", "Некоректна дата народження.");
  const hireDateText = clean(input.hireDate, 10);
  const hireDate = hireDateText ? new Date(`${hireDateText}T00:00:00.000Z`) : null;
  if (hireDate && Number.isNaN(hireDate.getTime())) throw new PersonnelV2Error("INVALID_HIRE_DATE", "Некоректна дата прийняття на роботу.");
  const primary = assignments.find((item) => item.isPrimary)!;
  const cabinetEnabled = input.cabinetEnabled === true;
  const isActive = input.isActive !== false;
  const email = clean(input.email, 240)?.toLowerCase() || null;
  if (email && !validEmail(email)) throw new PersonnelV2Error("INVALID_EMAIL", "Вкажіть коректний e-mail або залиште поле порожнім.");
  const crmLogin = normalizeCrmLogin(input.crmLogin);
  const crmPassword = typeof input.crmPassword === "string" ? input.crmPassword : "";
  if (cabinetEnabled && !validCrmLogin(crmLogin)) {
    throw new PersonnelV2Error("INVALID_CRM_LOGIN", "Логін має містити 3–64 символи: латинські літери, цифри, крапку, дефіс або підкреслення.");
  }
  if (crmPassword && crmPassword.length < 8) {
    throw new PersonnelV2Error("WEAK_CRM_PASSWORD", "Пароль має містити щонайменше 8 символів.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const roleMaps = await validateAssignments(tx, assignments, context, scope);
    if (input.id) await assertTargetScope(tx, input.id, context, scope);
    if (input.id) await assertOwnerSafety(tx, input.id, assignments, cabinetEnabled && isActive);
    const existingProfile = input.id
      ? await tx.employeeProfile.findUnique({ where: { id: input.id }, select: { crmPasswordHash: true } })
      : null;
    if (input.id && !existingProfile) throw new PersonnelV2Error("EMPLOYEE_NOT_FOUND", "Працівника не знайдено.", 404);

    if (crmLogin) {
      const duplicate = await tx.employeeProfile.findFirst({
        where: {
          crmLogin: { equals: crmLogin, mode: "insensitive" },
          ...(input.id ? { id: { not: input.id } } : {}),
        },
        select: { id: true },
      });
      if (duplicate) throw new PersonnelV2Error("CRM_LOGIN_ALREADY_USED", "Такий логін уже використовується іншим працівником.", 409);
    }

    const crmPasswordHash = crmPassword
      ? hashCrmPassword(crmPassword)
      : existingProfile?.crmPasswordHash || null;
    if (cabinetEnabled && !crmPasswordHash) {
      throw new PersonnelV2Error("CRM_PASSWORD_REQUIRED", "Для нового CRM-кабінету задайте пароль щонайменше з 8 символів.");
    }

    const primaryStaff = roleMaps.staffByCode.get(primary.roleCode)!;
    const data = {
      firstName,
      lastName,
      middleName,
      birthDate,
      hireDate,
      employmentType,
      email,
      phone: clean(input.phone, 80),
      phoneCountry: clean(input.phoneCountry, 8) || "UA",
      address: clean(input.address, 500),
      photoUrl: clean(input.photoUrl, 2000),
      personnelCategory: primaryStaff.category,
      position: primaryStaff.name,
      crmLogin: crmLogin || null,
      crmPasswordHash,
      isActive,
      baseSalary: numberOrNull(input.baseSalary),
      minimumSalary: numberOrNull(input.minimumSalary),
      workPercent: numberOrNull(input.workPercent),
      partsSalesPercent: numberOrNull(input.partsSalesPercent),
      partsMarginPercent: numberOrNull(input.partsMarginPercent),
      netProfitPercent: numberOrNull(input.netProfitPercent),
      payrollRuleNote: clean(input.payrollRuleNote, 4000),
    };
    const employee = input.id
      ? await tx.employeeProfile.update({ where: { id: input.id }, data })
      : await tx.employeeProfile.create({ data: { id: randomUUID(), ...data } });
    let user = await ensureUser(tx, employee, cabinetEnabled && isActive);
    const employeeWithUser = { ...employee, userId: user?.id || employee.userId };
    await syncAssignments(tx, employeeWithUser, assignments, roleMaps, user?.id || null, cabinetEnabled && isActive);
    if (!isActive) {
      await tx.serviceMechanic.updateMany({ where: { employeeId: employee.id }, data: { isActive: false, userId: null } });
      if (user?.id) user = await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
    }
    return { employee, user, assignments };
  });

  await writeAuditEvent({
    entityType: "EmployeeProfile",
    entityId: result.employee.id,
    action: input.id ? "PERSONNEL_V2_UPDATED" : "PERSONNEL_V2_CREATED",
    after: {
      roles: result.assignments,
      cabinetEnabled,
      active: isActive,
      employmentType,
      userId: result.user?.id || null,
      localLoginConfigured: Boolean(result.employee.crmLogin && result.employee.crmPasswordHash),
    },
  });
  return result;
}

export async function deactivatePersonnelV2(employeeId: string, context: AccessContext, scope: AccessScopeCode | null) {
  const prisma = getPrisma();
  const result = await prisma.$transaction(async (tx) => {
    await assertTargetScope(tx, employeeId, context, scope);
    const employee = await tx.employeeProfile.findUnique({ where: { id: employeeId } });
    if (!employee) throw new PersonnelV2Error("EMPLOYEE_NOT_FOUND", "Працівника не знайдено.", 404);
    await assertOwnerSafety(tx, employeeId, [], false);
    const now = new Date();
    await tx.employeeProfile.update({ where: { id: employeeId }, data: { isActive: false } });
    await tx.employeeRoleAssignment.updateMany({ where: { employeeId, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, data: { endsAt: now, isPrimary: false } });
    await tx.serviceMechanic.updateMany({ where: { employeeId }, data: { isActive: false, userId: null } });
    if (employee.userId) {
      await tx.user.update({ where: { id: employee.userId }, data: { isActive: false } });
      await tx.userAccessRole.updateMany({ where: { userId: employee.userId, isActive: true }, data: { isActive: false, isPrimary: false, endsAt: now } });
    }
    return employee;
  });
  await writeAuditEvent({ entityType: "EmployeeProfile", entityId: employeeId, action: "PERSONNEL_V2_DEACTIVATED", after: { isActive: false } });
  return result;
}
