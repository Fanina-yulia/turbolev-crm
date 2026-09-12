/**
 * Warranty claims are a separate after-sales workflow.
 *
 * WorkOrder warranty terms describe eligibility; WarrantyClaim describes a
 * customer's post-repair request. Keeping these codes in one data-only
 * contract prevents UI/API drift and makes transition rules testable.
 */

export const WARRANTY_CLAIM_STATUS_CODES = [
  "OPEN",
  "REVIEW",
  "APPROVED",
  "REJECTED",
  "CLOSED",
] as const;

export type WarrantyClaimStatusCode = (typeof WARRANTY_CLAIM_STATUS_CODES)[number];

export const WARRANTY_CLAIM_STATUS_LABELS: Readonly<Record<WarrantyClaimStatusCode, string>> = {
  OPEN: "Нове",
  REVIEW: "На перевірці",
  APPROVED: "Погоджено",
  REJECTED: "Відхилено",
  CLOSED: "Закрито",
};

export const WARRANTY_CLAIM_TERMINAL_STATUS_CODES = [
  "REJECTED",
  "CLOSED",
] as const satisfies readonly WarrantyClaimStatusCode[];

export const WARRANTY_CLAIM_TRANSITIONS: Readonly<Record<WarrantyClaimStatusCode, readonly WarrantyClaimStatusCode[]>> = {
  OPEN: ["REVIEW", "REJECTED"],
  REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["CLOSED"],
  REJECTED: ["CLOSED"],
  CLOSED: [],
};

export function isWarrantyClaimStatus(value: unknown): value is WarrantyClaimStatusCode {
  return typeof value === "string"
    && (WARRANTY_CLAIM_STATUS_CODES as readonly string[]).includes(value);
}

export function isWarrantyClaimTransitionAllowed(from: string, to: string): boolean {
  if (!isWarrantyClaimStatus(from) || !isWarrantyClaimStatus(to)) return false;
  return from === to || WARRANTY_CLAIM_TRANSITIONS[from].includes(to);
}
