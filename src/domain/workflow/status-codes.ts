/**
 * Canonical workflow status code lists shared by the domain, Planner and API
 * contracts. Entity definitions (labels, transitions and gates) remain in the
 * workflow registry; this module is deliberately data-only so it is safe to
 * import from client contracts.
 */

export const LEAD_CANONICAL_STATUS_CODES = [
  "NEW", "CONTACTED", "QUALIFIED", "ESTIMATE", "WAITING", "NO_ANSWER", "BOOKED", "ARRIVED", "LOST",
] as const;

export const APPOINTMENT_CANONICAL_STATUS_CODES = [
  "RESERVE", "BOOKED", "ARRIVED", "NO_SHOW", "CANCELLED",
] as const;

export const APPOINTMENT_COMPATIBILITY_STATUS_CODES = [
  "DIAGNOSTICS",
  "WAITING_PARTS_SELECTION",
  "WAITING_CALCULATION",
  "WAITING_APPROVAL",
  "WAITING_PARTS",
  "READY_FOR_REPAIR",
  "IN_REPAIR",
  "WAITING_QC",
  "WAITING_PAYMENT",
  "READY_FOR_PICKUP",
  "COMPLETED",
  "WARRANTY",
  "PAUSED",
] as const;

/**
 * The complete Planner wire contract. Downstream values are retained only to
 * read old appointments and to avoid breaking old clients during migration.
 * New workflow transitions must update WorkOrder/DiagnosticRequest and leave
 * the Appointment lifecycle at its canonical value.
 */
export const APPOINTMENT_STATUS_CODES = [
  ...APPOINTMENT_CANONICAL_STATUS_CODES,
  ...APPOINTMENT_COMPATIBILITY_STATUS_CODES,
] as const;

export const APPOINTMENT_BLOCKING_STATUS_CODES = [
  "RESERVE",
  "BOOKED",
  "ARRIVED",
  ...APPOINTMENT_COMPATIBILITY_STATUS_CODES.filter((status) => status !== "COMPLETED"),
] as const;

export const WORK_ORDER_STATUS_CODES = [
  "PARTS_REVIEW",
  "WAITING_APPROVAL",
  "WAITING_PARTS",
  "READY_FOR_REPAIR",
  "IN_REPAIR",
  "PAUSED",
  "WAITING_QC",
  "REWORK",
  "READY_FOR_PICKUP",
  "WAITING_PAYMENT",
  "CLOSED",
  "CANCELLED",
] as const;

export const WORK_ORDER_CANONICAL_STATUS_CODES = WORK_ORDER_STATUS_CODES;

export const WORK_ORDER_INITIAL_STATUS = "PARTS_REVIEW" as const;

export const WORK_ORDER_LEGACY_PRE_CREATION_CODES = [
  "LEAD",
  "QUALIFICATION",
  "PREQUOTE",
  "BOOKED",
  "ARRIVED",
  "DIAGNOSTIC_REQUEST",
  "DIAGNOSTICS",
] as const;

export const PLANNER_STATUS_VALUES = APPOINTMENT_STATUS_CODES;
export const PLANNER_BLOCKING_STATUS_VALUES = APPOINTMENT_BLOCKING_STATUS_CODES;

export type AppointmentStatusCode = (typeof APPOINTMENT_STATUS_CODES)[number];
export type WorkOrderStatusCode = (typeof WORK_ORDER_STATUS_CODES)[number];
export type PlannerStatusCode = (typeof PLANNER_STATUS_VALUES)[number];
