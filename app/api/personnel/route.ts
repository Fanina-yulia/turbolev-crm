import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  configureEmployeeAccess,
  deactivateEmployeeAccess,
  personnelScopeWhere,
  PersonnelAccessError,
} from "@/src/services/personnel-access.service";
import { writeAuditEvent } from "@/src/services/audit.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function n(value: unknown) {
  if (value === "" || value == null) return null;
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

function payload(body: any) {
  return {
    firstName: String(body.firstName || "").trim(),
    lastName: String(body.lastName || "").trim(),
    birthDate: body.birthDate ? new Date(`${body.birthDate}T00:00:00`) : null,
    email: body.email ? String(body.email).trim().toLowerCase() : null,
    phone: body.phone ? String(body.phone).trim() : null,
    phoneCountry: body.phoneCountry ? String(body.phoneCountry) : "UA",
    address: body.address ? String(body.address).trim() : null,
    photoUrl: body.photoUrl ? String(body.photoUrl) : null,
    personnelCategory: body.personnelCategory ? String(body.personnelCategory) : null,
    position: body.position ? String(body.position) : null,
    crmLogin: body.email ? String(body.email).trim().toLowerCase() : body.crmLogin ? String(body.crmLogin).trim() : null,
    isActive: body.isActive !== false,
    baseSalary: n(body.baseSalary),
    minimumSalary: n(body.minimumSalary),
    workPercent: n(body.workPercent),
    partsSalesPercent: n(body.partsSalesPercent),
    partsMarginPercent: n(body.partsMarginPercent),
    netProfitPercent: n(body.netProfitPercent),
    payrollRuleNote: body.payrollRuleNote ? String(body.payrollRuleNote) : null,
  };
}

function documents(body: any) {
  return (Array.isArray(body.documents) ? body.documents : []).map((d: any) => ({
    id: d.id ? String(d.id) : randomUUID(),
    type: String(d.type || "OTHER"),
    name: String(d.name || "Документ"),
    status: String(d.status || "MISSING"),
    fileUrl: d.fileUrl ? String(d.fileUrl) : null,
    uploadedAt: d.status === "UPLOADED" ? new Date() : null,
  }));
}

function currentAssignment(assignments: any[]) {
  const now = Date.now();
  return assignments.find((assignment) =>
    assignment.isPrimary &&
    new Date(assignment.startsAt).getTime() <= now &&
    (!assignment.endsAt || new Date(assignment.endsAt).getTime() > now),
  ) || null;
}

function canSeeCompensationFor(row: any, compensationAccess: Awaited<ReturnType<typeof authorize>>) {
  if (!compensationAccess.wouldAllow) return false;
  if (compensationAccess.grantedScope === "ALL") return true;
  return compensationAccess.context.user?.employeeId === row.id;
}

function safePersonnelRow(row: any, canSeeCompensation: boolean, mechanicByUserId: Map<string, { id: string; name: string; locationId: string; isActive: boolean }>) {
  const { crmPasswordHash: _credential, ...safe } = row;
  const assignment = currentAssignment(row.roleAssignments || []);
  const user = row.user || null;
  const primaryAccess = user?.accessRoles?.find((item: any) => item.isPrimary && item.isActive) || user?.accessRoles?.find((item: any) => item.isActive) || null;
  const roleCode = assignment?.role?.code || primaryAccess?.role?.code || null;
  const roleName = assignment?.role?.name || primaryAccess?.role?.name || null;
  const location = assignment?.location || primaryAccess?.location || null;
  const mechanic = user?.id ? mechanicByUserId.get(user.id) || null : null;
  const cabinetStatus = !user ? "NOT_OPENED" : !user.isActive ? "SUSPENDED" : user.authUserId ? "ACTIVE" : "WAITING_ACTIVATION";
  const base = {
    ...safe,
    roleAssignments: undefined,
    user: undefined,
    access: {
      roleCode,
      roleName,
      location,
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
  console.error(fallback, error);
  return NextResponse.json({ ok: false, error: fallback }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const readAccess = await authorize(PERMISSIONS.PERSONNEL_READ, { request, minimumScope: "SELF" });
  if (!readAccess.allowed) return readAccess.response!;
  const compensationAccess = await authorize(PERMISSIONS.PERSONNEL_COMPENSATION_READ, { request, minimumScope: "SELF" });

  const prisma = getPrisma();
  try {
    const items = await prisma.employeeProfile.findMany({
      where: readAccess.shadowBypass ? {} : personnelScopeWhere(readAccess.context, readAccess.grantedScope),
      include: {
        documents: { orderBy: { name: "asc" } },
        roleAssignments: {
          include: { role: { select: { code: true, name: true } }, location: { select: { id: true, name: true } } },
          orderBy: { startsAt: "desc" },
        },
        user: {
          select: {
            id: true,
            isActive: true,
            authUserId: true,
            lastLoginAt: true,
            accessRoles: {
              where: { isActive: true },
              include: { role: { select: { code: true, name: true } }, location: { select: { id: true, name: true } } },
              orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            },
          },
        },
      },
      orderBy: [{ isActive: "desc" }, { lastName: "asc" }, { firstName: "asc" }],
    });
    const userIds = items.map((item) => item.user?.id).filter((value): value is string => Boolean(value));
    const mechanics = userIds.length ? await prisma.serviceMechanic.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, name: true, locationId: true, isActive: true, userId: true },
    }) : [];
    const mechanicByUserId = new Map(mechanics.filter((item) => item.userId).map((item) => [item.userId!, { id: item.id, name: item.name, locationId: item.locationId, isActive: item.isActive }]));
    return NextResponse.json(
      {
        ok: true,
        items: items.map((item) => safePersonnelRow(item, canSeeCompensationFor(item, compensationAccess), mechanicByUserId)),
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
    return NextResponse.json({ ok: false, error: "Розділ персоналу очікує активації HR-схеми." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const access = await authorize(PERMISSIONS.PERSONNEL_WRITE, { request, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;

  const prisma = getPrisma();
  let createdId: string | null = null;
  try {
    const body = await request.json();
    const p = payload(body);
    if (!p.firstName || !p.lastName) return NextResponse.json({ ok: false, error: "Вкажіть ім’я та прізвище." }, { status: 400 });
    if (!access.shadowBypass && access.grantedScope === "LOCATION" && (!body.roleCode || !body.locationId)) {
      return NextResponse.json({ ok: false, error: "ROLE_AND_LOCATION_REQUIRED", message: "Оберіть посаду та станцію." }, { status: 400 });
    }

    const created = await prisma.employeeProfile.create({
      data: { id: randomUUID(), ...p, crmPasswordHash: null, documents: { create: documents(body) } },
      select: { id: true },
    });
    createdId = created.id;

    if (!access.shadowBypass && body.roleCode) {
      await configureEmployeeAccess({
        employeeId: created.id,
        roleCode: String(body.roleCode),
        locationId: body.locationId ? String(body.locationId) : null,
        cabinetEnabled: body.cabinetEnabled === true,
        mechanicResourceId: body.mechanicResourceId ? String(body.mechanicResourceId) : null,
        context: access.context,
        grantedScope: access.grantedScope,
      });
    }
    await writeAuditEvent({ entityType: "EmployeeProfile", entityId: created.id, action: "PERSONNEL_CREATED" });
    return NextResponse.json({ ok: true, id: created.id });
  } catch (error) {
    if (createdId) await prisma.employeeProfile.delete({ where: { id: createdId } }).catch(() => undefined);
    if (error instanceof PersonnelAccessError) return personnelError(error, "PERSONNEL_CREATE_FAILED");
    console.error("personnel POST failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося створити співробітника. Перевірте унікальність e-mail." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const access = await authorize(PERMISSIONS.PERSONNEL_WRITE, { request, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;

  const prisma = getPrisma();
  try {
    const body = await request.json();
    const id = String(body.id || "");
    const p = payload(body);
    if (!id) return NextResponse.json({ ok: false, error: "Не вказано співробітника." }, { status: 400 });
    if (!access.shadowBypass && access.grantedScope !== "ALL") {
      const manageable = await prisma.employeeProfile.findFirst({ where: { id, ...personnelScopeWhere(access.context, access.grantedScope) }, select: { id: true } });
      if (!manageable) return NextResponse.json({ ok: false, error: "EMPLOYEE_SCOPE_FORBIDDEN" }, { status: 403 });
    }

    await prisma.employeeProfile.update({
      where: { id },
      data: { ...p, documents: { deleteMany: {}, create: documents(body) } },
    });
    if (!access.shadowBypass && body.roleCode) {
      await configureEmployeeAccess({
        employeeId: id,
        roleCode: String(body.roleCode),
        locationId: body.locationId ? String(body.locationId) : null,
        cabinetEnabled: body.cabinetEnabled === true,
        mechanicResourceId: body.mechanicResourceId ? String(body.mechanicResourceId) : null,
        context: access.context,
        grantedScope: access.grantedScope,
      });
    }
    await writeAuditEvent({ entityType: "EmployeeProfile", entityId: id, action: "PERSONNEL_UPDATED" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PersonnelAccessError) return personnelError(error, "PERSONNEL_UPDATE_FAILED");
    console.error("personnel PUT failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося оновити співробітника." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const access = await authorize(PERMISSIONS.PERSONNEL_WRITE, { request, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Не вказано співробітника." }, { status: 400 });

  try {
    if (access.shadowBypass) {
      await getPrisma().employeeProfile.update({ where: { id }, data: { isActive: false } });
      await writeAuditEvent({ entityType: "EmployeeProfile", entityId: id, action: "PERSONNEL_DEACTIVATED" });
    } else {
      await deactivateEmployeeAccess(id, access.context, access.grantedScope);
    }
    return NextResponse.json({ ok: true, archived: true });
  } catch (error) {
    if (error instanceof PersonnelAccessError) return personnelError(error, "PERSONNEL_DEACTIVATE_FAILED");
    console.error("personnel DELETE failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося деактивувати співробітника." }, { status: 500 });
  }
}
