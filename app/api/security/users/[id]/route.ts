import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { SecurityAdminError } from "@/src/security/security-admin.service";
import { setAccessUserActive, updateAccessUser } from "@/src/security/security-management.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

function errorResponse(error: unknown) {
  if (error instanceof SecurityAdminError) {
    return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
  }
  console.error("security user update failed", error instanceof Error ? error.message : "unknown error");
  return NextResponse.json({ ok: false, error: "SECURITY_USER_UPDATE_FAILED" }, { status: 500 });
}

export async function PATCH(request: Request, context: Context) {
  const access = await authorize(PERMISSIONS.SECURITY_ACCESS_MANAGE, { strict: true, request });
  if (!access.allowed) return access.response!;

  try {
    const { id } = await context.params;
    const body = await request.json();
    const user = await updateAccessUser({
      userId: id,
      name: String(body.name || ""),
      email: String(body.email || ""),
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
      employeeId: body.employeeId === undefined ? undefined : body.employeeId ? String(body.employeeId) : null,
    });
    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isActive: user.isActive,
        authLinked: Boolean(user.authUserId),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  const access = await authorize(PERMISSIONS.SECURITY_ACCESS_MANAGE, { strict: true, request });
  if (!access.allowed) return access.response!;

  try {
    const { id } = await context.params;
    const user = await setAccessUserActive(id, false);
    return NextResponse.json({ ok: true, user: { id: user.id, isActive: user.isActive } });
  } catch (error) {
    return errorResponse(error);
  }
}
