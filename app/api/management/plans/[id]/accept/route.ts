import { NextResponse } from "next/server";
import { getAccessContext } from "@/src/security/access-context";
import { activeManagementContext, managementActor } from "@/src/security/management-access";
import { acceptStationPlan, ManagementResultError } from "@/src/services/management-result.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await getAccessContext(request);
  const actor = managementActor(access);
  if (!activeManagementContext(access) || !actor) return NextResponse.json({ ok: false, error: access.authenticated ? "Немає доступу." : "Потрібна авторизація." }, { status: access.authenticated ? 403 : 401 });
  const { id } = await context.params;
  try {
    const result = await acceptStationPlan({ planId: id, locationIds: access.locationIds, actor });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ManagementResultError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
    console.error("management station acceptance failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося прийняти план станції." }, { status: 500 });
  }
}
