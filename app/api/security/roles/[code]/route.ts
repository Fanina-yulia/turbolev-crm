import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";
import { SecurityAdminError } from "@/src/security/security-admin.service";
import { updateAccessRole } from "@/src/security/security-management.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ code: string }> };

function errorResponse(error: unknown) {
  if (error instanceof SecurityAdminError) {
    return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
  }
  console.error("security role update failed", error instanceof Error ? error.message : "unknown error");
  return NextResponse.json({ ok: false, error: "SECURITY_ROLE_UPDATE_FAILED" }, { status: 500 });
}

export async function PATCH(request: Request, context: Context) {
  const access = await authorize(PERMISSIONS.SECURITY_ACCESS_MANAGE, { strict: true, request });
  if (!access.allowed) return access.response!;

  try {
    const { code } = await context.params;
    const body = await request.json();
    const role = await updateAccessRole({
      roleCode: code,
      name: String(body.name || ""),
      description: body.description == null ? null : String(body.description),
      grants: Array.isArray(body.grants)
        ? body.grants.map((grant: { code?: unknown; scope?: unknown }) => ({
            code: String(grant?.code || ""),
            scope: String(grant?.scope || "ALL").toUpperCase() as AccessScopeCode,
          }))
        : [],
    });
    return NextResponse.json({
      ok: true,
      role: {
        code: role.code,
        name: role.name,
        description: role.description,
        permissions: role.permissions.map((grant) => ({ code: grant.permission.code, scope: grant.scope })),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
