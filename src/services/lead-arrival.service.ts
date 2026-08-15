import { DiagnosticRequestStatus, LeadStatus, Prisma } from "@/src/generated/prisma/client";

export class LeadArrivalNotFoundError extends Error {
  constructor(id: string) {
    super(`Lead not found: ${id}`);
    this.name = "LeadArrivalNotFoundError";
  }
}

export class LeadArrivalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadArrivalConflictError";
  }
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizePlate(value: string | null) {
  return value?.replace(/[^A-ZА-ЯІЇЄ0-9]/gi, "").toUpperCase() || null;
}

/**
 * Converts a lead into the service intake contour inside the caller transaction.
 * The advisory lock makes the conversion idempotent across parallel ARRIVED requests.
 */
export async function ensureLeadArrivalInTransaction(
  tx: Prisma.TransactionClient,
  leadId: string,
  actorName = "CRM / Планувальник",
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`lead-arrival:${leadId}`}))`;

  const lead = await tx.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new LeadArrivalNotFoundError(leadId);

  const existingDiagnostic = await tx.diagnosticRequest.findFirst({
    where: { leadId },
    orderBy: { createdAt: "desc" },
    include: { client: true, vehicle: true },
  });

  if (existingDiagnostic) {
    const movedCalls = await tx.callHistory.updateMany({
      where: { leadId },
      data: { leadId: null, clientId: existingDiagnostic.clientId, workOrderId: null },
    });

    const updatedLead = lead.status === LeadStatus.ARRIVED
      ? lead
      : await tx.lead.update({
          where: { id: leadId },
          data: {
            status: LeadStatus.ARRIVED,
            nextContactAt: null,
            nextAction: "Провести діагностику",
            lastActivityAt: new Date(),
          },
        });

    if (lead.status !== LeadStatus.ARRIVED) {
      await tx.auditEvent.create({
        data: {
          actorName,
          entityType: "Lead",
          entityId: leadId,
          action: "ARRIVED_CONVERSION_REUSED_DIAGNOSTIC",
          before: jsonSafe(lead),
          after: jsonSafe(updatedLead),
          metadata: jsonSafe({
            clientId: existingDiagnostic.clientId,
            vehicleId: existingDiagnostic.vehicleId,
            diagnosticRequestId: existingDiagnostic.id,
          }),
        },
      });
    }

    return {
      lead: updatedLead,
      client: existingDiagnostic.client,
      vehicle: existingDiagnostic.vehicle,
      diagnosticRequest: existingDiagnostic,
      workOrder: null,
      movedCallCount: movedCalls.count,
      reusedDiagnostic: true,
      hardGate: {
        code: "WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS",
        passed: existingDiagnostic.status === DiagnosticRequestStatus.CONFIRMED,
        nextRequiredStatus: DiagnosticRequestStatus.CONFIRMED,
      },
    };
  }

  const client = await tx.client.upsert({
    where: { phoneNormalized: lead.phoneNormalized },
    create: { name: lead.name, phone: lead.phone, phoneNormalized: lead.phoneNormalized },
    update: { name: lead.name || undefined, phone: lead.phone },
  });

  let vehicle;
  if (lead.vin) {
    const byVin = await tx.vehicle.findUnique({ where: { vin: lead.vin } });
    if (byVin && byVin.clientId !== client.id) {
      throw new LeadArrivalConflictError("VIN уже прив'язаний до іншого клієнта. Потрібна ручна перевірка.");
    }
    vehicle = byVin || await tx.vehicle.create({
      data: {
        clientId: client.id,
        brand: lead.carBrand,
        model: lead.carModel,
        year: lead.carYear,
        plateNumber: lead.plateNumber,
        plateNormalized: normalizePlate(lead.plateNumber),
        vin: lead.vin,
      },
    });
  } else {
    const plateNormalized = normalizePlate(lead.plateNumber);
    const byPlate = plateNormalized
      ? await tx.vehicle.findFirst({ where: { plateNormalized } })
      : null;
    if (byPlate && byPlate.clientId !== client.id) {
      throw new LeadArrivalConflictError("Держномер уже прив'язаний до іншого клієнта. Потрібна ручна перевірка.");
    }
    vehicle = byPlate || await tx.vehicle.create({
      data: {
        clientId: client.id,
        brand: lead.carBrand,
        model: lead.carModel,
        year: lead.carYear,
        plateNumber: lead.plateNumber,
        plateNormalized,
      },
    });
  }

  const diagnosticRequest = await tx.diagnosticRequest.create({
    data: {
      clientId: client.id,
      vehicleId: vehicle.id,
      leadId,
      status: DiagnosticRequestStatus.PENDING,
    },
  });

  const movedCalls = await tx.callHistory.updateMany({
    where: { leadId },
    data: { leadId: null, clientId: client.id, workOrderId: null },
  });

  const updatedLead = await tx.lead.update({
    where: { id: leadId },
    data: {
      status: LeadStatus.ARRIVED,
      nextContactAt: null,
      nextAction: "Провести діагностику",
      lastActivityAt: new Date(),
    },
  });

  await tx.auditEvent.create({
    data: {
      actorName,
      entityType: "Lead",
      entityId: leadId,
      action: "ARRIVED_CONVERSION",
      before: jsonSafe(lead),
      after: jsonSafe(updatedLead),
      metadata: jsonSafe({ clientId: client.id, vehicleId: vehicle.id, diagnosticRequestId: diagnosticRequest.id }),
    },
  });

  return {
    lead: updatedLead,
    client,
    vehicle,
    diagnosticRequest,
    workOrder: null,
    movedCallCount: movedCalls.count,
    reusedDiagnostic: false,
    hardGate: {
      code: "WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS",
      passed: false,
      nextRequiredStatus: DiagnosticRequestStatus.CONFIRMED,
    },
  };
}
