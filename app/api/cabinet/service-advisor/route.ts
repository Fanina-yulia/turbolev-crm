import { NextResponse } from "next/server";
import { getAccessContext } from "@/src/security/access-context";
import { getPrisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function dayRange() {
  const rows = await getPrisma().$queryRawUnsafe<Array<{ startAt: Date; endAt: Date }>>(`SELECT (date_trunc('day',now() AT TIME ZONE 'Europe/Kyiv') AT TIME ZONE 'Europe/Kyiv') AS "startAt",((date_trunc('day',now() AT TIME ZONE 'Europe/Kyiv')+interval '1 day') AT TIME ZONE 'Europe/Kyiv') AS "endAt"`);
  return rows[0];
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

export async function GET(request: Request) {
  try {
    const access = await getAccessContext(request);
    if (access.provisioningState !== "ACTIVE" || !access.user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
    const role = access.roles.find((r) => r.isPrimary && r.code === "SERVICE_ADVISOR") || access.roles.find((r) => r.code === "SERVICE_ADVISOR");
    if (!role) return NextResponse.json({ ok: false, error: "ROLE_NOT_SUPPORTED" }, { status: 403 });
    const locationId = role.locationId || access.locationIds[0];
    if (!locationId) return NextResponse.json({ ok: true, linked: false, reason: "LOCATION_NOT_ASSIGNED" });

    const prisma = getPrisma();
    const range = await dayRange();
    if (!range) throw new Error("DAY_RANGE_FAILED");

    const [location, appointments] = await Promise.all([
      prisma.serviceLocation.findUnique({ where: { id: locationId }, select: { id: true, name: true } }),
      prisma.serviceAppointment.findMany({
        where: { locationId, plannedStartAt: { gte: range.startAt, lt: range.endAt }, status: { notIn: ["CANCELLED", "RESERVE"] } },
        include: { post: { select: { name: true } }, mechanic: { select: { name: true } } },
        orderBy: { plannedStartAt: "asc" },
      }),
    ]);

    const vehicleIds = Array.from(new Set(appointments.map((item) => item.vehicleId).filter((value): value is string => Boolean(value))));
    const workOrderIds = Array.from(new Set(appointments.map((item) => item.workOrderId).filter((value): value is string => Boolean(value))));

    const [diagnostics, findings] = await Promise.all([
      vehicleIds.length ? prisma.diagnosticRequest.findMany({
        where: { status: { in: ["PENDING", "IN_PROGRESS"] }, vehicleId: { in: vehicleIds } },
        include: { vehicle: { select: { brand: true, model: true, plateNumber: true } }, client: { select: { name: true, phone: true } } },
        orderBy: { updatedAt: "desc" },
        take: 12,
      }) : [],
      workOrderIds.length ? prisma.mechanicWorkFinding.findMany({
        where: { workOrderId: { in: workOrderIds }, status: { in: ["SUBMITTED", "REVIEWED"] } },
        include: { media: { select: { id: true, fileName: true, mimeType: true, fileSize: true }, orderBy: { createdAt: "asc" } } },
        orderBy: { submittedAt: "desc" },
        take: 20,
      }) : [],
    ]);

    const findingLineIds = Array.from(new Set(findings.map((item) => item.workOrderLineId)));
    const findingOrderIds = Array.from(new Set(findings.map((item) => item.workOrderId)));
    const findingUserIds = Array.from(new Set(findings.map((item) => item.mechanicUserId)));
    const [findingLines, findingOrders, findingUsers] = await Promise.all([
      findingLineIds.length ? prisma.workOrderLine.findMany({ where: { id: { in: findingLineIds } }, select: { id: true, description: true } }) : [],
      findingOrderIds.length ? prisma.workOrder.findMany({ where: { id: { in: findingOrderIds } }, include: { vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } } } }) : [],
      findingUserIds.length ? prisma.user.findMany({ where: { id: { in: findingUserIds } }, select: { id: true, name: true } }) : [],
    ]);
    const lineMap = new Map(findingLines.map((item) => [item.id, item.description]));
    const orderMap = new Map(findingOrders.map((item) => [item.id, item]));
    const userMap = new Map(findingUsers.map((item) => [item.id, item.name]));

    const count = (...statuses: string[]) => appointments.filter((x) => statuses.includes(x.status)).length;
    return NextResponse.json({
      ok: true,
      linked: true,
      station: location || { id: locationId, name: "Станція" },
      kpis: {
        today: appointments.length,
        arrived: count("ARRIVED", "DIAGNOSTICS"),
        approval: count("WAITING_CALCULATION", "WAITING_APPROVAL"),
        waitingParts: count("WAITING_PARTS_SELECTION", "WAITING_PARTS"),
        inRepair: count("READY_FOR_REPAIR", "IN_REPAIR"),
        mechanicFindings: findings.length,
      },
      appointments: appointments.map((x) => ({
        id: x.id,
        status: x.status,
        start: x.plannedStartAt,
        plate: x.plateNumber || "—",
        vehicle: x.vehicleLabel || "Автомобіль",
        problem: x.problem,
        post: x.post?.name || null,
        mechanic: x.mechanic?.name || null,
      })),
      diagnostics: diagnostics.map((x) => ({
        id: x.id,
        status: x.status,
        plate: x.vehicle.plateNumber || "—",
        vehicle: [x.vehicle.brand, x.vehicle.model].filter(Boolean).join(" ") || "Автомобіль",
        client: x.client.name || x.client.phone,
      })),
      mechanicFindings: findings.map((finding) => {
        const order = orderMap.get(finding.workOrderId);
        return {
          id: finding.id,
          workOrderId: finding.workOrderId,
          workOrderLineId: finding.workOrderLineId,
          status: finding.status,
          urgency: finding.urgency,
          findingText: finding.findingText,
          recommendation: finding.recommendation,
          submittedAt: finding.submittedAt,
          mechanic: userMap.get(finding.mechanicUserId) || "Автомеханік",
          workDescription: lineMap.get(finding.workOrderLineId) || "Робота за нарядом",
          plate: order?.vehicle.plateNumber || "—",
          vehicle: order ? vehicleLabel(order.vehicle) : "Автомобіль",
          media: finding.media.map((media) => ({
            ...media,
            url: `/api/cabinet/findings/${finding.id}/media/${media.id}`,
          })),
        };
      }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("service advisor cabinet", error);
    return NextResponse.json({ ok: false, error: "CABINET_LOAD_FAILED" }, { status: 500 });
  }
}
