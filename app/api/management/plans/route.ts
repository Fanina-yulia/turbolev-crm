import { NextRequest, NextResponse } from "next/server";
import { getAccessContext } from "@/src/security/access-context";
import {
  ManagementResultError,
  acceptStationPlan,
  activateWeeklyPlan,
  listWeeklyManagementPlans,
  saveAndApproveOwnerWeeklyPlan,
  type ManagementActor,
} from "@/src/services/management-result.service";
import { saveDraftManagementPlan } from "@/src/services/management-plan-draft.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function activeRole(context: Awaited<ReturnType<typeof getAccessContext>>) {
  const codes = new Set(context.roles.map((role) => role.code));
  if (codes.has("OWNER")) return "OWNER";
  if (codes.has("EXECUTIVE_DIRECTOR")) return "EXECUTIVE_DIRECTOR";
  if (codes.has("STATION_MANAGER")) return "STATION_MANAGER";
  return null;
}

function authorize(context: Awaited<ReturnType<typeof getAccessContext>>) {
  if (context.provisioningState !== "ACTIVE" || !context.user) {
    return NextResponse.json({ ok: false, error: context.authenticated ? "Доступ до CRM не активований." : "Потрібна авторизація." }, { status: context.authenticated ? 403 : 401 });
  }
  if (!activeRole(context)) return NextResponse.json({ ok: false, error: "Кабінет управління результатом недоступний для цієї ролі." }, { status: 403 });
  return null;
}

function actor(context: Awaited<ReturnType<typeof getAccessContext>>, role: string): ManagementActor {
  return { id: context.user?.id ?? null, name: context.user?.name ?? null, role };
}

function failure(error: unknown) {
  if (error instanceof ManagementResultError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  console.error("management plans API failed", error);
  return NextResponse.json({ ok: false, error: "Не вдалося оновити управлінський план." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const context = await getAccessContext(request);
  const denied = authorize(context);
  if (denied) return denied;
  const role = activeRole(context)!;
  const anchor = request.nextUrl.searchParams.get("week");
  const locationIds = role === "STATION_MANAGER" ? context.locationIds : null;
  try {
    const payload = await listWeeklyManagementPlans({ anchor, locationIds });
    return NextResponse.json({ ...payload, permissions: { role, canEditTarget: role === "OWNER", canActivate: role === "OWNER" || role === "EXECUTIVE_DIRECTOR", canAccept: role === "STATION_MANAGER" } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  const context = await getAccessContext(request);
  const denied = authorize(context);
  if (denied) return denied;
  const role = activeRole(context)!;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Некоректний JSON." }, { status: 400 });
  const action = typeof body.action === "string" ? body.action : "SAVE_DRAFT";
  const common = {
    anchor: typeof body.week === "string" ? body.week : null,
    targetAmount: body.targetAmount,
    minimumAmount: body.minimumAmount,
    stretchAmount: body.stretchAmount,
    breakEvenAmount: body.breakEvenAmount,
    reason: typeof body.reason === "string" ? body.reason : null,
    actor: actor(context, role),
  };

  try {
    if (action === "SAVE_DRAFT") {
      return NextResponse.json(await saveDraftManagementPlan(common));
    }
    if (action === "SAVE_AND_APPROVE") {
      const payload = await saveAndApproveOwnerWeeklyPlan(common);
      return NextResponse.json({ ok: true, ...payload });
    }
    if (action === "ACTIVATE") {
      if (typeof body.planId !== "string" || !body.planId) return NextResponse.json({ ok: false, error: "planId обов'язковий." }, { status: 400 });
      const plan = await activateWeeklyPlan({ planId: body.planId, actor: actor(context, role) });
      return NextResponse.json({ ok: true, plan });
    }
    if (action === "ACCEPT") {
      if (typeof body.planId !== "string" || !body.planId) return NextResponse.json({ ok: false, error: "planId обов'язковий." }, { status: 400 });
      const result = await acceptStationPlan({ planId: body.planId, locationIds: context.locationIds, actor: actor(context, role) });
      return NextResponse.json(result);
    }
    return NextResponse.json({ ok: false, error: "Невідома дія." }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
