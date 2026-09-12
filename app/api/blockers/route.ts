import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  createOperationalBlocker,
  listOperationalBlockers,
  parseOperationalBlockerCode,
  parseOperationalBlockerPriority,
  parseOperationalBlockerSourceType,
  parseOperationalBlockerStatus,
} from "@/src/services/operational-blockers.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function inScope(access: Awaited<ReturnType<typeof authorize>>, locationId: string | null) {
  return !locationId || access.grantedScope === "ALL" || access.context.locationIds.includes(locationId);
}

export async function GET(request: Request) {
  const access = await authorize(PERMISSIONS.PRODUCTION_READ, { request, strict: true, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  const { searchParams } = new URL(request.url);
  const requestedLocationId = text(searchParams.get("locationId"), 64) || null;
  if (requestedLocationId && !inScope(access, requestedLocationId)) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }
  const status = parseOperationalBlockerStatus(searchParams.get("status"));
  const sourceType = parseOperationalBlockerSourceType(searchParams.get("sourceType"));
  const sourceId = text(searchParams.get("sourceId"), 96) || null;
  const blockers = await listOperationalBlockers({
    locationId: requestedLocationId || (access.grantedScope === "ALL" ? null : access.context.locationIds[0] || null),
    status,
    sourceType,
    sourceId,
    appointmentId: text(searchParams.get("appointmentId"), 64) || null,
    workOrderId: text(searchParams.get("workOrderId"), 64) || null,
    workOrderLineId: text(searchParams.get("workOrderLineId"), 64) || null,
    vehicleId: text(searchParams.get("vehicleId"), 64) || null,
    limit: Number(searchParams.get("limit") || 100),
  });
  return NextResponse.json({ ok: true, blockers }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const access = await authorize(PERMISSIONS.PRODUCTION_WRITE, { request, strict: true, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const code = parseOperationalBlockerCode(body?.code);
  const sourceType = parseOperationalBlockerSourceType(body?.sourceType);
  const sourceId = text(body?.sourceId, 96);
  const locationId = text(body?.locationId, 64) || null;
  const reason = text(body?.reason, 4000);
  if (!code || !sourceType || !sourceId || !reason) {
    return NextResponse.json({ ok: false, error: "INVALID_OPERATIONAL_BLOCKER", message: "Вкажіть код, джерело та причину блокера." }, { status: 400 });
  }
  if (!inScope(access, locationId)) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }
  try {
    const blocker = await createOperationalBlocker({
      code,
      sourceType,
      sourceId,
      locationId,
      appointmentId: text(body?.appointmentId, 64) || null,
      workOrderId: text(body?.workOrderId, 64) || null,
      workOrderLineId: text(body?.workOrderLineId, 64) || null,
      vehicleId: text(body?.vehicleId, 64) || null,
      clientId: text(body?.clientId, 64) || null,
      title: text(body?.title, 240) || null,
      reason,
      nextAction: text(body?.nextAction, 4000) || null,
      priority: parseOperationalBlockerPriority(body?.priority) || "MEDIUM",
      openedByUserId: access.context.user?.id || null,
      openedByName: access.context.user?.employeeName || access.context.user?.name || null,
      dueAt: body?.dueAt ? new Date(String(body.dueAt)) : null,
      metadata: body?.metadata,
    });
    return NextResponse.json({ ok: true, blocker }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_OPERATIONAL_BLOCKER") {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error("POST /api/blockers failed", error);
    return NextResponse.json({ ok: false, error: "Не вдалося створити блокер." }, { status: 500 });
  }
}
