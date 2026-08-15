import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { replaceUserAccessRoles, SecurityAdminError } from "@/src/security/security-admin.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function errorResponse(error: unknown) {
  if (error instanceof SecurityAdminError) {
    return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
  }
  console.error("security roles update failed", error instanceof Error ? error.message : "unknown error");
  return NextResponse.json({ ok: false, error: "SECURITY_ROLES_UPDATE_FAILED" }, { status: 500 });
}

export async function PUT(request: Request, context: Context) {
  const access = await authorize(PERMISSIONS.SECURITY_ACCESS_MANAGE, { strict: true, request });
  if (!access.allowed) return access.response!;

  try {
    const { id } = await context.params;
    const body = await request.json();
    const user = await replaceUserAccessRoles({
      userId: id,
      roles: Array.isArray(body.roles) ? body.roles : [],
    });
    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        roles: user.accessRoles.map((assignment) => assignment.role.code),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
