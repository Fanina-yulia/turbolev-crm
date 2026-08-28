import type { CrmDateTime, CrmDecimal } from "./crm-core";

export const PLANNER_STATUS_VALUES = [
  "BOOKED",
  "ARRIVED",
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
  "NO_SHOW",
  "CANCELLED",
  "RESERVE",
] as const;

export type PlannerStatusContract = (typeof PLANNER_STATUS_VALUES)[number];

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
