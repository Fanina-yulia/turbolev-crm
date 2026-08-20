import { NextRequest, NextResponse } from "next/server";
import { DiagnosticReviewState } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await authorize(PERMISSIONS.DIAGNOSTICS_READ, {
    request,
    minimumScope: "LOCATION",
  });
  if (!access.allowed) return access.response!;

  const clientId = (request.nextUrl.searchParams.get("clientId") || "").trim();
  const vehicleId = (request.nextUrl.searchParams.get("vehicleId") || "").trim();
  if (!clientId && !vehicleId) {
    return NextResponse.json({ ok: false, error: "CLIENT_OR_VEHICLE_REQUIRED" }, { status: 400 });
  }

  try {
    const prisma = getPrisma();
    const vehicles = await prisma.vehicle.findMany({
      where: vehicleId
        ? { id: vehicleId, ...(clientId ? { clientId } : {}) }
        : { clientId },
      select: {
        id: true,
        clientId: true,
        brand: true,
        model: true,
        year: true,
        plateNumber: true,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });

    if (!vehicles.length) {
      return NextResponse.json({ ok: true, cases: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const vehicleIds = vehicles.map((vehicle) => vehicle.id);
    let diagnostics = await prisma.diagnosticRequest.findMany({
      where: {
        vehicleId: { in: vehicleIds },
        ...(clientId ? { clientId } : {}),
      },
      select: {
        id: true,
        clientId: true,
        vehicleId: true,
        status: true,
        updatedAt: true,
        workOrder: { select: { id: true, status: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
    });

    if (!access.shadowBypass && access.grantedScope !== "ALL") {
      const ids = diagnostics.map((row) => row.id);
      const assignments = ids.length
        ? await prisma.diagnosticAssignment.findMany({
            where: {
              diagnosticRequestId: { in: ids },
              locationId: { in: access.context.locationIds },
            },
            select: { diagnosticRequestId: true },
          })
        : [];
      const allowed = new Set(assignments.map((item) => item.diagnosticRequestId));
      diagnostics = diagnostics.filter((item) => allowed.has(item.id));
    }

    const diagnosticIds = diagnostics.map((row) => row.id);
    const reviews = diagnosticIds.length
      ? await prisma.diagnosticReview.findMany({
          where: { diagnosticRequestId: { in: diagnosticIds } },
          select: { diagnosticRequestId: true, state: true },
        })
      : [];
    const reviewByDiagnostic = new Map(reviews.map((review) => [review.diagnosticRequestId, review.state]));

    const latestByVehicle = new Map<string, (typeof diagnostics)[number]>();
    for (const diagnostic of diagnostics) {
      if (!latestByVehicle.has(diagnostic.vehicleId)) latestByVehicle.set(diagnostic.vehicleId, diagnostic);
    }

    const cases = vehicles.map((vehicle) => {
      const diagnostic = latestByVehicle.get(vehicle.id) || null;
      const reviewState = diagnostic ? (reviewByDiagnostic.get(diagnostic.id) || DiagnosticReviewState.DRAFT) : null;
      const shareable = reviewState === DiagnosticReviewState.SUBMITTED || reviewState === DiagnosticReviewState.CONFIRMED;
      return {
        vehicle: {
          id: vehicle.id,
          label: [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Автомобіль",
          plateNumber: vehicle.plateNumber,
        },
        diagnosticId: diagnostic?.id || null,
        diagnosticStatus: diagnostic?.status || null,
        reviewState,
        shareable,
        workOrder: diagnostic?.workOrder || null,
      };
    });

    return NextResponse.json({ ok: true, cases }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/diagnostics/customer-cabinet/context failed", error);
    return NextResponse.json({ ok: false, error: "CUSTOMER_CABINET_CONTEXT_FAILED" }, { status: 500 });
  }
}
