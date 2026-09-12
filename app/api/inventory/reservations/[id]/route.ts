import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { transitionInventoryReservation } from "@/src/services/inventory-ledger.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const access = await authorize(PERMISSIONS.PROCUREMENT_WRITE, { request, strict: true, minimumScope: "LOCATION" });
  if (!access.allowed) return access.response!;
  const { id } = await context.params;
  try {
    const current = await getPrisma().inventoryReservation.findUnique({ where: { id }, select: { serviceLocationId: true } });
    if (!current || (access.grantedScope !== "ALL" && current.serviceLocationId && !access.context.locationIds.includes(current.serviceLocationId))) {
      return NextResponse.json({ ok: false, error: "Резерв не знайдено." }, { status: 404 });
    }
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action.toUpperCase() : "";
    if (!["RELEASE", "CONSUME", "CANCEL"].includes(action)) {
      return NextResponse.json({ ok: false, error: "Дозволені дії: RELEASE, CONSUME, CANCEL." }, { status: 400 });
    }
    const result = await transitionInventoryReservation({
      id,
      action: action as "RELEASE" | "CONSUME" | "CANCEL",
      actorUserId: access.context.user?.id || null,
      actorName: access.context.user?.employeeName || access.context.user?.name || "CRM",
      reasonNote: typeof body.reasonNote === "string" ? body.reasonNote : null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const status = code === "INVENTORY_RESERVATION_NOT_FOUND" ? 404 : code === "INVENTORY_INSUFFICIENT" ? 409 : 422;
    return NextResponse.json({ ok: false, code, error: code === "INVENTORY_INSUFFICIENT" ? "Недостатньо фізичного залишку для списання." : "Не вдалося змінити резерв." }, { status });
  }
}
