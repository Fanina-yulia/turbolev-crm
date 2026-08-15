import { HARD_GATE_CODES, WORK_ORDER_STATUS_CODES } from "./workflow";
import type { WorkOrderStatusCode } from "./workflow";

export type WorkOrderStatus = WorkOrderStatusCode;

export const WORK_ORDER_FLOW: readonly WorkOrderStatus[] = WORK_ORDER_STATUS_CODES;

export const BUSINESS_RULES = {
  workOrderAfterDiagnostics: true,
  diagnosticsArePaid: true,
  orderPartsOnlyAfterConfirmedPayment: true,
  additionalPaidWorkRequiresNewApproval: true,
  readyRequiresQualityControl: true,
  vehicleIssueRequiresZeroBalance: true,
} as const;

export const BUSINESS_RULE_GATES = {
  workOrderAfterDiagnostics: HARD_GATE_CODES.WORK_ORDER_AFTER_CONFIRMED_DIAGNOSTICS,
  orderPartsOnlyAfterConfirmedPayment: HARD_GATE_CODES.PARTS_PAYMENT_BEFORE_ORDER,
  additionalPaidWorkRequiresNewApproval: HARD_GATE_CODES.ADDITIONAL_WORK_REQUIRES_APPROVAL,
  readyRequiresQualityControl: HARD_GATE_CODES.QC_PASSED_BEFORE_READY,
  vehicleIssueRequiresZeroBalance: HARD_GATE_CODES.ZERO_BALANCE_BEFORE_DELIVERY,
} as const;
