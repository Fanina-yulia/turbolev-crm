import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { PersonnelV2Error, savePersonnelV2 } from "@/src/services/personnel-v2.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  const access = await authorize(PERMISSIONS.SECURITY_ACCESS_MANAGE, { request, strict: true });
  if (!access.allowed) return access.response!;
  try {
    const { id } = await context.params;
    const body = await request.json();
    const prisma = getPrisma();
    const employee = await prisma.employeeProfile.findUnique({
      where: { id },
      include: { user: { select: { id: true, isActive: true } } },
    });
    if (!employee) return NextResponse.json({ ok: false, error: "EMPLOYEE_NOT_FOUND" }, { status: 404 });
    const result = await savePersonnelV2({
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      birthDate: employee.birthDate ? employee.birthDate.toISOString().slice(0, 10) : null,
      email: employee.email,
      phone: employee.phone,
      phoneCountry: employee.phoneCountry,
      address: employee.address,
      photoUrl: employee.photoUrl,
      personnelCategory: employee.personnelCategory,
      position: employee.position,
      isActive: employee.isActive,
      baseSalary: employee.baseSalary?.toString() ?? null,
      minimumSalary: employee.minimumSalary?.toString() ?? null,
      workPercent: employee.workPercent?.toString() ?? null,
      partsSalesPercent: employee.partsSalesPercent?.toString() ?? null,
      partsMarginPercent: employee.partsMarginPercent?.toString() ?? null,
      netProfitPercent: employee.netProfitPercent?.toString() ?? null,
      payrollRuleNote: employee.payrollRuleNote,
      cabinetEnabled: employee.user?.isActive ?? false,
      roles: Array.isArray(body.roles) ? body.roles : [],
    }, access.context, access.grantedScope);
    return NextResponse.json({ ok: true, roles: result.assignments });
  } catch (error) {
    if (error instanceof PersonnelV2Error) return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    console.error("PUT /api/personnel/[id]/roles/v2", error);
    return NextResponse.json({ ok: false, error: "PERSONNEL_ROLE_SYNC_FAILED" }, { status: 500 });
  }
}
