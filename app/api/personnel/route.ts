import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  configureEmployeeAccessTx,
  deactivateEmployeeAccess,
  personnelScopeWhere,
  PersonnelAccessError,
} from "@/src/services/personnel-access.service";
import { writeAuditEvent } from "@/src/services/audit.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;
type MechanicSummary = { id: string; name: string; locationId: string; isActive: boolean; userId: string | null };

function asRecord(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function n(value: unknown) {
  if (value === "" || value == null) return null;
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

function text(value: unknown) {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next || null;
}

function payload(body: JsonObject) {
  const email = text(body.email)?.toLowerCase() || null;
  const birthDateText = text(body.birthDate);
  const birthDate = birthDateText ? new Date(`${birthDateText}T00:00:00`) : null;
  if (birthDate && Number.isNaN(birthDate.getTime())) {
    throw new PersonnelAccessError("INVALID_BIRTH_DATE", "Вкажіть коректну дату народження.", 400);
  }
  const hireDateText = text(body.hireDate);
  const hireDate = hireDateText ? new Date(`${hireDateText}T00:00:00.000Z`) : null;
  if (hireDate && Number.isNaN(hireDate.getTime())) {
    throw new PersonnelAccessError("INVALID_HIRE_DATE", "Вкажіть коректну дату прийняття на роботу.", 400);
  }

  return {
    firstName: text(body.firstName) || "",
    lastName: text(body.lastName) || "",
    middleName: text(body.middleName),
    birthDate,
    hireDate,
    email,
    phone: text(body.phone),
    phoneCountry: text(body.phoneCountry) || "UA",
    address: text(body.address),
    photoUrl: text(body.photoUrl),
    personnelCategory: text(body.personnelCategory),
    position: text(body.position),
    crmLogin: email,
    isActive: body.isActive !== false,
    baseSalary: n(body.baseSalary),
    minimumSalary: n(body.minimumSalary),
    workPercent: n(body.workPercent),
    partsSalesPercent: n(body.partsSalesPercent),
    partsMarginPercent: n(body.partsMarginPercent),
    netProfitPercent: n(body.netProfitPercent),
    payrollRuleNote: text(body.payrollRuleNote),
  };
}

function documents(body: JsonObject) {
  const items = Array.isArray(body.documents) ? body.documents : [];
  return items.map((item) => {
    const document = asRecord(item) || {};
    const status = text(document.status) || "MISSING";
    return {
      id: text(document.id) || randomUUID(),
      type: text(document.type) || "OTHER",
      name: text(document.name) || "Документ",
      status,
      fileUrl: text(document.fileUrl),
      uploadedAt: status === "UPLOADED" ? new Date() : null,
    };
  });
}

function buildPersonnelInclude(now: Date) {
  return {
    documents: { orderBy: { name: "asc" as const } },
    roleAssignments: {
      where: {
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      include: {
        role: { select: { code: true, name: true, category: true } },
        location: { select: { id: true, name: true } },
      },
      orderBy: [{ isPrimary: "desc" as const }, { startsAt: "desc" as const }],
    },
    user: {
      select: {
        id: true,
        isActive: true,
        authUserId: true,
        lastLoginAt: true,
        accessRoles: {
          where: { isActive: true },
          include: {
            role: { select: { code: true, name: true } },
            location: { select: { id: true, name: true } },
          },
          orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }],
        },
      },
    },
  } satisfies Prisma.EmployeeProfileInclude;
}

type PersonnelRow = Prisma.EmployeeProfileGetPayload<{ include: ReturnType<typeof buildPersonnelInclude> }>;

function currentAssignment(assignments: PersonnelRow["roleAssignments"]) {
  return assignments.find((assignment) => assignment.isPrimary) || assignments[0] || null;
}

function canSeeCompensationFor(row: Pick<PersonnelRow, "id">, access: Awaited<ReturnType<typeof authorize>>) {
  if (!access.wouldAllow) return false;
  if (access.grantedScope === "ALL") return true;
  return access.context.user?.employeeId === row.id;
}

function safePersonnelRow(
  row: PersonnelRow,
  canSeeCompensation: boolean,
  mechanicByEmployeeId: Map<string, MechanicSummary>,
) {
  const { crmPasswordHash: _credential, user, ...safe } = row;
  const assignment = currentAssignment(row.roleAssignments);
  const primaryAccess = user?.accessRoles.find((item) => item.isPrimary && item.isActive)
    || user?.accessRoles.find((item) => item.isActive)
    || null;
  const mechanic = mechanicByEmployeeId.get(row.id) || null;
  const cabinetStatus = !user
    ? "NOT_OPENED"
    : !user.isActive
      ? "SUSPENDED"
      : user.authUserId
        ? "ACTIVE"
        : "WAITING_ACTIVATION";
  const base = {
    ...safe,
    access: {
      roleCode: assignment?.role?.code || primaryAccess?.role?.code || null,
      roleName: assignment?.role?.name || primaryAccess?.role?.name || null,
      location: assignment?.location || primaryAccess?.location || null,
      cabinetStatus,
      cabinetEnabled: Boolean(user?.isActive),
      userId: user?.id ?? null,
      authLinked: Boolean(user?.authUserId),
      lastLoginAt: user?.lastLoginAt ?? null,
      mechanicResource: mechanic,
    },
  };

  if (canSeeCompensation) return { ...base, compensationRestricted: false };
  return {
    ...base,
    baseSalary: null,
    minimumSalary: null,
    workPercent: null,
    partsSalesPercent: null,
    partsMarginPercent: null,
    netProfitPercent: null,
    payrollRuleNote: null,
    compensationRestricted: true,
  };
}

function personnelError(error: unknown, fallback: string) {
  if (error instanceof PersonnelAccessError) {
    return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
  }
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (code === "PERSONNEL_LOCATION_REQUIRED") {
    return NextResponse.json({ ok: false, error: code, message: "Для цієї посади потрібно вказати локацію СТО." }, { status: 400 });
  }
  if (code === "PERSONNEL_LOCATION_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: code, message: "Обрана локація СТО не знайдена або неактивна." }, { status: 400 });
  }
  if (code === "PERSONNEL_ROLE_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: code, message: "Обрана операційна роль не знайдена або неактивна." }, { status: 400 });
  }
  console.error(fallback, error);
  return NextResponse.json({ ok: false, error: fallback }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const readAccess = await authorize(PERMISSIONS.PERSONNEL_READ, { request, minimumScope: "SELF" });
  if (!readAccess.allowed) return readAccess.response!;
  const compensationAccess = await authorize(PERMISSIONS.PERSONNEL_COMPENSATION_READ, {
    request,
    minimumScope: "SELF",
  });

  const prisma = getPrisma();
  try {
    const now = new Date();
    const locationFilter = !readAccess.shadowBypass && readAccess.grantedScope === "LOCATION"
      ? { id: { in: readAccess.context.locationIds } }
      : {};
    const [items, roles, locations] = await Promise.all([
      prisma.employeeProfile.findMany({
        where: readAccess.shadowBypass ? {} : personnelScopeWhere(readAccess.context, readAccess.grantedScope),
        include: buildPersonnelInclude(now),
        orderBy: [{ isActive: "desc" }, { lastName: "asc" }, { firstName: "asc" }],
      }),
      prisma.staffRole.findMany({
        where: { isActive: true },
        select: { code: true, name: true, category: true, economicsMode: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      prisma.serviceLocation.findMany({
        where: { isActive: true, ...locationFilter },
        select: { id: true, name: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
    ]);

    const employeeIds = items.map((item) => item.id);
    const mechanics = employeeIds.length
      ? await prisma.serviceMechanic.findMany({
          where: { employeeId: { in: employeeIds } },
          select: { id: true, name: true, locationId: true, isActive: true, userId: true, employeeId: true },
        })
      : [];
    const mechanicByEmployeeId = new Map<string, MechanicSummary>(
      mechanics
        .filter((item) => item.employeeId)
        .map((item) => [
          item.employeeId!,
          { id: item.id, name: item.name, locationId: item.locationId, isActive: item.isActive, userId: item.userId },
        ]),
    );

    return NextResponse.json(
      {
        ok: true,
        items: items.map((item) => safePersonnelRow(item, canSeeCompensationFor(item, compensationAccess), mechanicByEmployeeId)),
        meta: { roles, locations },
        security: {
          compensationRestricted: !compensationAccess.wouldAllow,
          enforcementMode: readAccess.context.enforcementMode,
          shadowBypass: readAccess.shadowBypass,
          grantedScope: readAccess.grantedScope,
          managerRoles: readAccess.context.roles.map((role) => role.code),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("personnel GET failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити персонал." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const access = await authorize(PERMISSIONS.PERSONNEL_WRITE, {
    request,
    strict: true,
    minimumScope: "LOCATION",
  });
  if (!access.allowed) return access.response!;

  const prisma = getPrisma();
  try {
    const body = asRecord(await request.json().catch(() => null));
    if (!body) {
      return NextResponse.json({ ok: false, error: "INVALID_JSON_BODY", message: "Тіло запиту має бути JSON-об’єктом." }, { status: 400 });
    }
    const p = payload(body);
    const roleCode = text(body.staffRoleCode) || text(body.roleCode);
    if (!p.firstName || !p.lastName) {
      return NextResponse.json({ ok: false, error: "Вкажіть ім’я та прізвище." }, { status: 400 });
    }
    if (!roleCode) {
      return NextResponse.json({ ok: false, error: "ROLE_REQUIRED", message: "Оберіть системну посаду працівника." }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const employee = await tx.employeeProfile.create({
        data: {
          id: randomUUID(),
          ...p,
          crmPasswordHash: null,
          documents: { create: documents(body) },
        },
        select: { id: true },
      });
      const configured = await configureEmployeeAccessTx(tx, {
        employeeId: employee.id,
        roleCode,
        locationId: text(body.locationId),
        cabinetEnabled: body.cabinetEnabled === true,
        context: access.context,
        grantedScope: access.grantedScope,
      });
      return { employee, configured };
    });

    await writeAuditEvent({
      entityType: "EmployeeProfile",
      entityId: result.employee.id,
      action: "PERSONNEL_CREATED",
      after: {
        roleCode: result.configured.roleCode,
        locationId: result.configured.locationId,
        cabinetEnabled: Boolean(result.configured.user?.isActive),
      },
    });

    return NextResponse.json({
      ok: true,
      id: result.employee.id,
      access: {
        roleCode: result.configured.roleCode,
        locationId: result.configured.locationId,
        cabinetEnabled: Boolean(result.configured.user?.isActive),
        authLinked: Boolean(result.configured.user?.authUserId),
      },
    });
  } catch (error) {
    return personnelError(error, "PERSONNEL_CREATE_FAILED");
  }
}

export async function PUT(request: NextRequest) {
  const access = await authorize(PERMISSIONS.PERSONNEL_WRITE, {
    request,
    strict: true,
    minimumScope: "LOCATION",
  });
  if (!access.allowed) return access.response!;

  const prisma = getPrisma();
  try {
    const body = asRecord(await request.json().catch(() => null));
    if (!body) {
      return NextResponse.json({ ok: false, error: "INVALID_JSON_BODY", message: "Тіло запиту має бути JSON-об’єктом." }, { status: 400 });
    }
    const id = text(body.id) || "";
    const p = payload(body);
    const roleCode = text(body.staffRoleCode) || text(body.roleCode);
    if (!id) return NextResponse.json({ ok: false, error: "Не вказано співробітника." }, { status: 400 });
    if (!p.firstName || !p.lastName) {
      return NextResponse.json({ ok: false, error: "Вкажіть ім’я та прізвище." }, { status: 400 });
    }
    if (!roleCode) {
      return NextResponse.json({ ok: false, error: "ROLE_REQUIRED", message: "Оберіть системну посаду працівника." }, { status: 400 });
    }

    const before = await prisma.employeeProfile.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ ok: false, error: "Співробітника не знайдено." }, { status: 404 });

    const result = await prisma.$transaction(async (tx) => {
      await tx.employeeProfile.update({
        where: { id },
        data: {
          ...p,
          crmPasswordHash: null,
          documents: { deleteMany: {}, create: documents(body) },
        },
      });
      return configureEmployeeAccessTx(tx, {
        employeeId: id,
        roleCode,
        locationId: text(body.locationId),
        cabinetEnabled: body.cabinetEnabled === true,
        context: access.context,
        grantedScope: access.grantedScope,
      });
    });

    await writeAuditEvent({
      entityType: "EmployeeProfile",
      entityId: id,
      action: "PERSONNEL_UPDATED",
      before: { email: before.email, position: before.position, isActive: before.isActive },
      after: {
        email: p.email,
        roleCode: result.roleCode,
        locationId: result.locationId,
        cabinetEnabled: Boolean(result.user?.isActive),
      },
    });

    return NextResponse.json({
      ok: true,
      access: {
        roleCode: result.roleCode,
        locationId: result.locationId,
        cabinetEnabled: Boolean(result.user?.isActive),
        authLinked: Boolean(result.user?.authUserId),
      },
    });
  } catch (error) {
    return personnelError(error, "PERSONNEL_UPDATE_FAILED");
  }
}

export async function DELETE(request: NextRequest) {
  const access = await authorize(PERMISSIONS.PERSONNEL_WRITE, {
    request,
    strict: true,
    minimumScope: "LOCATION",
  });
  if (!access.allowed) return access.response!;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Не вказано співробітника." }, { status: 400 });

  try {
    await deactivateEmployeeAccess(id, access.context, access.grantedScope);
    return NextResponse.json({ ok: true, archived: true });
  } catch (error) {
    return personnelError(error, "PERSONNEL_DEACTIVATE_FAILED");
  }
}