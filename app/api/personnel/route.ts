import { NextRequest, NextResponse } from "next/server";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { writeAuditEvent } from "@/src/services/audit.service";
import {
  deactivateEmployeePlannerResources,
  syncEmployeeOperationalContext,
} from "@/src/services/personnel-resource-sync.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hashPassword(value: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(value, salt, 64).toString("hex")}`;
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
    crmLogin: body.crmLogin ? String(body.crmLogin).trim() : null,
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

function safePersonnelRow(row: any, canSeeCompensation: boolean) {
  // Never serialize legacy credential material, even for OWNER.
  const { crmPasswordHash: _credential, ...safe } = row;
  if (canSeeCompensation) return { ...safe, compensationRestricted: false };
  return {
    ...safe,
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

function personnelWriteError(error: unknown, fallback: string) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (code === "PERSONNEL_LOCATION_REQUIRED") {
    return NextResponse.json({ ok: false, error: "Для автомеханіка потрібно вказати локацію СТО." }, { status: 400 });
  }
  if (code === "PERSONNEL_LOCATION_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: "Обрана локація СТО не знайдена або неактивна." }, { status: 400 });
  }
  if (code === "PERSONNEL_ROLE_NOT_FOUND") {
    return NextResponse.json({ ok: false, error: "Обрана операційна роль не знайдена або неактивна." }, { status: 400 });
  }
  console.error("personnel write failed", error);
  return NextResponse.json({ ok: false, error: fallback }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const readAccess = await authorize(PERMISSIONS.PERSONNEL_READ, { request });
  if (!readAccess.allowed) return readAccess.response!;
  const compensationAccess = await authorize(PERMISSIONS.PERSONNEL_COMPENSATION_READ, { request });
  const canSeeCompensation = compensationAccess.wouldAllow;

  const prisma = getPrisma();
  try {
    const now = new Date();
    const [items, roles, locations] = await Promise.all([
      prisma.employeeProfile.findMany({
        include: {
          documents: { orderBy: { name: "asc" } },
          roleAssignments: {
            where: {
              startsAt: { lte: now },
              OR: [{ endsAt: null }, { endsAt: { gt: now } }],
            },
            include: {
              role: { select: { code: true, name: true, category: true } },
              location: { select: { id: true, name: true } },
            },
            orderBy: [{ isPrimary: "desc" }, { startsAt: "desc" }],
          },
        },
        orderBy: [{ isActive: "desc" }, { lastName: "asc" }, { firstName: "asc" }],
      }),
      prisma.staffRole.findMany({
        where: { isActive: true },
        select: { code: true, name: true, category: true, economicsMode: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      prisma.serviceLocation.findMany({
        where: { isActive: true },
        select: { id: true, name: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
    ]);

    return NextResponse.json(
      {
        ok: true,
        items: items.map((item) => safePersonnelRow(item, canSeeCompensation)),
        meta: { roles, locations },
        security: {
          compensationRestricted: !canSeeCompensation,
          enforcementMode: readAccess.context.enforcementMode,
          shadowBypass: readAccess.shadowBypass,
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
  const access = await authorize(PERMISSIONS.PERSONNEL_WRITE, { request });
  if (!access.allowed) return access.response!;

  const prisma = getPrisma();
  try {
    const body = await request.json();
    const p = payload(body);
    if (!p.firstName || !p.lastName) {
      return NextResponse.json({ ok: false, error: "Вкажіть ім’я та прізвище." }, { status: 400 });
    }

    // Legacy compatibility only. Neon Auth is the canonical authentication source.
    const passwordHash = body.password ? hashPassword(String(body.password)) : null;
    const result = await prisma.$transaction(async (tx) => {
      const employee = await tx.employeeProfile.create({
        data: {
          id: randomUUID(),
          ...p,
          crmPasswordHash: passwordHash,
          documents: { create: documents(body) },
        },
        select: { id: true, userId: true, firstName: true, lastName: true, position: true, isActive: true },
      });
      const operational = await syncEmployeeOperationalContext(tx, {
        employeeId: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        position: employee.position,
        staffRoleCode: text(body.staffRoleCode),
        locationId: text(body.locationId),
        userId: employee.userId,
        isActive: employee.isActive,
      });
      return { employee, operational };
    });

    await writeAuditEvent({
      entityType: "EmployeeProfile",
      entityId: result.employee.id,
      action: "PERSONNEL_CREATED",
      after: result.operational,
    });

    return NextResponse.json({ ok: true, id: result.employee.id, operational: result.operational });
  } catch (error) {
    return personnelWriteError(error, "Не вдалося створити співробітника. Перевірте унікальність e-mail.");
  }
}

export async function PUT(request: NextRequest) {
  const access = await authorize(PERMISSIONS.PERSONNEL_WRITE, { request });
  if (!access.allowed) return access.response!;

  const prisma = getPrisma();
  try {
    const body = await request.json();
    const id = String(body.id || "");
    const p = payload(body);
    if (!id) return NextResponse.json({ ok: false, error: "Не вказано співробітника." }, { status: 400 });
    if (!p.firstName || !p.lastName) {
      return NextResponse.json({ ok: false, error: "Вкажіть ім’я та прізвище." }, { status: 400 });
    }

    const before = await prisma.employeeProfile.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ ok: false, error: "Співробітника не знайдено." }, { status: 404 });
    const passwordHash = body.password ? hashPassword(String(body.password)) : undefined;

    const result = await prisma.$transaction(async (tx) => {
      const employee = await tx.employeeProfile.update({
        where: { id },
        data: {
          ...p,
          ...(passwordHash ? { crmPasswordHash: passwordHash } : {}),
          documents: {
            deleteMany: {},
            create: documents(body),
          },
        },
        select: { id: true, userId: true, firstName: true, lastName: true, position: true, isActive: true },
      });
      const operational = await syncEmployeeOperationalContext(tx, {
        employeeId: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        position: employee.position,
        staffRoleCode: text(body.staffRoleCode),
        locationId: text(body.locationId),
        userId: employee.userId,
        isActive: employee.isActive,
      });
      return { employee, operational };
    });

    await writeAuditEvent({
      entityType: "EmployeeProfile",
      entityId: id,
      action: "PERSONNEL_UPDATED",
      metadata: { hadLegacyCredential: Boolean(before.crmPasswordHash), legacyCredentialChanged: Boolean(passwordHash) },
      after: result.operational,
    });

    return NextResponse.json({ ok: true, operational: result.operational });
  } catch (error) {
    return personnelWriteError(error, "Не вдалося оновити співробітника.");
  }
}

export async function DELETE(request: NextRequest) {
  const access = await authorize(PERMISSIONS.PERSONNEL_WRITE, { request });
  if (!access.allowed) return access.response!;

  const prisma = getPrisma();
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Не вказано співробітника." }, { status: 400 });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.employeeProfile.update({ where: { id }, data: { isActive: false } });
      await deactivateEmployeePlannerResources(tx, id);
    });
    await writeAuditEvent({ entityType: "EmployeeProfile", entityId: id, action: "PERSONNEL_DEACTIVATED" });
    return NextResponse.json({ ok: true, archived: true });
  } catch (error) {
    console.error("personnel DELETE failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося деактивувати співробітника." }, { status: 500 });
  }
}
