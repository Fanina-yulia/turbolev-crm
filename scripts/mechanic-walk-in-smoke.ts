import assert from "node:assert/strict";
import { DiagnosticCheckState } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/lib/prisma";
import { submitStructuredDiagnosticRespectingOptional } from "@/src/services/diagnostic-completeness.service";
import { startMechanicWalkInDiagnostic } from "@/src/services/mechanic-walk-in.service";
import {
  chooseWalkInPostPaymentRoute,
  markWalkInDiagnosticCompleted,
  payWalkInDiagnostic,
} from "@/src/services/walk-in-diagnostic-settlement.service";

const prisma = getPrisma();

export async function runMechanicWalkInSmoke() {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const locationId = `walkin_loc_${suffix}`;
  const mechanicId = `walkin_mech_${suffix}`;
  const mechanicUserId = `walkin_user_${suffix}`;
  const priceItemId = `walkin_price_${suffix}`;
  const cashAccountId = `walkin_cash_${suffix}`;
  const onlineAccountId = `walkin_online_${suffix}`;
  const existingClientId = `walkin_client_${suffix}`;
  const existingClientPhoneId = `walkin_phone_${suffix}`;
  const diagnosticIds: string[] = [];
  const appointmentIds: string[] = [];
  const clientIds: string[] = [];
  const vehicleIds: string[] = [];

  async function cleanup() {
    for (const diagnosticId of diagnosticIds) {
      const inspections = await prisma.diagnosticInspection.findMany({ where: { diagnosticRequestId: diagnosticId }, select: { id: true } }).catch(() => []);
      const inspectionIds = inspections.map((row) => row.id);
      const checks = inspectionIds.length ? await prisma.diagnosticCheck.findMany({ where: { inspectionId: { in: inspectionIds } }, select: { id: true } }).catch(() => []) : [];
      const checkIds = checks.map((row) => row.id);
      const findings = checkIds.length ? await prisma.diagnosticFinding.findMany({ where: { checkId: { in: checkIds } }, select: { id: true } }).catch(() => []) : [];
      const findingIds = findings.map((row) => row.id);
      if (findingIds.length) await prisma.diagnosticMedia.deleteMany({ where: { findingId: { in: findingIds } } }).catch(() => undefined);
      if (checkIds.length) await prisma.diagnosticFinding.deleteMany({ where: { checkId: { in: checkIds } } }).catch(() => undefined);
      if (inspectionIds.length) await prisma.diagnosticCheck.deleteMany({ where: { inspectionId: { in: inspectionIds } } }).catch(() => undefined);
      await prisma.diagnosticInspection.deleteMany({ where: { diagnosticRequestId: diagnosticId } }).catch(() => undefined);
      await prisma.diagnosticReview.deleteMany({ where: { diagnosticRequestId: diagnosticId } }).catch(() => undefined);
      await prisma.diagnosticAssignment.deleteMany({ where: { diagnosticRequestId: diagnosticId } }).catch(() => undefined);
      await prisma.diagnosticReportShare.deleteMany({ where: { diagnosticRequestId: diagnosticId } }).catch(() => undefined);
      await prisma.cashTransaction.deleteMany({ where: { sourceEntity: "WALK_IN_DIAGNOSTIC_PAYMENT", sourceEntityId: `${diagnosticId}:payment` } }).catch(() => undefined);
      await prisma.financialObligation.deleteMany({ where: { sourceEntity: "WALK_IN_DIAGNOSTIC", sourceEntityId: `${diagnosticId}:receivable` } }).catch(() => undefined);
      await prisma.financialEvent.deleteMany({ where: { sourceEntity: "WALK_IN_DIAGNOSTIC", sourceEntityId: `${diagnosticId}:revenue` } }).catch(() => undefined);
      const card = await prisma.diagnosticCard.findUnique({ where: { diagnosticRequestId: diagnosticId }, select: { id: true } }).catch(() => null);
      if (card) {
        await prisma.diagnosticCardRevision.deleteMany({ where: { diagnosticCardId: card.id } }).catch(() => undefined);
        await prisma.diagnosticCard.deleteMany({ where: { id: card.id } }).catch(() => undefined);
      }
      await prisma.auditEvent.deleteMany({ where: { entityId: diagnosticId } }).catch(() => undefined);
      await prisma.diagnosticRequest.deleteMany({ where: { id: diagnosticId } }).catch(() => undefined);
    }
    if (appointmentIds.length) {
      await prisma.auditEvent.deleteMany({ where: { entityId: { in: appointmentIds } } }).catch(() => undefined);
      await prisma.serviceAppointment.deleteMany({ where: { id: { in: appointmentIds } } }).catch(() => undefined);
    }
    if (vehicleIds.length) await prisma.vehicle.deleteMany({ where: { id: { in: vehicleIds } } }).catch(() => undefined);
    await prisma.clientPhone.deleteMany({ where: { id: existingClientPhoneId } }).catch(() => undefined);
    const uniqueClientIds = Array.from(new Set([...clientIds, existingClientId]));
    if (uniqueClientIds.length) await prisma.client.deleteMany({ where: { id: { in: uniqueClientIds } } }).catch(() => undefined);
    await prisma.moneyAccount.deleteMany({ where: { id: { in: [cashAccountId, onlineAccountId] } } }).catch(() => undefined);
    await prisma.serviceCatalogItem.deleteMany({ where: { id: priceItemId } }).catch(() => undefined);
    await prisma.serviceMechanic.deleteMany({ where: { id: mechanicId } }).catch(() => undefined);
    await prisma.serviceLocation.deleteMany({ where: { id: locationId } }).catch(() => undefined);
  }

  async function runOne(input: {
    plate: string;
    phone: string;
    name: string;
    mileage: number;
    paymentMethod: "CASH" | "ONLINE";
    route: "COMPLETE_VISIT" | "SEND_TO_REPAIR_FLOW";
    expectedClientId?: string;
  }) {
    const created = await startMechanicWalkInDiagnostic(mechanicUserId, {
      plate: input.plate,
      phone: input.phone,
      clientName: input.name,
      mileageKm: input.mileage,
      problem: "CI WALK-IN: перевірити ходову",
    });
    diagnosticIds.push(created.diagnosticRequestId);
    appointmentIds.push(created.appointmentId);
    clientIds.push(created.clientId);
    vehicleIds.push(created.vehicleId);

    assert.equal(created.walkIn, true);
    assert.equal(created.diagnosticStarted, true);
    if (input.expectedClientId) assert.equal(created.clientId, input.expectedClientId, "additional client phone must reuse the existing client");
    const appointment = await prisma.serviceAppointment.findUnique({ where: { id: created.appointmentId } });
    assert(appointment);
    assert.equal(appointment.source, "WALK_IN");
    assert.equal(appointment.status, "DIAGNOSTICS");
    assert.equal(appointment.postId, null, "walk-in can begin diagnostics without a post");
    assert.equal(appointment.mechanicId, mechanicId);
    assert.equal(appointment.phone, input.phone, "walk-in visit keeps the phone actually provided at intake");

    const duplicate = await startMechanicWalkInDiagnostic(mechanicUserId, {
      plate: input.plate,
      phone: input.phone,
      clientName: input.name,
      mileageKm: input.mileage,
      problem: "duplicate click",
    });
    assert.equal(duplicate.diagnosticRequestId, created.diagnosticRequestId, "double submit must reuse diagnostic");
    assert.equal(duplicate.appointmentId, created.appointmentId, "double submit must reuse active walk-in appointment");
    assert.equal(await prisma.serviceAppointment.count({ where: { id: created.appointmentId } }), 1);
    assert.equal(await prisma.diagnosticRequest.count({ where: { id: created.diagnosticRequestId } }), 1);

    const inspections = await prisma.diagnosticInspection.findMany({ where: { diagnosticRequestId: created.diagnosticRequestId }, select: { id: true } });
    assert(inspections.length > 0, "walk-in start must create structured inspections");
    await prisma.diagnosticCheck.updateMany({
      where: { inspectionId: { in: inspections.map((row) => row.id) } },
      data: { state: DiagnosticCheckState.OK, checkedAt: new Date() },
    });
    const submitted = await submitStructuredDiagnosticRespectingOptional(mechanicUserId, created.diagnosticRequestId, "CI WALK-IN complete");
    assert.equal(submitted.diagnostic.review.state, "SUBMITTED");
    const reviewCard = await prisma.diagnosticCard.findUnique({
      where: { diagnosticRequestId: created.diagnosticRequestId },
      include: { revisions: { orderBy: { revision: "asc" } } },
    });
    assert(reviewCard, "walk-in submit must create the standard DiagnosticCard");
    assert(reviewCard.revisions.some((revision) => revision.kind === "REVIEW"), "walk-in submit must create a REVIEW card revision");
    await markWalkInDiagnosticCompleted(mechanicUserId, created.diagnosticRequestId);

    const waiting = await prisma.serviceAppointment.findUnique({ where: { id: created.appointmentId } });
    assert.equal(waiting?.status, "WAITING_PAYMENT");
    assert.equal(await prisma.workOrder.count({ where: { diagnosticRequestId: created.diagnosticRequestId } }), 0, "walk-in submit/payment gate must not create WorkOrder");

    const paid = await payWalkInDiagnostic(mechanicUserId, created.diagnosticRequestId, input.paymentMethod);
    assert.equal(paid.paid, true);
    assert(paid.payment, "payment must create a posted CashTransaction");
    assert.equal(paid.payment?.account?.type, input.paymentMethod === "CASH" ? "CASH" : "ACQUIRING");
    assert.equal(await prisma.cashTransaction.count({ where: { sourceEntity: "WALK_IN_DIAGNOSTIC_PAYMENT", sourceEntityId: `${created.diagnosticRequestId}:payment`, status: "POSTED" } }), 1);

    await chooseWalkInPostPaymentRoute(mechanicUserId, created.diagnosticRequestId, input.route);
    const routed = await prisma.serviceAppointment.findUnique({ where: { id: created.appointmentId } });
    assert.equal(routed?.status, input.route === "COMPLETE_VISIT" ? "COMPLETED" : "WAITING_CALCULATION");
    assert.equal(await prisma.workOrder.count({ where: { diagnosticRequestId: created.diagnosticRequestId } }), 0, "repair handoff must preserve confirmed-card WorkOrder hard gate");
  }

  await cleanup();
  try {
    await prisma.serviceLocation.create({ data: { id: locationId, name: `Walk-in smoke ${suffix}` } });
    await prisma.serviceMechanic.create({ data: { id: mechanicId, locationId, userId: mechanicUserId, name: `Walk-in mechanic ${suffix}` } });
    await prisma.serviceCatalogItem.create({
      data: {
        id: priceItemId,
        source: "MANUAL",
        code: "DIAGNOSTIC_BASE",
        internalName: `CI walk-in diagnostic ${suffix}`,
        displayName: "Позапланова діагностика",
        itemType: "DIAGNOSTIC",
        basePrice: 600,
        currency: "UAH",
        isActive: true,
        showToOperator: true,
        reviewStatus: "READY",
      },
    });
    await prisma.moneyAccount.createMany({
      data: [
        { id: cashAccountId, name: `CI cash ${suffix}`, type: "CASH", currency: "UAH", locationId, isActive: true, sortOrder: 1 },
        { id: onlineAccountId, name: `CI acquiring ${suffix}`, type: "ACQUIRING", currency: "UAH", locationId, isActive: true, sortOrder: 1 },
      ],
    });

    const primaryPhone = `+38050${String(Date.now()).slice(-7)}`;
    const additionalPhone = `+38067${String(Date.now() + 11).slice(-7)}`;
    await prisma.client.create({
      data: {
        id: existingClientId,
        name: "Existing Walk In Client",
        phone: primaryPhone,
        phoneNormalized: primaryPhone.replace(/\D/g, ""),
      },
    });
    await prisma.clientPhone.create({
      data: {
        id: existingClientPhoneId,
        clientId: existingClientId,
        phone: additionalPhone,
        phoneNormalized: additionalPhone.replace(/\D/g, ""),
        label: "Додатковий",
        isPrimary: false,
      },
    });

    await runOne({
      plate: `WI${String(Date.now()).slice(-6)}`,
      phone: additionalPhone,
      name: "Should Not Duplicate",
      mileage: 123456,
      paymentMethod: "CASH",
      route: "SEND_TO_REPAIR_FLOW",
      expectedClientId: existingClientId,
    });
    await runOne({
      plate: `WO${String(Date.now() + 1).slice(-6)}`,
      phone: `+38068${String(Date.now() + 1).slice(-7)}`,
      name: "Walk In Online",
      mileage: 65432,
      paymentMethod: "ONLINE",
      route: "COMPLETE_VISIT",
    });

    console.log("Mechanic walk-in diagnostic smoke: PASS");
    console.log(JSON.stringify({
      intake: "scan/no booking -> WALK_IN -> client/vehicle/appointment -> diagnostic",
      clientDedup: "primary and additional phone identities reuse Client",
      idempotency: "double submit reuses appointment and diagnostic",
      diagnosticCard: "submit creates standard REVIEW revision",
      payment: "cash and online create diagnostic CashTransaction",
      hardGate: "no WorkOrder before confirmed diagnostic card",
      routes: "complete visit or send to repair calculation",
    }, null, 2));
  } finally {
    await cleanup();
  }
}

runMechanicWalkInSmoke()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error("Mechanic walk-in diagnostic smoke: FAIL", error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
