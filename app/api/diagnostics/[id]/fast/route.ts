import { NextResponse } from "next/server";
import { authorize } from "@/src/security/authorize";
import { PERMISSIONS } from "@/src/security/permissions";
import { getPrisma } from "@/src/lib/prisma";
import { getDiagnosticCardMeta } from "@/src/services/diagnostic-card.service";
import { getStructuredDiagnostic } from "@/src/services/structured-diagnostics.service";
import { getStructuredDiagnosticForMechanicReadOnly } from "@/src/services/mechanic-diagnostics-read.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMechanic(access: Awaited<ReturnType<typeof authorize>>) {
  return Boolean(access.context.roles.some((role) => role.code === "MECHANIC"));
}

async function readDiagnostic(access: Awaited<ReturnType<typeof authorize>>, id: string) {
  if (!access.context.user) return null;
  if (isMechanic(access)) return getStructuredDiagnosticForMechanicReadOnly(access.context.user.id, id);

  const prisma = getPrisma();
  const assignment = await prisma.diagnosticAssignment.findUnique({
    where: { diagnosticRequestId: id },
    select: { locationId: true },
  });
  if (!access.shadowBypass && access.grantedScope !== "ALL" && (!assignment?.locationId || !access.context.locationIds.includes(assignment.locationId))) return null;
  return getStructuredDiagnostic(id);
}

async function commercialMeta(workOrderId: string | null) {
  if (!workOrderId) return null;
  const prisma = getPrisma();
  const [estimate, partsRequest] = await Promise.all([
    prisma.workOrderEstimate.findFirst({
      where: { workOrderId },
      orderBy: [{ revision: "desc" }, { updatedAt: "desc" }],
      select: { id: true, status: true },
    }),
    prisma.partsRequest.findFirst({
      where: { workOrderId, status: { not: "CANCELLED" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    }),
  ]);
  if (!estimate && !partsRequest) return null;
  const stage = estimate
    ? (["DRAFT", "SENT", "APPROVED", "REJECTED", "SUPERSEDED"].includes(estimate.status) ? estimate.status : "DRAFT")
    : "PARTS_SELECTION";
  return { workOrderId, stage, estimate, partsRequest };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const access = await authorize(PERMISSIONS.DIAGNOSTICS_READ, { request, minimumScope: "SELF" });
    if (!access.allowed) return access.response!;
    const view = await readDiagnostic(access, id);
    if (!view) return NextResponse.json({ ok: false, error: "DIAGNOSTIC_NOT_FOUND" }, { status: 404 });

    const requestedVehicleId = new URL(request.url).searchParams.get("vehicleId");
    if (requestedVehicleId && view.diagnostic.vehicle.id !== requestedVehicleId) {
      return NextResponse.json({ ok: false, error: "DIAGNOSTIC_VEHICLE_MISMATCH" }, { status: 409 });
    }

    const prisma = getPrisma();
    const [card, mechanic, commercialProposal] = await Promise.all([
      getDiagnosticCardMeta(id),
      view.diagnostic.assignment?.mechanicId
        ? prisma.serviceMechanic.findUnique({ where: { id: view.diagnostic.assignment.mechanicId }, select: { id: true, name: true } })
        : null,
      commercialMeta(view.diagnostic.workOrder?.id || null),
    ]);

    const reviewState = view.diagnostic.review.state;
    const workflowState = reviewState === "SUBMITTED"
      ? "SUBMITTED"
      : reviewState === "RETURNED"
        ? "RETURNED"
        : view.diagnostic.status;
    const row = {
      id: view.diagnostic.id,
      status: view.diagnostic.status,
      workflowState,
      reviewState,
      createdAt: view.diagnostic.createdAt,
      updatedAt: view.diagnostic.updatedAt,
      confirmedAt: view.diagnostic.confirmedAt,
      vehicle: {
        id: view.diagnostic.vehicle.id,
        plateNumber: view.diagnostic.vehicle.plateNumber,
        vin: view.diagnostic.vehicle.vin,
      },
      assignedMechanic: mechanic,
      diagnosticCard: card ? { number: card.number, finalizedAt: card.finalizedAt } : null,
      structured: {
        inspections: view.inspections.length,
        checked: view.counts.checked,
        defects: view.counts.defect,
        attention: view.counts.attention,
      },
      commercialProposal,
    };

    return NextResponse.json({
      ok: true,
      row,
      view: {
        diagnostic: view.diagnostic,
        inspections: view.inspections,
        counts: view.counts,
      },
      cardNumber: card?.number || null,
    }, { headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=30" } });
  } catch (error) {
    console.error("GET fast diagnostic card failed", error);
    return NextResponse.json({ ok: false, error: "FAST_DIAGNOSTIC_LOAD_FAILED" }, { status: 500 });
  }
}
