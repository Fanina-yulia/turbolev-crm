import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import {
  getVehicleLocation,
  listVehicleLocationEvents,
  moveVehicleLocation,
  parseVehicleLocationCode,
  parseVehicleLocationSourceType,
  vehicleLocationLabel,
} from "@/src/services/vehicle-location.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function canReadLocation(access: Awaited<ReturnType<typeof authorize>>, locationId: string | null | undefined) {
  return access.grantedScope === "ALL" || !locationId || access.context.locationIds.includes(locationId);
}

function actor(access: Awaited<ReturnType<typeof authorize>>) {
  return {
    actorUserId: access.context.user?.id || null,
    actorName: (access.context.user?.employeeName || access.context.user?.name || "CRM").trim().slice(0, 160),
  };
}

export async function GET(request: Request, context: RouteContext) {
  const access = await authorize(PERMISSIONS.PRODUCTION_READ, {
    request,
    strict: true,
    minimumScope: "LOCATION",
  });
  if (!access.allowed) return access.response!;

  const { id } = await context.params;
  const current = await getVehicleLocation(id);
  if (!canReadLocation(access, current?.serviceLocationId)) {
    return NextResponse.json({ ok: false, error: "Автомобіль не входить до доступної локації." }, { status: 404 });
  }

  const includeHistory = new URL(request.url).searchParams.get("history") === "1";
  const history = includeHistory
    ? (await listVehicleLocationEvents(id, 100)).filter((event) => canReadLocation(access, event.serviceLocationId))
    : undefined;

  return NextResponse.json({
    ok: true,
    location: current
      ? { ...current, label: vehicleLocationLabel(current.code) }
      : null,
    history,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, context: RouteContext) {
  const access = await authorize(PERMISSIONS.PRODUCTION_WRITE, {
    request,
    strict: true,
    minimumScope: "LOCATION",
  });
  if (!access.allowed) return access.response!;

  const { id } = await context.params;
  try {
    const body = await request.json() as Record<string, unknown>;
    const code = parseVehicleLocationCode(body.code);
    const sourceType = parseVehicleLocationSourceType(body.sourceType || "MANUAL");
    const locationId = typeof body.serviceLocationId === "string" ? body.serviceLocationId.trim() : "";
    const postId = typeof body.servicePostId === "string" ? body.servicePostId.trim() : "";
    if (!code || !sourceType || !["MANUAL", "SYSTEM"].includes(sourceType)) {
      return NextResponse.json({ ok: false, error: "Некоректний тип або джерело локації." }, { status: 400 });
    }

    let scopedLocationId = locationId || null;
    if (postId && !scopedLocationId) {
      const post = await getPrisma().servicePost.findUnique({ where: { id: postId }, select: { locationId: true } });
      scopedLocationId = post?.locationId || null;
    }
    if (!canReadLocation(access, scopedLocationId)) {
      return NextResponse.json({ ok: false, error: "Ця локація не входить до Вашого доступу." }, { status: 403 });
    }

    const result = await moveVehicleLocation({
      vehicleId: id,
      code,
      serviceLocationId: scopedLocationId,
      servicePostId: postId || null,
      sourceType,
      sourceId: typeof body.sourceId === "string" && body.sourceId.trim() ? body.sourceId.trim() : "vehicle:" + id,
      reason: typeof body.reason === "string" ? body.reason : "Ручне переміщення автомобіля.",
      ...actor(access),
      idempotencyKey: request.headers.get("Idempotency-Key") || (typeof body.idempotencyKey === "string" ? body.idempotencyKey : null),
    });

    return NextResponse.json({
      ok: true,
      changed: result.changed,
      replayed: result.replayed,
      location: result.location
        ? { ...result.location, label: vehicleLocationLabel(result.location.code) }
        : null,
      event: result.event,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const status = code === "VEHICLE_NOT_FOUND" ? 404 : code.startsWith("VEHICLE_POST_OCCUPIED") ? 409 : 422;
    const message = code === "VEHICLE_NOT_FOUND"
      ? "Автомобіль не знайдено."
      : code === "SERVICE_LOCATION_NOT_FOUND"
        ? "Локація не знайдена або вимкнена."
        : code === "SERVICE_POST_NOT_FOUND"
          ? "Пост не знайдений або вимкнений."
          : code === "SERVICE_POST_REQUIRED"
            ? "Для локації «Ремонтний пост» потрібно вказати пост."
            : code === "SERVICE_POST_LOCATION_MISMATCH"
              ? "Обраний пост належить іншій локації."
              : code.startsWith("VEHICLE_POST_OCCUPIED")
                ? "Обраний пост уже зайнятий іншим автомобілем."
                : "Не вдалося змінити локацію автомобіля.";
    return NextResponse.json({ ok: false, code, error: message }, { status });
  }
}
