import { LeadStatus, RejectReason } from "@/src/generated/prisma/client";

export type LeadQuickFilter = "requires_attention" | "follow_up_today" | "junk";

export type LeadPatchDto = {
  status?: LeadStatus;
  assignedUserId?: string | null;
  rejectReason?: RejectReason | null;
  carBrand?: string | null;
  carModel?: string | null;
  carYear?: number | null;
  plateNumber?: string | null;
  vin?: string | null;
  need?: string | null;
  comment?: string | null;
  nextAction?: string | null;
  nextContactAt?: Date | null;
  contactAttempts?: number;
  preliminaryAmount?: number | null;
};

export class LeadDtoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadDtoError";
  }
}

const LEAD_STATUSES = new Set(Object.values(LeadStatus));
const REJECT_REASONS = new Set(Object.values(RejectReason));
const QUICK_FILTERS = new Set<LeadQuickFilter>(["requires_attention", "follow_up_today", "junk"]);

function cleanNullableString(value: unknown, field: string, maxLength = 500): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new LeadDtoError(`${field} must be a string or null`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw new LeadDtoError(`${field} is too long`);
  return trimmed;
}

function parseNullableNumber(value: unknown, field: string): number | null {
  if (value === null || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(number) || number < 0) throw new LeadDtoError(`${field} must be a positive number or null`);
  return number;
}

export function parseLeadStatus(value: unknown): LeadStatus {
  if (typeof value !== "string" || !LEAD_STATUSES.has(value as LeadStatus)) throw new LeadDtoError("Invalid lead status");
  return value as LeadStatus;
}

export function parseRejectReason(value: unknown): RejectReason | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !REJECT_REASONS.has(value as RejectReason)) throw new LeadDtoError("Invalid rejectReason");
  return value as RejectReason;
}

export function parseQuickFilter(value: string | null): LeadQuickFilter | undefined {
  if (!value) return undefined;
  if (!QUICK_FILTERS.has(value as LeadQuickFilter)) throw new LeadDtoError("Invalid quickFilter");
  return value as LeadQuickFilter;
}

export function parseStatusFilter(value: string | null): LeadStatus[] | undefined {
  if (!value) return undefined;
  const statuses = value.split(",").map((item) => item.trim()).filter(Boolean).map(parseLeadStatus);
  return statuses.length ? statuses : undefined;
}

export function parseLeadPatchDto(body: unknown): LeadPatchDto {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new LeadDtoError("Request body must be an object");
  const input = body as Record<string, unknown>;
  const output: LeadPatchDto = {};

  if ("status" in input) output.status = parseLeadStatus(input.status);
  if ("assignedUserId" in input) output.assignedUserId = cleanNullableString(input.assignedUserId, "assignedUserId", 100);
  if ("rejectReason" in input) output.rejectReason = parseRejectReason(input.rejectReason);
  if ("carBrand" in input) output.carBrand = cleanNullableString(input.carBrand, "carBrand", 100);
  if ("carModel" in input) output.carModel = cleanNullableString(input.carModel, "carModel", 100);
  if ("carYear" in input) output.carYear = parseNullableNumber(input.carYear, "carYear");
  if ("plateNumber" in input) output.plateNumber = cleanNullableString(input.plateNumber, "plateNumber", 24)?.toUpperCase() || null;
  if ("vin" in input) output.vin = cleanNullableString(input.vin, "vin", 50)?.toUpperCase() || null;
  if ("need" in input) output.need = cleanNullableString(input.need, "need", 5000);
  if ("comment" in input) output.comment = cleanNullableString(input.comment, "comment", 5000);
  if ("nextAction" in input) output.nextAction = cleanNullableString(input.nextAction, "nextAction", 2000);
  if ("contactAttempts" in input) {
    const attempts = Number(input.contactAttempts);
    if (!Number.isInteger(attempts) || attempts < 0 || attempts > 99) throw new LeadDtoError("Invalid contactAttempts");
    output.contactAttempts = attempts;
  }
  if ("preliminaryAmount" in input) output.preliminaryAmount = parseNullableNumber(input.preliminaryAmount, "preliminaryAmount");

  if ("nextContactAt" in input) {
    if (input.nextContactAt === null || input.nextContactAt === "") output.nextContactAt = null;
    else if (typeof input.nextContactAt === "string" || typeof input.nextContactAt === "number") {
      const parsed = new Date(input.nextContactAt);
      if (Number.isNaN(parsed.getTime())) throw new LeadDtoError("Invalid nextContactAt");
      output.nextContactAt = parsed;
    } else throw new LeadDtoError("nextContactAt must be a date string, timestamp, or null");
  }

  return output;
}
