import type { CrmClientCore, CrmVehicleCore } from "./crm-core";

export type InquiryPriorityContract = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type InquiryVehicleContract = Pick<
  CrmVehicleCore,
  "id" | "brand" | "model" | "year" | "plateNumber" | "vin"
>;

export type InquiryExistingClientContract = Pick<CrmClientCore, "id" | "name">;

export type InquiryAssignedUserContract = {
  id: string;
  name: string;
};

export type InquiryExistingLeadContract = {
  id: string;
  name: string | null;
  status: string;
  assignedUserId: string | null;
};

export type InquiryItemContract = {
  id: string;
  channel: string;
  state: string;
  name: string;
  phone: string | null;
  handle: string | null;
  subject: string;
  preview: string;
  vehicle: string | null;
  plate: string | null;
  receivedAt: string;
  sourceDetail: string | null;
  campaign: string | null;
  assignedUser: InquiryAssignedUserContract | null;
  priority: InquiryPriorityContract;
  existingClient: InquiryExistingClientContract | null;
  vehicles: InquiryVehicleContract[];
  existingLead: InquiryExistingLeadContract | null;
};

export type InquiryStatsContract = {
  total: number;
  critical: number;
  high: number;
  existingClients: number;
  withActiveLead: number;
};

export type InquiriesPayloadContract = {
  ok: true;
  items: InquiryItemContract[];
  stats: InquiryStatsContract;
};

export type InquiryMutationPayloadContract = {
  ok: true;
};
