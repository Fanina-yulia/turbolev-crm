import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { provisionAccessUser, SecurityAdminError } from "@/src/security/security-admin.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof SecurityAdminError) {
    return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
  }
  console.error("security provision failed", error instanceof Error ? error.message : "unknown error");
  return NextResponse.json({ ok: false, error: "SECURITY_PROVISION_FAILED" }, { status: 500 });
}

export async function POST(request: Request) {
  const access = await authorize(PERMISSIONS.SECURITY_ACCESS_MANAGE, { strict: true, request });
  if (!access.allowed) return access.response!;

  try {
    const body = await request.json();
    const user = await provisionAccessUser({
      email: String(body.email || ""),
      name: String(body.name || ""),
      employeeId: body.employeeId ? String(body.employeeId) : null,
      roles: Array.isArray(body.roles) ? body.roles : [],
    });
    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        authLinked: Boolean(user.authUserId),
        roles: user.accessRoles.map((assignment) => assignment.role.code),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
