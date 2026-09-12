import { PLANNER_STATUS_VALUES } from "@/src/domain/workflow/status-codes";
import type { CrmDateTime, CrmDecimal } from "./crm-core";

export { PLANNER_STATUS_VALUES };

export type PlannerStatusContract = (typeof PLANNER_STATUS_VALUES)[number];
export const PLANNER_PURPOSE_VALUES = ["DIAGNOSTICS", "REPAIR"] as const;
export type PlannerPurposeContract = (typeof PLANNER_PURPOSE_VALUES)[number];
export type PlannerPaymentStatusContract = "NOT_FORMED" | "UNPAID" | "PARTIAL" | "PAID" | "OVERDUE" | "CANCELLED";

export type PlannerPostContract = {
  id: string;
  name: string;
  sortOrder: number;
  capabilities: string[];
};

export type PlannerMechanicContract = {
  id: string;
  name: string;
  sortOrder: number;
};

export type PlannerLocationContract = {
  id: string;
  name: string;
  timezone: string;
  openMinute: number;
  closeMinute: number;
  posts: PlannerPostContract[];
  mechanics: PlannerMechanicContract[];
};

export type PlannerAppointmentContract = {
  id: string;
  locationId: string;
  postId: string | null;
  mechanicId: string | null;
  status: PlannerStatusContract;
  workOrderId: string | null;
  purpose: PlannerPurposeContract | null;
  requiresDiagnosticFirst: boolean;
  processStatus: string | null;
  processLabel: string | null;
  payment: {
    status: PlannerPaymentStatusContract;
    amount: CrmDecimal | null;
    paid: CrmDecimal | null;
    outstanding: CrmDecimal | null;
  };
  vehicleId: string | null;
  customerName: string | null;
  phone: string | null;
  vehicleLabel: string | null;
  plateNumber: string | null;
  problem: string | null;
  comment: string | null;
  source: string | null;
  estimatedAmount: CrmDecimal | null;
  priority: number;
  plannedStartAt: CrmDateTime;
  plannedEndAt: CrmDateTime;
  actualArrivalAt: CrmDateTime | null;
  actualStartAt: CrmDateTime | null;
  actualEndAt: CrmDateTime | null;
  partsEtaAt: CrmDateTime | null;
  post: PlannerPostContract | null;
  mechanic: PlannerMechanicContract | null;
};

export type PlannerBoardPayload = {
  status: "OK";
  locations: PlannerLocationContract[];
  activeLocationId: string | null;
  appointments: PlannerAppointmentContract[];
};
