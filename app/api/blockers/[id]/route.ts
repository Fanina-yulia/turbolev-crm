import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  getOperationalBlocker,
  transitionOperationalBlocker,
  type OperationalBlockerAction,
} from "@/src/services/operational-blockers.service";

type RouteContext = { params: Promise<{ id: string }> };

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function inScope(access: Awaited<ReturnType<typeof authorize>>, locationId: string | null) {
  return !locationId || access.grantedScope === "ALL" || access.context.locationIds.includes(locationId);
}

export async function GET(request: Request, context: RouteContext) {
  const access = await authorize(PERMISSIONS.PRODUCTION_READ, { request, strict: true, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  const { id } = await context.params;
  const blocker = await getOperationalBlocker(id);
  if (!blocker || !inScope(access, blocker.locationId)) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, blocker }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: RouteContext) {
  const access = await authorize(PERMISSIONS.PRODUCTION_WRITE, { request, strict: true, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  const { id } = await context.params;
  const blocker = await getOperationalBlocker(id);
  if (!blocker || !inScope(access, blocker.locationId)) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = text(body?.action, 24).toUpperCase() as OperationalBlockerAction;
  if (!["ACKNOWLEDGE", "RESOLVE", "CANCEL", "REOPEN"].includes(action)) {
    return NextResponse.json({ ok: false, error: "INVALID_TRANSITION", message: "Вкажіть коректну дію над блокером." }, { status: 400 });
  }
  try {
    const updated = await transitionOperationalBlocker({
      id,
      action,
      actorId: access.context.user?.id || "CRM",
      actorName: access.context.user?.employeeName || access.context.user?.name || "CRM",
      resolutionComment: text(body?.resolutionComment, 4000) || null,
    });
    return NextResponse.json({ ok: true, blocker: updated });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "OPERATIONAL_BLOCKER_NOT_FOUND") return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    if (code === "OPERATIONAL_BLOCKER_INVALID_TRANSITION") return NextResponse.json({ ok: false, error: code, message: "Цей перехід блокера зараз недоступний." }, { status: 409 });
    console.error("PATCH /api/blockers/[id] failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося змінити блокер." }, { status: 500 });
  }
}
