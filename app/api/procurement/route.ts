import { NextResponse } from "next/server";
import { getPrisma } from "@/src/lib/prisma";
import { getAccessContext, hasPermission, type AccessContext } from "@/src/security/access-context";
import { PERMISSIONS, type AccessScopeCode } from "@/src/security/permissions";
import { transitionPartsRequest, updatePartsRequest, updatePartsRequestItem, WorkOrderCommercialError } from "@/src/services/work-order-commercial.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ACTIVE_STATUSES = ["NEW", "SELECTING", "SELECTED", "WAITING_APPROVAL", "APPROVED", "ORDER_REQUIRED", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "INSTALLED"] as const;
const TARGETS: Record<string, string> = {
  START_SELECTION: "SELECTING",
  SELECTION_DONE: "SELECTED",
  APPROVE: "APPROVED",
  REQUIRE_ORDER: "ORDER_REQUIRED",
  MARK_ORDERED: "ORDERED",
};

function scopeRank(scope: AccessScopeCode | undefined) {
  return scope === "ALL" ? 5 : scope === "LOCATION" ? 4 : scope === "TEAM" ? 3 : scope === "ASSIGNED" ? 2 : scope === "SELF" ? 1 : 0;
}

function decimal(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function category(status: string) {
  if (["NEW", "SELECTING"].includes(status)) return "SELECTING";
  if (["SELECTED", "WAITING_APPROVAL", "APPROVED", "ORDER_REQUIRED"].includes(status)) return "APPROVED";
  if (status === "ORDERED") return "ORDERED";
  if (status === "PARTIALLY_RECEIVED") return "PARTIAL";
  return "RECEIVED";
}

async function verifyProcurementAccess(request: Request, write = false) {
  const context = await getAccessContext(request);
  const permission = write ? PERMISSIONS.PROCUREMENT_WRITE : PERMISSIONS.PROCUREMENT_READ;
  if (context.enforcementMode === "ENFORCED") {
    if (!context.authenticated) return { context, error: NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 }) };
    if (context.provisioningState !== "ACTIVE" || !context.user) return { context, error: NextResponse.json({ ok: false, error: "ACCESS_PROFILE_INACTIVE" }, { status: 403 }) };
    if (!hasPermission(context, permission)) return { context, error: NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }) };
  }
  return { context, error: null };
}

async function resolveScope(request: Request, context: AccessContext) {
  const prisma = getPrisma();
  const requestedLocationId = new URL(request.url).searchParams.get("locationId")?.trim() || null;
  const scope = context.permissions[PERMISSIONS.PROCUREMENT_READ] as AccessScopeCode | undefined;
  const activeUser = context.provisioningState === "ACTIVE" && context.user ? context.user : null;
  const canSeeAll = !activeUser || scopeRank(scope) >= scopeRank("ALL");
  const allowedIds = new Set(context.locationIds);
  const allLocations = await prisma.serviceLocation.findMany({
    where: { isActive: true },
    select: { id: true, name: true, timezone: true },
    orderBy: { sortOrder: "asc" },
  });
  const locations = canSeeAll ? allLocations : allLocations.filter((location) => allowedIds.has(location.id));
  const locationId = requestedLocationId && locations.some((location) => location.id === requestedLocationId) ? requestedLocationId : locations[0]?.id ?? null;
  return { locationId, locations };
}

async function verifyRequestLocation(partsRequestId: string, locationId: string) {
  const prisma = getPrisma();
  const request = await prisma.partsRequest.findUnique({ where: { id: partsRequestId }, select: { workOrderId: true } });
  if (!request) return null;
  const appointment = await prisma.serviceAppointment.findFirst({ where: { workOrderId: request.workOrderId, locationId }, select: { id: true } });
  return appointment ? request : null;
}

export async function GET(request: Request) {
  try {
    const access = await verifyProcurementAccess(request, false);
    if (access.error) return access.error;
    const prisma = getPrisma();
    const scope = await resolveScope(request, access.context);
    if (!scope.locationId) return NextResponse.json({ ok: true, location: null, locations: [], cards: [], canWrite: false });
    const location = scope.locations.find((item) => item.id === scope.locationId)!;

    const appointments = await prisma.serviceAppointment.findMany({
      where: { locationId: scope.locationId, workOrderId: { not: null } },
      select: { workOrderId: true, post: { select: { id: true, name: true } }, mechanic: { select: { id: true, name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 700,
    });
    const appointmentMap = new Map<string, (typeof appointments)[number]>();
    for (const appointment of appointments) if (appointment.workOrderId && !appointmentMap.has(appointment.workOrderId)) appointmentMap.set(appointment.workOrderId, appointment);
    const workOrderIds = [...appointmentMap.keys()];
    if (!workOrderIds.length) return NextResponse.json({ ok: true, location, locations: scope.locations, cards: [], canWrite: access.context.enforcementMode !== "ENFORCED" || hasPermission(access.context, PERMISSIONS.PROCUREMENT_WRITE) });

    const partsRequests = await prisma.partsRequest.findMany({
      where: { workOrderId: { in: workOrderIds }, status: { in: [...ACTIVE_STATUSES] } },
      include: { items: { orderBy: { createdAt: "asc" } } },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
    const requestWorkOrderIds = [...new Set(partsRequests.map((item) => item.workOrderId))];
    const [workOrders, numberRows] = await Promise.all([
      prisma.workOrder.findMany({
        where: { id: { in: requestWorkOrderIds } },
        select: { id: true, status: true, vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, vin: true } } },
      }),
      prisma.workOrderNumber.findMany({ where: { workOrderId: { in: requestWorkOrderIds } }, select: { workOrderId: true, number: true } }),
    ]);
    const workOrderMap = new Map(workOrders.map((item) => [item.id, item]));
    const numberMap = new Map(numberRows.map((item) => [item.workOrderId, item.number]));
    const supplierIds = [...new Set(partsRequests.flatMap((request) => request.items.map((item) => item.supplierId).filter((id): id is string => Boolean(id))))];
    const suppliers = supplierIds.length ? await prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true, code: true } }) : [];
    const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

    const cards = partsRequests.flatMap((partsRequest) => {
      const workOrder = workOrderMap.get(partsRequest.workOrderId);
      if (!workOrder) return [];
      const appointment = appointmentMap.get(partsRequest.workOrderId) ?? null;
      const totalItems = partsRequest.items.length;
      const fullyReceived = partsRequest.items.filter((item) => decimal(item.receivedQuantity) >= decimal(item.quantity)).length;
      const fullyInstalled = partsRequest.items.filter((item) => decimal(item.installedQuantity) >= decimal(item.quantity)).length;
      return [{
        id: partsRequest.id,
        workOrderId: partsRequest.workOrderId,
        number: numberMap.get(partsRequest.workOrderId) ?? null,
        status: partsRequest.status,
        category: category(partsRequest.status),
        paymentRequired: partsRequest.paymentRequired,
        paymentConfirmedAt: partsRequest.paymentConfirmedAt,
        plate: workOrder.vehicle.plateNumber || "—",
        vin: workOrder.vehicle.vin,
        vehicle: vehicleLabel(workOrder.vehicle),
        workOrderStatus: workOrder.status,
        post: appointment?.post ?? null,
        mechanic: appointment?.mechanic ?? null,
        totalItems,
        fullyReceived,
        fullyInstalled,
        items: partsRequest.items.map((item) => ({
          id: item.id,
          description: item.description,
          article: item.article,
          brand: item.brand,
          quantity: decimal(item.quantity),
          receivedQuantity: decimal(item.receivedQuantity),
          installedQuantity: decimal(item.installedQuantity),
          requiredForRepair: item.requiredForRepair,
          etaAt: item.etaAt,
          supplier: item.supplierId ? supplierMap.get(item.supplierId) ?? null : null,
        })),
        updatedAt: partsRequest.updatedAt,
      }];
    });

    return NextResponse.json({
      ok: true,
      location,
      locations: scope.locations,
      cards,
      canWrite: access.context.enforcementMode !== "ENFORCED" || hasPermission(access.context, PERMISSIONS.PROCUREMENT_WRITE),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/procurement failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "Не вдалося завантажити чергу закупівель і складу." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const access = await verifyProcurementAccess(request, true);
    if (access.error) return access.error;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const partsRequestId = typeof body.partsRequestId === "string" ? body.partsRequestId.trim() : "";
    const action = typeof body.action === "string" ? body.action.trim().toUpperCase() : "";
    if (!partsRequestId || !action) return NextResponse.json({ ok: false, error: "Некоректна складська дія." }, { status: 400 });
    const scope = await resolveScope(request, access.context);
    if (!scope.locationId || !(await verifyRequestLocation(partsRequestId, scope.locationId))) return NextResponse.json({ ok: false, error: "Ця заявка не входить до Вашої станції." }, { status: 403 });
    const actorName = access.context.user?.employeeName || access.context.user?.name || "CRM / Закупівлі та склад";

    if (TARGETS[action]) {
      const result = await transitionPartsRequest(partsRequestId, TARGETS[action], actorName);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "SET_PAYMENT_REQUIRED") {
      const result = await updatePartsRequest(partsRequestId, { paymentRequired: Boolean(body.paymentRequired) }, actorName);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "CONFIRM_PAYMENT") {
      const result = await updatePartsRequest(partsRequestId, { paymentConfirmed: true }, actorName);
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "RECEIVE_ITEM" || action === "INSTALL_ITEM") {
      const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
      if (!itemId) return NextResponse.json({ ok: false, error: "Не вказано позицію деталі." }, { status: 400 });
      const payload = action === "RECEIVE_ITEM"
        ? { receivedQuantity: body.quantity }
        : { receivedQuantity: body.receivedQuantity, installedQuantity: body.quantity };
      const result = await updatePartsRequestItem(partsRequestId, itemId, payload, actorName);
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ ok: false, error: "Непідтримувана складська дія." }, { status: 400 });
  } catch (error) {
    if (error instanceof WorkOrderCommercialError) return NextResponse.json({ ok: false, code: error.code, error: error.message, details: error.details ?? null }, { status: ["PARTS_REQUEST_NOT_FOUND", "PARTS_ITEM_NOT_FOUND"].includes(error.code) ? 404 : 409 });
    console.error("POST /api/procurement failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "Не вдалося виконати складську дію." }, { status: 500 });
  }
}
