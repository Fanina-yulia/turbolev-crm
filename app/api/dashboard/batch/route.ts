import { NextResponse } from "next/server";
import {
  canUseDashboardWidget,
  dashboardAccessSnapshot,
  isDashboardWidgetType,
  isSupportedDashboardId,
} from "@/src/dashboard-builder/config";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function traceId() {
  return crypto.randomUUID();
}

export async function POST(request: Request) {
  const id = traceId();
  const access = await authorize(PERMISSIONS.OVERVIEW_READ, { strict: true, request, minimumScope: "SELF" });
  if (!access.allowed) return access.response!;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !isSupportedDashboardId(body.dashboardId) || !Array.isArray(body.widgets)) {
    return NextResponse.json({ ok: false, error: "INVALID_BATCH_REQUEST", traceId: id }, { status: 400 });
  }

  const dashboardAccess = dashboardAccessSnapshot(access.context);
  const requested = body.widgets.slice(0, 40);
  const now = new Date().toISOString();
  const results = requested.map((item) => {
    if (!isRecord(item)) {
      return { instanceId: null, widgetType: null, state: "error", error: "INVALID_WIDGET_REQUEST", traceId: id };
    }
    const instanceId = typeof item.instanceId === "string" ? item.instanceId.slice(0, 80) : null;
    if (!instanceId || !isDashboardWidgetType(item.widgetType)) {
      return { instanceId, widgetType: null, state: "error", error: "INVALID_WIDGET_REQUEST", traceId: id };
    }
    if (!canUseDashboardWidget(item.widgetType, dashboardAccess)) {
      return { instanceId, widgetType: item.widgetType, state: "forbidden", data: null, lastUpdatedAt: null, traceId: id };
    }

    // P1 establishes the isolated batch contract. Real providers are connected
    // incrementally in P2/P3; an empty provider must not fail peer widgets.
    return {
      instanceId,
      widgetType: item.widgetType,
      state: "empty",
      data: null,
      lastUpdatedAt: now,
      traceId: id,
    };
  });

  return NextResponse.json({ ok: true, traceId: id, results }, { headers: { "Cache-Control": "no-store" } });
}
