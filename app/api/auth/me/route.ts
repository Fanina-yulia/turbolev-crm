import { NextResponse } from "next/server";
import { getAccessContext } from "@/src/security/access-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await getAccessContext(request);
  return NextResponse.json(
    {
      ok: true,
      authConfigured: context.authConfigured,
      authenticated: context.authenticated,
      provisioningState: context.provisioningState,
      enforcementMode: context.enforcementMode,
      user: context.user
        ? {
            id: context.user.id,
            name: context.user.employeeName || context.user.name,
            employeeId: context.user.employeeId,
          }
        : null,
      roles: context.roles,
      permissions: context.permissions,
      locations: context.locationIds,
      viewAs: context.viewAs,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
