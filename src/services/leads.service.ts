import {
  DiagnosticRequestStatus,
  LeadStatus,
  Prisma,
} from "@/src/generated/prisma/client";
import type { LeadPatchDto, LeadQuickFilter } from "@/src/dto/leads";
import { getPrisma } from "@/src/lib/prisma";

export class LeadNotFoundError extends Error {
  constructor(id: string) {
    super(`Lead not found: ${id}`);
    this.name = "LeadNotFoundError";
  }
}

export class LeadConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadConflictError";
  }
}

export class LeadBusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadBusinessRuleError";
  }
}

export type ListLeadsInput = {
  statuses?: LeadStatus[];
  assignedUserId?: string;
  quickFilter?: LeadQuickFilter;
};

function leadSlaMinutes(): number {
  const value = Number(process.env.LEAD_SLA_MINUTES || 15);
  return Number.isFinite(value) && value > 0 ? value : 15;
}

function endOfTodayUtc(now: Date): Date {
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

export async function listLeads(input: ListLeadsInput) {
  const prisma = getPrisma();
  const now = new Date();
  const and: Prisma.LeadWhereInput[] = [];

  if (input.statuses?.length) and.push({ status: { in: input.statuses } });
  if (input.assignedUserId) and.push({ assignedUserId: input.assignedUserId });

  if (input.quickFilter === "requires_attention") {
    const threshold = new Date(now.getTime() - leadSlaMinutes() * 60_000);
    and.push({ status: LeadStatus.NEW, createdAt: { lte: threshold } });
  }

  if (input.quickFilter === "follow_up_today") {
    and.push({ nextContactAt: { lte: endOfTodayUtc(now) } });
  }

  if (input.quickFilter === "junk") {
    and.push({
      status: {
        in: [LeadStatus.SPAM_WRONG, LeadStatus.SUPPLIER_PARTNER, LeadStatus.REJECTED],
      },
    });
  }

  const leads = await prisma.lead.findMany({
    where: and.length ? { AND: and } : undefined,
    include: {
      assignedUser: {
        select: { id: true, name: true, internalNumber: true, isActive: true },
      },
      _count: { select: { calls: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 250,
  });

  return {
    leads,
    meta: {
      count: leads.length,
      slaMinutes: leadSlaMinutes(),
      quickFilter: input.quickFilter || null,
    },
  };
}

export async function updateLead(id: string, dto: LeadPatchDto) {
  const prisma = getPrisma();
  const current = await prisma.lead.findUnique({ where: { id } });
  if (!current) throw new LeadNotFoundError(id);

  if (dto.assignedUserId) {
    const assignee = await prisma.user.findUnique({ where: { id: dto.assignedUserId } });
    if (!assignee || !assignee.isActive) {
      throw new LeadBusinessRuleError("assignedUserId must reference an active user");
    }
  }

  const nextStatus = dto.status ?? current.status;
  const nextContactAt = dto.nextContactAt === undefined ? current.nextContactAt : dto.nextContactAt;
  const nextRejectReason = dto.rejectReason === undefined ? current.rejectReason : dto.rejectReason;

  if (nextStatus === LeadStatus.WARM_LEAD && !nextContactAt) {
    throw new LeadBusinessRuleError("WARM_LEAD requires nextContactAt");
  }
  if (nextStatus === LeadStatus.REJECTED && !nextRejectReason) {
    throw new LeadBusinessRuleError("REJECTED requires rejectReason");
  }

  const data: Prisma.LeadUncheckedUpdateInput = { ...dto };

  if (
    dto.status &&
    dto.rejectReason === undefined &&
    dto.status !== LeadStatus.REJECTED &&
    dto.status !== LeadStatus.SPAM_WRONG
  ) {
    data.rejectReason = null;
  }

  if (dto.status && dto.status !== LeadStatus.WARM_LEAD && dto.nextContactAt === undefined) {
    data.nextContactAt = null;
  }

  return prisma.lead.update({
    where: { id },
    data,
    include: {
      assignedUser: {
        select: { id: true, name: true, internalNumber: true, isActive: true },
      },
      _count: { select: { calls: true } },
    },
  });
}

/**
 * ARRIVED conversion obeys Hard Gate #1:
 * Lead -> Client + Vehicle + DiagnosticRequest.
 * A WorkOrder is deliberately NOT created here.
 */
export async function convertLead(id: string) {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id } });
    if (!lead) throw new LeadNotFoundError(id);
    if (lead.status === LeadStatus.ARRIVED) {
      throw new LeadConflictError("Lead is already converted/arrived");
    }

    const client = await tx.client.upsert({
      where: { phoneNormalized: lead.phoneNormalized },
      create: {
        name: lead.name,
        phone: lead.phone,
        phoneNormalized: lead.phoneNormalized,
      },
      update: {
        name: lead.name || undefined,
        phone: lead.phone,
      },
    });

    let vehicle;
    if (lead.vin) {
      const byVin = await tx.vehicle.findUnique({ where: { vin: lead.vin } });
      if (byVin && byVin.clientId !== client.id) {
        throw new LeadConflictError("VIN is already linked to another client");
      }

      vehicle = byVin || (await tx.vehicle.create({
        data: {
          clientId: client.id,
          brand: lead.carBrand,
          model: lead.carModel,
          vin: lead.vin,
        },
      }));
    } else {
      vehicle = await tx.vehicle.create({
        data: {
          clientId: client.id,
          brand: lead.carBrand,
          model: lead.carModel,
        },
      });
    }

    const diagnosticRequest = await tx.diagnosticRequest.create({
      data: {
        clientId: client.id,
        vehicleId: vehicle.id,
        leadId: lead.id,
        status: DiagnosticRequestStatus.PENDING,
      },
    });

    const movedCalls = await tx.callHistory.updateMany({
      where: { leadId: lead.id },
      data: {
        leadId: null,
        clientId: client.id,
        workOrderId: null,
      },
    });

    const updatedLead = await tx.lead.update({
      where: { id: lead.id },
      data: {
        status: LeadStatus.ARRIVED,
        nextContactAt: null,
      },
    });

    return {
      lead: updatedLead,
      client,
      vehicle,
      diagnosticRequest,
      workOrder: null,
      movedCallCount: movedCalls.count,
      hardGate: {
        code: "WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS",
        passed: false,
        nextRequiredStatus: DiagnosticRequestStatus.CONFIRMED,
      },
    };
  });
}
