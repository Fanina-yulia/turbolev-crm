import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { configureEmployeeAccess, PersonnelAccessError } from "@/src/services/personnel-access.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  const access = await authorize(PERMISSIONS.PERSONNEL_WRITE, { request, strict: true, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  try {
    const { id } = await context.params;
    const body = await request.json();
    const result = await configureEmployeeAccess({
      employeeId: id,
      roleCode: String(body.roleCode || ""),
      locationId: body.locationId ? String(body.locationId) : null,
      cabinetEnabled: body.cabinetEnabled !== false,
      mechanicResourceId: body.mechanicResourceId ? String(body.mechanicResourceId) : null,
      context: access.context,
      grantedScope: access.grantedScope,
    });
    return NextResponse.json({
      ok: true,
      access: {
        roleCode: result.staffRole.code,
        roleName: result.staffRole.name,
        location: result.location,
        cabinetEnabled: Boolean(result.user?.isActive),
        authLinked: Boolean(result.user?.authUserId),
        userId: result.user?.id ?? null,
        mechanicResourceId: result.mechanic?.id ?? null,
      },
    });
  } catch (error) {
    if (error instanceof PersonnelAccessError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    console.error("PUT /api/personnel/[id]/access", error);
    return NextResponse.json({ ok: false, error: "PERSONNEL_ACCESS_UPDATE_FAILED" }, { status: 500 });
  }
}
