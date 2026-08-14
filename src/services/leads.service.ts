import { DiagnosticRequestStatus, LeadStatus, Prisma } from "@/src/generated/prisma/client";
import type { LeadPatchDto, LeadQuickFilter } from "@/src/dto/leads";
import { normalizeLegacyLeadStatus } from "@/src/domain/workflow/lead";
import { getPrisma } from "@/src/lib/prisma";

export class LeadNotFoundError extends Error {
  constructor(id: string) { super(`Lead not found: ${id}`); this.name = "LeadNotFoundError"; }
}
export class LeadConflictError extends Error {
  constructor(message: string) { super(message); this.name = "LeadConflictError"; }
}
export class LeadBusinessRuleError extends Error {
  constructor(message: string) { super(message); this.name = "LeadBusinessRuleError"; }
}

export type ListLeadsInput = { statuses?: LeadStatus[]; assignedUserId?: string; quickFilter?: LeadQuickFilter };

function leadSlaMinutes(): number {
  const value = Number(process.env.LEAD_SLA_MINUTES || 120);
  return Number.isFinite(value) && value > 0 ? value : 120;
}
function endOfTodayUtc(now: Date): Date { const end = new Date(now); end.setUTCHours(23, 59, 59, 999); return end; }
function jsonSafe(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function normalizeLead<T extends { status: LeadStatus }>(lead: T) { return { ...lead, status: normalizeLegacyLeadStatus(lead.status) }; }

export async function listLeads(input: ListLeadsInput) {
  const prisma = getPrisma();
  const now = new Date();
  const and: Prisma.LeadWhereInput[] = [];
  if (input.statuses?.length) and.push({ status: { in: input.statuses } });
  if (input.assignedUserId) and.push({ assignedUserId: input.assignedUserId });
  if (input.quickFilter === "requires_attention") {
    const threshold = new Date(now.getTime() - leadSlaMinutes() * 60_000);
    and.push({ status: { in: [LeadStatus.NEW, LeadStatus.NO_ANSWER] }, lastActivityAt: { lte: threshold } });
  }
  if (input.quickFilter === "follow_up_today") and.push({ nextContactAt: { lte: endOfTodayUtc(now) } });
  if (input.quickFilter === "junk") and.push({ status: { in: [LeadStatus.SPAM_WRONG, LeadStatus.SUPPLIER_PARTNER, LeadStatus.REJECTED, LeadStatus.LOST] } });

  const [leads, users] = await Promise.all([
    prisma.lead.findMany({
      where: and.length ? { AND: and } : undefined,
      include: { assignedUser: { select: { id: true, name: true, internalNumber: true, isActive: true } }, _count: { select: { calls: true } } },
      orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
      take: 500,
    }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, internalNumber: true }, orderBy: { name: "asc" } }),
  ]);

  return { leads: leads.map(normalizeLead), users, meta: { count: leads.length, slaMinutes: leadSlaMinutes(), quickFilter: input.quickFilter || null, serverTime: now.toISOString() } };
}

export async function updateLead(id: string, dto: LeadPatchDto, actorName = "CRM") {
  const prisma = getPrisma();
  const current = await prisma.lead.findUnique({ where: { id } });
  if (!current) throw new LeadNotFoundError(id);

  if (dto.assignedUserId) {
    const assignee = await prisma.user.findUnique({ where: { id: dto.assignedUserId } });
    if (!assignee || !assignee.isActive) throw new LeadBusinessRuleError("assignedUserId must reference an active user");
  }

  const nextStatus = dto.status ?? normalizeLegacyLeadStatus(current.status);
  const nextRejectReason = dto.rejectReason === undefined ? current.rejectReason : dto.rejectReason;
  if (nextStatus === LeadStatus.LOST && !nextRejectReason) dto.rejectReason = current.rejectReason ?? undefined;

  const data: Prisma.LeadUncheckedUpdateInput = { ...dto, lastActivityAt: new Date() };
  const rejectedStatuses = new Set<LeadStatus>([LeadStatus.LOST, LeadStatus.REJECTED, LeadStatus.SPAM_WRONG]);
  if (dto.status && !rejectedStatuses.has(dto.status) && dto.rejectReason === undefined) data.rejectReason = null;

  const updated = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.update({
      where: { id },
      data,
      include: { assignedUser: { select: { id: true, name: true, internalNumber: true, isActive: true } }, _count: { select: { calls: true } } },
    });
    await tx.auditEvent.create({ data: { actorName, entityType: "Lead", entityId: id, action: "UPDATE", before: jsonSafe(current), after: jsonSafe(lead) } });
    return lead;
  });
  return normalizeLead(updated);
}

export async function incrementLeadAttempt(id: string, actorName = "CRM") {
  const prisma = getPrisma();
  const current = await prisma.lead.findUnique({ where: { id } });
  if (!current) throw new LeadNotFoundError(id);
  const nextAttempts = Math.min(99, current.contactAttempts + 1);
  const normalized = normalizeLegacyLeadStatus(current.status);
  const status = normalized === LeadStatus.NEW ? LeadStatus.CONTACTED : normalized;
  return updateLead(id, { contactAttempts: nextAttempts, status, nextAction: nextAttempts >= 3 ? "Визначити результат контакту" : "Наступна спроба контакту" }, actorName);
}

/** ARRIVED conversion obeys Hard Gate #1: Lead -> Client + Vehicle + DiagnosticRequest. WorkOrder is NOT created here. */
export async function convertLead(id: string) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id } });
    if (!lead) throw new LeadNotFoundError(id);
    if (lead.status === LeadStatus.ARRIVED) throw new LeadConflictError("Lead is already converted/arrived");

    const client = await tx.client.upsert({
      where: { phoneNormalized: lead.phoneNormalized },
      create: { name: lead.name, phone: lead.phone, phoneNormalized: lead.phoneNormalized },
      update: { name: lead.name || undefined, phone: lead.phone },
    });

    let vehicle;
    if (lead.vin) {
      const byVin = await tx.vehicle.findUnique({ where: { vin: lead.vin } });
      if (byVin && byVin.clientId !== client.id) throw new LeadConflictError("VIN is already linked to another client");
      vehicle = byVin || await tx.vehicle.create({
        data: {
          clientId: client.id,
          brand: lead.carBrand,
          model: lead.carModel,
          year: lead.carYear,
          plateNumber: lead.plateNumber,
          plateNormalized: lead.plateNumber?.replace(/[^A-ZА-ЯІЇЄ0-9]/gi, "").toUpperCase() || null,
          vin: lead.vin,
        },
      });
    } else {
      const normalizedPlate = lead.plateNumber?.replace(/[^A-ZА-ЯІЇЄ0-9]/gi, "").toUpperCase() || null;
      const byPlate = normalizedPlate ? await tx.vehicle.findFirst({ where: { plateNormalized: normalizedPlate } }) : null;
      if (byPlate && byPlate.clientId !== client.id) throw new LeadConflictError("Plate is already linked to another client");
      vehicle = byPlate || await tx.vehicle.create({ data: { clientId: client.id, brand: lead.carBrand, model: lead.carModel, year: lead.carYear, plateNumber: lead.plateNumber, plateNormalized: normalizedPlate } });
    }

    const diagnosticRequest = await tx.diagnosticRequest.create({ data: { clientId: client.id, vehicleId: vehicle.id, leadId: lead.id, status: DiagnosticRequestStatus.PENDING } });
    const movedCalls = await tx.callHistory.updateMany({ where: { leadId: lead.id }, data: { leadId: null, clientId: client.id, workOrderId: null } });
    const updatedLead = await tx.lead.update({ where: { id: lead.id }, data: { status: LeadStatus.ARRIVED, nextContactAt: null, nextAction: "Провести діагностику", lastActivityAt: new Date() } });
    await tx.auditEvent.create({ data: { actorName: "CRM", entityType: "Lead", entityId: lead.id, action: "ARRIVED_CONVERSION", before: jsonSafe(lead), after: jsonSafe(updatedLead), metadata: jsonSafe({ clientId: client.id, vehicleId: vehicle.id, diagnosticRequestId: diagnosticRequest.id }) } });

    return { lead: updatedLead, client, vehicle, diagnosticRequest, workOrder: null, movedCallCount: movedCalls.count, hardGate: { code: "WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS", passed: false, nextRequiredStatus: DiagnosticRequestStatus.CONFIRMED } };
  });
}
