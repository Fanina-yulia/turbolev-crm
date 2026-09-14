import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext } from "@/src/security/access-context";
import { activeManagementContext, managementActor, managementRole } from "@/src/security/management-access";
import { ManagementResultError } from "@/src/services/management-result.service";
import { redistributeStationPlan } from "@/src/services/management-plan-workflow.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await getAccessContext(request);
  const actor = managementActor(access);
  const role = managementRole(access);
  if (!activeManagementContext(access) || !actor || !role) return NextResponse.json({ ok: false, error: access.authenticated ? "Немає доступу." : "Потрібна авторизація." }, { status: access.authenticated ? 403 : 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Некоректний JSON." }, { status: 400 });
  const locationId = typeof body.locationId === "string" ? body.locationId.trim() : "";
  const level = body.level === "POST" || body.level === "DAY" ? body.level : null;
  const allocations = Array.isArray(body.allocations) ? body.allocations.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return typeof row.id === "string" ? [{ id: row.id, targetAmount: row.targetAmount }] : [];
  }) : [];
  if (!locationId || !level) return NextResponse.json({ ok: false, error: "locationId і level (POST/DAY) обов'язкові." }, { status: 400 });
  const allowedLocationIds = role === "STATION_MANAGER" ? access.locationIds : (await getPrisma().serviceLocation.findMany({ where: { isActive: true }, select: { id: true } })).map((row) => row.id);
  try {
    const result = await redistributeStationPlan({ planId: id, locationId, level, allocations, actor, allowedLocationIds, reason: typeof body.reason === "string" ? body.reason : null });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManagementResultError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
    console.error("management station redistribution failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося перерозподілити план станції." }, { status: 500 });
  }
}
