export type WorkOrderStatus =
  | "LEAD"
  | "QUALIFICATION"
  | "PREQUOTE"
  | "BOOKED"
  | "ARRIVED"
  | "DIAGNOSTIC_REQUEST"
  | "DIAGNOSTICS"
  | "PARTS_REVIEW"
  | "QUOTE_DRAFT"
  | "CLIENT_APPROVAL"
  | "PARTS_PAYMENT"
  | "PARTS_ORDERED"
  | "WAITING_PARTS"
  | "READY_FOR_REPAIR"
  | "REPAIR"
  | "QUALITY_CONTROL"
  | "READY"
  | "WORK_PAYMENT"
  | "PAID"
  | "CLOSED"
  | "AFTERSALES";

export const WORK_ORDER_FLOW: WorkOrderStatus[] = [
  "LEAD",
  "QUALIFICATION",
  "PREQUOTE",
  "BOOKED",
  "ARRIVED",
  "DIAGNOSTIC_REQUEST",
  "DIAGNOSTICS",
  "PARTS_REVIEW",
  "QUOTE_DRAFT",
  "CLIENT_APPROVAL",
  "PARTS_PAYMENT",
  "PARTS_ORDERED",
  "WAITING_PARTS",
  "READY_FOR_REPAIR",
  "REPAIR",
  "QUALITY_CONTROL",
  "READY",
  "WORK_PAYMENT",
  "PAID",
  "CLOSED",
  "AFTERSALES",
];

export const BUSINESS_RULES = {
  workOrderAfterDiagnostics: true,
  diagnosticsArePaid: true,
  orderPartsOnlyAfterConfirmedPayment: true,
  additionalPaidWorkRequiresNewApproval: true,
  readyRequiresQualityControl: true,
  vehicleIssueRequiresZeroBalance: true,
} as const;
