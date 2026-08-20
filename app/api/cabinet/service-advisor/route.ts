import { NextResponse } from "next/server";
import { deriveVehicleLifecycle } from "@/src/domain/vehicle-lifecycle";
import { getAccessContext } from "@/src/security/access-context";
import { getPrisma } from "@/src/lib/prisma";
import { getVehicleLifecycleMap } from "@/src/services/vehicle-lifecycle.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function dayRange() {
  const rows = await getPrisma().$queryRawUnsafe<Array<{ startAt: Date; endAt: Date }>>(`SELECT (date_trunc('day',now() AT TIME ZONE 'Europe/Kyiv') AT TIME ZONE 'Europe/Kyiv') AS "startAt",((date_trunc('day',now() AT TIME ZONE 'Europe/Kyiv')+interval '1 day') AT TIME ZONE 'Europe/Kyiv') AS "endAt"`);
  return rows[0];
}

function vehicleLabel(vehicle: { brand: string | null; model: string | null; year: number | null }) {
  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль";
}

function lifecyclePayload(value: ReturnType<typeof deriveVehicleLifecycle>) {
  return value ? { code: value.code, label: value.label, flags: value.flags } : null;
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
    const now = new Date();

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
    const lifecycleMap = await getVehicleLifecycleMap(vehicleIds, now);

    const [diagnosticRows, findings] = await Promise.all([
      vehicleIds.length ? prisma.diagnosticRequest.findMany({
        where: { status: { not: "CANCELLED" }, vehicleId: { in: vehicleIds } },
        include: { vehicle: { select: { id: true, brand: true, model: true, plateNumber: true } }, client: { select: { name: true, phone: true } } },
        orderBy: { updatedAt: "desc" },
        take: 30,
      }) : [],
      workOrderIds.length ? prisma.mechanicWorkFinding.findMany({
        where: { workOrderId: { in: workOrderIds }, status: { in: ["SUBMITTED", "REVIEWED"] } },
        include: { media: { select: { id: true, fileName: true, mimeType: true, fileSize: true }, orderBy: { createdAt: "asc" } } },
        orderBy: [{ urgency: "desc" }, { updatedAt: "desc" }],
        take: 20,
      }) : [],
    ]);

    const diagnosticIds = diagnosticRows.map((item) => item.id);
    const [diagnosticReviews, diagnosticShares] = await Promise.all([
      diagnosticIds.length ? prisma.diagnosticReview.findMany({
        where: { diagnosticRequestId: { in: diagnosticIds } },
        select: { diagnosticRequestId: true, state: true, reviewerUserId: true },
      }) : [],
      diagnosticIds.length ? prisma.diagnosticReportShare.findMany({
        where: { diagnosticRequestId: { in: diagnosticIds } },
        select: { diagnosticRequestId: true, revokedAt: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }) : [],
    ]);
    const reviewByDiagnostic = new Map(diagnosticReviews.map((item) => [item.diagnosticRequestId, item]));
    const shareByDiagnostic = new Map<string, (typeof diagnosticShares)[number]>();
    for (const share of diagnosticShares) if (!shareByDiagnostic.has(share.diagnosticRequestId)) shareByDiagnostic.set(share.diagnosticRequestId, share);

    const appointmentByVehicle = new Map<string, (typeof appointments)[number]>();
    for (const appointment of appointments) {
      if (!appointment.vehicleId) continue;
      const current = appointmentByVehicle.get(appointment.vehicleId);
      if (!current || (appointment.actualArrivalAt && !current.actualArrivalAt)) appointmentByVehicle.set(appointment.vehicleId, appointment);
    }

    const diagnostics = diagnosticRows.flatMap((diagnostic) => {
      const review = reviewByDiagnostic.get(diagnostic.id) || null;
      const share = shareByDiagnostic.get(diagnostic.id) || null;
      const appointment = appointmentByVehicle.get(diagnostic.vehicle.id) || null;
      const shareActive = Boolean(share && !share.revokedAt && (!share.expiresAt || share.expiresAt.getTime() > now.getTime()));
      const lifecycle = deriveVehicleLifecycle({
        appointmentStatus: appointment?.status || null,
        appointmentActualArrivalAt: appointment?.actualArrivalAt || null,
        appointmentPlannedEndAt: appointment?.plannedEndAt || null,
        diagnosticStatus: diagnostic.status,
        diagnosticReviewState: review?.state || null,
        diagnosticReviewerUserId: review?.reviewerUserId || null,
        diagnosticCardSent: shareActive,
      }, now);
      if (!lifecycle || !["IN_WORK", "DIAGNOSTIC_COMPLETED", "MANAGER_REVIEW"].includes(lifecycle.code)) return [];
      return [{
        id: diagnostic.id,
        status: diagnostic.status,
        lifecycle: lifecyclePayload(lifecycle)!,
        plate: diagnostic.vehicle.plateNumber || "—",
        vehicle: [diagnostic.vehicle.brand, diagnostic.vehicle.model].filter(Boolean).join(" ") || "Автомобіль",
        client: diagnostic.client.name || diagnostic.client.phone,
      }];
    });

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

    const appointmentLifecycle = appointments.map((appointment) => appointment.vehicleId ? lifecycleMap.get(appointment.vehicleId) || null : null);
    const countLifecycle = (...codes: string[]) => appointmentLifecycle.filter((lifecycle) => lifecycle && codes.includes(lifecycle.code)).length;
    const managerReview = diagnostics.filter((item) => ["DIAGNOSTIC_COMPLETED", "MANAGER_REVIEW"].includes(item.lifecycle.code)).length;

    return NextResponse.json({
      ok: true,
      linked: true,
      station: location || { id: locationId, name: "Станція" },
      kpis: {
        today: appointments.length,
        inWork: countLifecycle("IN_WORK"),
        managerReview,
        approval: countLifecycle("CLIENT_DECISION", "WAITING_APPROVAL"),
        waitingParts: countLifecycle("PARTS_SELECTION", "WAITING_PARTS"),
        inRepair: countLifecycle("READY_FOR_REPAIR", "IN_REPAIR", "QUALITY_CONTROL"),
        mechanicFindings: findings.length,
      },
      appointments: appointments.map((appointment) => {
        const lifecycle = appointment.vehicleId ? lifecycleMap.get(appointment.vehicleId) || null : null;
        return {
          id: appointment.id,
          status: appointment.status,
          lifecycle: lifecyclePayload(lifecycle),
          start: appointment.plannedStartAt,
          plate: appointment.plateNumber || "—",
          vehicle: appointment.vehicleLabel || "Автомобіль",
          problem: appointment.problem,
          post: appointment.post?.name || null,
          mechanic: appointment.mechanic?.name || null,
        };
      }),
      diagnostics,
      mechanicFindings: findings.map((finding) => {
        const order = orderMap.get(finding.workOrderId);
        return {
          id: finding.id,
          workOrderId: finding.workOrderId,
          workOrderLineId: finding.workOrderLineId,
          status: finding.status,
          resolutionCode: finding.resolutionCode,
          estimateLineId: finding.estimateLineId,
          urgency: finding.urgency,
          findingText: finding.findingText,
          recommendation: finding.recommendation,
          managerComment: finding.managerComment,
          mechanicReply: finding.mechanicReply,
          mechanicRepliedAt: finding.mechanicRepliedAt,
          submittedAt: finding.submittedAt,
          reviewedAt: finding.reviewedAt,
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
