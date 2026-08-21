import assert from "node:assert/strict";
import { DiagnosticCheckState, DiagnosticRequestStatus } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { arrivePlannerAppointment } from "@/src/services/planner-arrival.service";
import { startStructuredDiagnostic } from "@/src/services/structured-diagnostics.service";
import { submitStructuredDiagnosticRespectingOptional } from "@/src/services/diagnostic-completeness.service";
import { transitionDiagnostic, getDiagnostic } from "@/src/services/diagnostics.service";
import { createDiagnosticReportShare } from "@/src/services/diagnostic-report.service";
import {
  createWorkOrderFromConfirmedDiagnostic,
  WorkOrderHardGateError,
} from "@/src/services/work-orders.service";

const prisma = getPrisma();
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const ids = {
  location: `smoke_loc_${suffix}`,
  post: `smoke_post_${suffix}`,
  mechanic: `smoke_mech_${suffix}`,
  mechanicUser: `smoke_mech_user_${suffix}`,
  client: `smoke_client_${suffix}`,
  vehicle: `smoke_vehicle_${suffix}`,
};
const phone = `+38099${String(Date.now()).slice(-7)}`;
const plate = `SM${String(Date.now()).slice(-6)}`;

function nextDayAtUtcHour(dayOffset: number, hour: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, hour, 0, 0, 0));
}

async function cleanup() {
  const diagnostics = await prisma.diagnosticRequest.findMany({
    where: { vehicleId: ids.vehicle },
    select: { id: true },
  }).catch(() => []);
  const diagnosticIds = diagnostics.map((row) => row.id);
  const inspections = diagnosticIds.length
    ? await prisma.diagnosticInspection.findMany({
        where: { diagnosticRequestId: { in: diagnosticIds } },
        select: { id: true },
      }).catch(() => [])
    : [];
  const inspectionIds = inspections.map((row) => row.id);
  const checks = inspectionIds.length
    ? await prisma.diagnosticCheck.findMany({
        where: { inspectionId: { in: inspectionIds } },
        select: { id: true },
      }).catch(() => [])
    : [];
  const checkIds = checks.map((row) => row.id);
  const findings = checkIds.length
    ? await prisma.diagnosticFinding.findMany({
        where: { checkId: { in: checkIds } },
        select: { id: true },
      }).catch(() => [])
    : [];
  const findingIds = findings.map((row) => row.id);

  if (findingIds.length) await prisma.diagnosticMedia.deleteMany({ where: { findingId: { in: findingIds } } }).catch(() => undefined);
  if (checkIds.length) await prisma.diagnosticFinding.deleteMany({ where: { checkId: { in: checkIds } } }).catch(() => undefined);
  if (inspectionIds.length) await prisma.diagnosticCheck.deleteMany({ where: { inspectionId: { in: inspectionIds } } }).catch(() => undefined);
  if (diagnosticIds.length) {
    await prisma.diagnosticReportShare.deleteMany({ where: { diagnosticRequestId: { in: diagnosticIds } } }).catch(() => undefined);
    await prisma.workOrderLine.deleteMany({ where: { workOrder: { diagnosticRequestId: { in: diagnosticIds } } } }).catch(() => undefined);
    await prisma.serviceAppointment.deleteMany({ where: { vehicleId: ids.vehicle } }).catch(() => undefined);
    await prisma.workOrder.deleteMany({ where: { diagnosticRequestId: { in: diagnosticIds } } }).catch(() => undefined);
    await prisma.diagnosticInspection.deleteMany({ where: { diagnosticRequestId: { in: diagnosticIds } } }).catch(() => undefined);
    await prisma.diagnosticReview.deleteMany({ where: { diagnosticRequestId: { in: diagnosticIds } } }).catch(() => undefined);
    await prisma.diagnosticAssignment.deleteMany({ where: { diagnosticRequestId: { in: diagnosticIds } } }).catch(() => undefined);
    const cards = await prisma.diagnosticCard.findMany({
      where: { diagnosticRequestId: { in: diagnosticIds } },
      select: { id: true },
    }).catch(() => []);
    const cardIds = cards.map((card) => card.id);
    if (cardIds.length) {
      await prisma.diagnosticCardRevision.deleteMany({ where: { diagnosticCardId: { in: cardIds } } }).catch(() => undefined);
      await prisma.auditEvent.deleteMany({ where: { entityId: { in: cardIds } } }).catch(() => undefined);
    }
    await prisma.diagnosticCard.deleteMany({ where: { diagnosticRequestId: { in: diagnosticIds } } }).catch(() => undefined);
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: diagnosticIds } } }).catch(() => undefined);
    await prisma.diagnosticRequest.deleteMany({ where: { id: { in: diagnosticIds } } }).catch(() => undefined);
  } else {
    await prisma.serviceAppointment.deleteMany({ where: { vehicleId: ids.vehicle } }).catch(() => undefined);
  }
  await prisma.vehicle.deleteMany({ where: { id: ids.vehicle } }).catch(() => undefined);
  await prisma.client.deleteMany({ where: { id: ids.client } }).catch(() => undefined);
  await prisma.serviceMechanic.deleteMany({ where: { id: ids.mechanic } }).catch(() => undefined);
  await prisma.servicePost.deleteMany({ where: { id: ids.post } }).catch(() => undefined);
  await prisma.serviceLocation.deleteMany({ where: { id: ids.location } }).catch(() => undefined);
}

async function main() {
  await cleanup();
  try {
    await prisma.serviceLocation.create({
      data: { id: ids.location, name: `Smoke station ${suffix}` },
    });
    await prisma.servicePost.create({
      data: { id: ids.post, locationId: ids.location, name: `Smoke post ${suffix}` },
    });
    await prisma.serviceMechanic.create({
      data: {
        id: ids.mechanic,
        locationId: ids.location,
        userId: ids.mechanicUser,
        name: `Smoke mechanic ${suffix}`,
      },
    });
    await prisma.client.create({
      data: { id: ids.client, name: "Smoke Client", phone, phoneNormalized: phone.replace(/\D/g, "") },
    });
    await prisma.vehicle.create({
      data: {
        id: ids.vehicle,
        clientId: ids.client,
        plateNumber: plate,
        plateNormalized: plate,
        brand: "Volvo",
        model: "S80",
        year: 2014,
        mileageKm: 180000,
      },
    });

    const plannedStartAt = nextDayAtUtcHour(1, 10);
    const plannedEndAt = new Date(plannedStartAt.getTime() + 60 * 60 * 1000);
    const firstAppointment = await prisma.serviceAppointment.create({
      data: {
        locationId: ids.location,
        postId: ids.post,
        mechanicId: ids.mechanic,
        clientId: ids.client,
        vehicleId: ids.vehicle,
        status: "BOOKED",
        customerName: "Smoke Client",
        phone,
        vehicleLabel: "Volvo S80 2014",
        plateNumber: plate,
        problem: "Smoke diagnostic flow",
        source: "CI_DIAGNOSTIC_SMOKE",
        plannedStartAt,
        plannedEndAt,
      },
    });

    const arrival = await arrivePlannerAppointment(firstAppointment.id, {});
    assert.equal(arrival.ok, true, "initial booked appointment must arrive");
    assert.equal(arrival.workflowAction.followupWorkVisit, false);
    assert(arrival.workflowAction.diagnosticRequestId, "arrival must create a diagnostic request");
    const diagnosticId = arrival.workflowAction.diagnosticRequestId;

    const diagnostic = await prisma.diagnosticRequest.findUnique({ where: { id: diagnosticId } });
    assert(diagnostic);
    assert.equal(diagnostic.status, DiagnosticRequestStatus.PENDING);

    const started = await startStructuredDiagnostic(ids.mechanicUser, diagnosticId);
    assert.equal(started.diagnostic.status, DiagnosticRequestStatus.IN_PROGRESS);
    assert(started.inspections.length > 0, "scan/start must create at least one structured inspection");

    const inspections = await prisma.diagnosticInspection.findMany({
      where: { diagnosticRequestId: diagnosticId },
      select: { id: true },
    });
    const inspectionIds = inspections.map((row) => row.id);
    const checkCount = await prisma.diagnosticCheck.count({ where: { inspectionId: { in: inspectionIds } } });
    assert(checkCount > 0, "structured diagnostic must contain checks");
    await prisma.diagnosticCheck.updateMany({
      where: { inspectionId: { in: inspectionIds } },
      data: { state: DiagnosticCheckState.OK, checkedAt: new Date() },
    });

    const submitted = await submitStructuredDiagnosticRespectingOptional(
      ids.mechanicUser,
      diagnosticId,
      "Smoke mechanic completed diagnostics",
    );
    assert.equal(submitted.diagnostic.review.state, "SUBMITTED");

    await assert.rejects(
      () => createWorkOrderFromConfirmedDiagnostic(diagnosticId),
      (error: unknown) => error instanceof WorkOrderHardGateError,
      "WorkOrder must remain blocked before diagnostic card confirmation",
    );

    assert.equal(
      await prisma.workOrder.count({ where: { diagnosticRequestId: diagnosticId } }),
      0,
      "submitting diagnostics must not auto-create WorkOrder",
    );

    const confirmed = await transitionDiagnostic(diagnosticId, {
      status: DiagnosticRequestStatus.CONFIRMED,
      technicalConclusion: "Smoke technical conclusion: vehicle may proceed to next routing step.",
      actorName: "CI / Service manager",
      reviewerUserId: `smoke_manager_${suffix}`,
    });
    assert.equal(confirmed.diagnostic.status, DiagnosticRequestStatus.CONFIRMED);
    assert.equal(
      await prisma.workOrder.count({ where: { diagnosticRequestId: diagnosticId } }),
      0,
      "creating the diagnostic card must not auto-create WorkOrder",
    );

    const report = await createDiagnosticReportShare(diagnosticId, `smoke_manager_${suffix}`);
    assert(report.token.length > 20, "diagnostic card must create a client share token");
    const diagnosticView = await getDiagnostic(diagnosticId);
    assert(diagnosticView);
    assert.equal(diagnosticView.workflowState, "CARD_SENT", "active report share must expose Надіслана ДК business state");

    const workOrder = await createWorkOrderFromConfirmedDiagnostic(diagnosticId);
    assert.equal(workOrder.diagnosticRequestId, diagnosticId);
    assert.equal(workOrder.status, "PARTS_REVIEW");

    const followupStart = nextDayAtUtcHour(3, 10);
    const followupEnd = new Date(followupStart.getTime() + 90 * 60 * 1000);
    const followup = await prisma.serviceAppointment.create({
      data: {
        locationId: ids.location,
        postId: ids.post,
        mechanicId: ids.mechanic,
        clientId: ids.client,
        vehicleId: ids.vehicle,
        workOrderId: workOrder.id,
        status: "BOOKED",
        customerName: "Smoke Client",
        phone,
        vehicleLabel: "Volvo S80 2014",
        plateNumber: plate,
        problem: "Follow-up repair after diagnostic card",
        comment: "Повторний візит після діагностичної карти",
        source: "DIAGNOSTIC_FOLLOWUP",
        plannedStartAt: followupStart,
        plannedEndAt: followupEnd,
      },
    });

    const secondArrival = await arrivePlannerAppointment(followup.id, {});
    assert.equal(secondArrival.ok, true, "follow-up appointment must arrive");
    assert.equal(secondArrival.workflowAction.followupWorkVisit, true, "follow-up visit must enter repair context");
    assert.equal(secondArrival.workflowAction.reusedDiagnostic, true);
    assert.equal(secondArrival.workflowAction.diagnosticRequestId, diagnosticId);
    assert.equal(secondArrival.workflowAction.workOrderId, workOrder.id);
    assert.equal(
      await prisma.diagnosticRequest.count({ where: { vehicleId: ids.vehicle } }),
      1,
      "repeat visit must not create a second diagnostic request",
    );

    console.log("Diagnostic workflow smoke: PASS");
    console.log(JSON.stringify({
      arrival: "BOOKED -> ARRIVED",
      diagnostic: "PENDING -> IN_PROGRESS -> SUBMITTED -> CONFIRMED -> CARD_SENT",
      workOrderGate: "blocked before confirmation, explicit after card",
      followupVisit: "reuses confirmed diagnostic and WorkOrder",
    }, null, 2));
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Diagnostic workflow smoke: FAIL", error);
  process.exitCode = 1;
});